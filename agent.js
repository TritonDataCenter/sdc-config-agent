/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * agent.js: SDC configuration agent
 *
 * This agent queries SAPI for changes to a zone's configuration, downloads
 * those changes, and applies any applicable updates.
 */

var assert = require('assert-plus');
var async = require('async');
var fs = require('fs');
var optimist = require('optimist');
var util = require('./lib/common/util');

var Agent = require('./lib/agent/agent');
var Logger = require('bunyan');
var restify = require('restify');


var ARGV = optimist.options({
	'f': {
		alias: 'file',
		describe: 'location of configuration file'
	},
	's': {
		alias: 'synchronous',
		describe: 'start agent in synchronous mode'
	},
	't': {
		alias: 'timeout',
		describe: 'in sync mode, will exit in timeout seconds'
	}
}).argv;


var file = ARGV.f ? ARGV.f : '/opt/smartdc/config-agent/etc/config.json';
var contents = fs.readFileSync(file);
var config = JSON.parse(contents);

assert.object(config, 'config');
assert.string(config.logLevel, 'config.logLevel');
assert.number(config.pollInterval, 'config.pollInterval');
assert.object(config.sapi, 'config.sapi');
assert.string(config.sapi.url, 'config.sapi.url');

assert.optionalArrayOfString(config.localManifestDirs,
    'config.localManifestDirs');

var log = new Logger({
	name: 'config-agent',
	level: config.logLevel,
	stream: process.stdout,
	serializers: restify.bunyan.serializers
});


var agent;

async.waterfall([
	function (cb) {
		util.zonename(function (err, zonename) {
			if (err)
				log.error(err, 'failed to determine zone name');

			if (zonename !== 'global') {
				config.instances = [ zonename ];
			} // else TODO AGENT-732
			return (cb(err));
		});
	},
	function (cb) {
		agent = new Agent(config, log);

		agent.init(function (err) {
			if (err)
				log.error(err, 'failed to initialize agent');
			return (cb(err));
		});
	},
	function (cb) {
		if (ARGV.s) {
			/*
			 * Synchronous mode is used as part of a zone's first
			 * boot and initial setup.  Instead of polling at some
			 * interval, immediately write out the configuration
			 * files and exit.
			 */
			var timeoutId;
			if (ARGV.t) {
				var timeoutSeconds = parseInt(ARGV.t, 10);
				if (isNaN(timeoutSeconds)) {
					var m = 'invalid timeout option';
					log.error(m);
					return (cb(new Error(m)));
				}
				timeoutId = setTimeout(function timedOut() {
					var m2 = 'process timed out';
					log.fatal(m2);
					return (cb(new Error(m2)));
				}, timeoutSeconds * 1000);
			}
			agent.checkAndRefresh(function (err) {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				if (err) {
					log.error(err,
					    'failed to write config');
				} else {
					log.info('wrote ' +
					    'configuration synchronously');
				}
				cb(err);
			});
		} else {
			setInterval(agent.checkAndRefresh.bind(agent),
			    config.pollInterval);
			cb(null);
		}
	}
], function (err) {
	if (err)
		process.exit(1);

});
