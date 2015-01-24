/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * SmartDataCenter config agent
 *
 * This agent periodically gathers config information for this zone
 * from SAPI, renders file templates (in "sapi_templates/..." dirs) and, if
 * changed, writes out the new file content and (optionally) runs a `post_cmd`.
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

var log = new Logger({
	name: 'config-agent',
	level: config.logLevel,
	stream: process.stdout,
	serializers: restify.bunyan.serializers
});


var agent;
var zonename;

async.waterfall([
	// TODO(refactor) move this to Agent.init
	function (cb) {
		util.getZonename({log: log}, function (err, zonename_) {
			if (err)
				log.error(err, 'failed to determine zone name');

			zonename = zonename_;
			if (zonename !== 'global') {
				config.instances = [ zonename ];
			} // else TODO AGENT-732
			return (cb(err));
		});
	},

	// TODO(refactor) move this to Agent.init
	function gatherAutoMetadata(cb) {
		// TODO: pass this in as a separate opt to `new Agent`.
		if (zonename === 'global') {
			config.autoMetadata = {};
			return (cb());
		}

		var mdataOpts = {log: log, key: 'sdc:nics'};
		util.mdataGet(mdataOpts, function (err, nicsJson) {
			if (err) {
				return (cb(err));
			}

			var nics = JSON.parse(nicsJson);
			var auto = config.autoMetadata = {};
			for (var i = 0; i < nics.length; i++) {
				var nic = nics[i];
				if (i === 0) {
					auto.PRIMARY_IP = nic.ip;
				}
				if (nic.nic_tag) {
					auto[nic.nic_tag.toUpperCase() + '_IP']
						= nic.ip;
				}
			}

			log.info({autoMetadata: config.autoMetadata},
				'gathered autoMetadata');
			cb();
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
					log.info('wrote configuration '
						+ 'synchronously');
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
