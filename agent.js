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
 * This agent periodically gathers config information for this instance
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
	},
	'u': {
		alias: 'sapi-url',
		describe: 'SAPI URL'
	}
}).argv;


var config;
if (ARGV.f) {
	var contents = fs.readFileSync(ARGV.f);
	config = JSON.parse(contents);
} else {
	config = {
		instances: [],
		logLevel: 'info',
		pollInterval: 60000
	};
}

if (ARGV['sapi-url']) {
	config.sapi = { url: ARGV['sapi-url'] };
}

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

// For now we stash `autoMetadata` onto the config object.
// TODO(refactor): pass autoMetadata as an opt to `new Agent`.
var autoMetadata = config.autoMetadata = {};

async.waterfall([
	// TODO(refactor) move this to Agent.init
	function gatherInsts(cb) {
		util.getZonename({log: log}, function (err, zonename_) {
			if (err)
				log.error(err, 'failed to determine zone name');

			zonename = zonename_;
			if (zonename !== 'global') {
				config.instances = [ zonename ];
			} // else TODO AGENT-732

			autoMetadata.ZONENAME = zonename;

			return (cb(err));
		});
	},

	// TODO(refactor) move this to Agent.init
	function autoMetadataIps(cb) {
		if (zonename === 'global') {
			return (cb());
		}

		var mdataOpts = {log: log, key: 'sdc:nics'};
		util.mdataGet(mdataOpts, function (err, nicsJson) {
			if (err) {
				return (cb(err));
			}

			var nics = JSON.parse(nicsJson);
			for (var i = 0; i < nics.length; i++) {
				var nic = nics[i];
				if (i === 0) {
					autoMetadata.PRIMARY_IP = nic.ip;
				}
				if (nic.nic_tag) {
					var NIC_TAG = nic.nic_tag.toUpperCase();
					autoMetadata[NIC_TAG + '_IP'] = nic.ip;
				}
			}

			cb();
		});
	},

	function autoMetadataServerUuid(cb) {
		if (zonename === 'global') {
			util.getSysinfo({log: log}, function (err, sysinfo) {
				if (err) {
					cb(err);
				} else {
					autoMetadata.SERVER_UUID = sysinfo.UUID;
					cb();
				}
			});
		} else {
			var mdataOpts = {log: log, key: 'sdc:server_uuid'};
			util.mdataGet(mdataOpts, function (err, serverUuid) {
				if (err) {
					cb(err);
				} else {
					autoMetadata.SERVER_UUID = serverUuid;
					cb();
				}
			});
		}
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
