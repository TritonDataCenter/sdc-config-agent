/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Triton config agent
 *
 * This agent periodically gathers config information for this instance
 * from SAPI, renders file templates (in "sapi_templates/..." dirs) and, if
 * changed, writes out the new file content and (optionally) runs a `post_cmd`.
 */

var fs = require('fs');
var os = require('os');

var assert = require('assert-plus');
var async = require('async');
var bunyan = require('bunyan');
var jsprim = require('jsprim');
var optimist = require('optimist');
var vasync = require('vasync');

var util = require('./lib/common/util');
var Agent = require('./lib/agent/agent');


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

var VNIC_NAME_RE = /^([a-zA-Z0-9_]{0,31})[0-9]+$/;

var config;
var configPath;
var defaultConfigPath = '/opt/smartdc/config-agent/etc/config.json';

// Only the GZ config-agent runs in 'no-config' mode, so for non-GZ agents
// we ensure that a default configuration is always present. If none of the
// two cases below match, we don't parse a configuration file
if (ARGV.f && fs.existsSync(ARGV.f)) {
    configPath = ARGV.f;
} else if (fs.existsSync(defaultConfigPath)) {
    configPath = defaultConfigPath;
}

if (configPath) {
    var contents = fs.readFileSync(configPath);
    config = JSON.parse(contents);
} else {
    config = {
        instances: [],
        logLevel: 'info',
        pollInterval: 120000
    };
}

if (ARGV['sapi-url']) {
    config.sapi = { url: ARGV['sapi-url'] };
}

assert.object(config, 'config');
assert.string(config.logLevel, 'config.logLevel');
assert.finite(config.pollInterval, 'config.pollInterval');
assert.optionalObject(config.sapi, 'config.sapi');

var log = bunyan.createLogger({
    name: 'config-agent',
    level: config.logLevel,
    stream: process.stdout,
    serializers: bunyan.stdSerializers
});


var agent;
var zonename;

// For now we stash `autoMetadata` onto the config object.
// TODO(refactor): pass autoMetadata as an opt to `new Agent`.
var autoMetadata = config.autoMetadata = {};


/*
 * This is the normal operating mode of config-agent: periodically checking
 * for config updates from SAPI and refreshing manifests/config files.
 */
function startPeriodicRefresh() {
    var delay;

    // Return a random delay between 0.5*pollInterval and 1.5*pollInterval.
    function getDelay() {
        var min = config.pollInterval * 0.5;
        var max = config.pollInterval * 1.5;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function checkOnce() {
        agent.checkAndRefresh(function doneCheck(_err) {
            delay = getDelay();
            log.trace({delay: delay}, 'schedule checkAndRefresh');
            setTimeout(checkOnce, delay);
        });
    }

    delay = getDelay();
    log.trace({delay: delay}, 'schedule checkAndRefresh');
    setTimeout(checkOnce, delay);
}

/*
 * If the nic tag is of the form <name>_RACK_<rack name>, it will override any
 * similarly named nic tag (e.g. "MANTA_RACK_E05" will override "MANTA" nic
 * tags).
 */
function setNicTag(nic_tag, ip) {
    var NIC_TAG = nic_tag.toUpperCase();
    var tag = NIC_TAG;
    var ips_key;

    /* _RACK override */
    if (NIC_TAG.search(/^[A-Z]+_RACK_[A-Z0-9_-]+$/) === 0) {
        tag = NIC_TAG.split('_')[0];
    }

    ip = ip.split('/')[0];

    autoMetadata[tag + '_IP'] = ip;

    ips_key = tag + '_IPS';
    if (!autoMetadata[ips_key]) {
        autoMetadata[ips_key] = [];
    }

    if (autoMetadata[ips_key].indexOf(ip) === -1) {
        autoMetadata[ips_key].push(ip);
    }
}

/**
 * Mapping NIC tags to IPs is a bit messier to do in the Global Zone. The
 * sysinfo output has two relevant arrays: "Network Interfaces", which
 * represents physical interfaces (including aggregations) and their NIC
 * tags, and "Virtual Network Interfaces", which is VNICs created with
 * dladm(1M).
 *
 * For the most part, each NIC tag that has an IP address will get its
 * own VNIC (named after the NIC tag). This means that we largely just
 * need to strip the ending digit to get at the NIC tag for that IP.
 *
 * The exception is the admin IP: it doesn't get placed onto its own VNIC
 * but instead gets placed directly on the physical interface that has
 * the admin tag. We therefore need to check for IPs on the physical
 * interfaces and use it when the NIC looks like an admin interface.
 */
function processGZNicTags(sysinfo) {
    var pnics = sysinfo['Network Interfaces'];
    var vnics = sysinfo['Virtual Network Interfaces'];
    var ptags = {};

    jsprim.forEachKey(pnics, function (name, pnic) {
        pnic['NIC Names'].forEach(function (nic_tag) {
            ptags[nic_tag] = name;

            if (!pnic.ip4addr) {
                return;
            }
            // Only the admin IP should be plumbed on a physical nic.
            if (nic_tag === 'admin' || nic_tag.indexOf('admin_') === 0) {
                setNicTag(nic_tag, pnic.ip4addr);
            }
        });
    });

    jsprim.forEachKey(vnics, function (name, vnic) {
        var m = VNIC_NAME_RE.exec(name);
        if (m === null) {
            return;
        }

        if (!vnic.ip4addr) {
            return;
        }

        if (ptags[m[1]] !== vnic['Host Interface']) {
            /*
             * Under normal Triton operation this shouldn't happen, but if an
             * operator is running `dladm create-vnic` in the GZ themselves
             * we could arrive here.
             */
            return;
        }

        setNicTag(m[1], vnic.ip4addr);
    });
}

function setGlobalZoneAutoMetadata(callback) {
    util.getSysinfo({ log: log }, function (sErr, sysinfo) {
        if (sErr) {
            callback(sErr);
            return;
        }

        autoMetadata.SERVER_UUID = sysinfo['UUID'];
        autoMetadata.DATACENTER_NAME = sysinfo['Datacenter Name'];

        processGZNicTags(sysinfo);

        callback();
    });
}

function setInZoneAutoMetadata(callback) {
    vasync.pipeline({
        input: null,
        funcs: [
            function getServerUuidIZ(_, cb) {
                util.mdataGet({
                    log: log,
                    key: 'sdc:server_uuid'
                }, function (err, serverUuid) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    autoMetadata.SERVER_UUID = serverUuid;

                    cb();
                });
            },
            // FIXME FOR LINUX. We can load this from sdc config file!
            function getDatacenterNameIZ(_, cb) {
                util.mdataGet({
                    log: log,
                    key: 'sdc:datacenter_name'
                }, function (err, dcName) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    autoMetadata.DATACENTER_NAME = dcName;

                    cb();
                });
            },
            function getNicsIZ(_, cb) {
                util.mdataGet({
                    log: log,
                    key: 'sdc:nics'
                }, function (err, nicsJson) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    var nics = JSON.parse(nicsJson);
                    for (var i = 0; i < nics.length; i++) {
                        var nic = nics[i];
                        if (i === 0) {
                            autoMetadata.PRIMARY_IP = nic.ip;
                        }

                        /*
                         * Loop through the 'ips' first so that the address in
                         * 'ip' will override any previously entered values.
                         */
                        if (nic.nic_tag && nic.ips && Array.isArray(nic.ips)) {
                            /* eslint-disable no-loop-func */
                            nic.ips.forEach(function (ip) {
                                setNicTag(nic.nic_tag, ip);
                            });
                            /* eslint-enable no-loop-func */
                            setNicTag(nic.nic_tag, nic.ip);
                        }
                    }

                    cb();
                });
            }
        ]
    }, function doneInZoneAutoMetadata(err) {
        callback(err);
    });
}

async.waterfall([
    // TODO(refactor) move this to Agent.init
    function gatherInsts(cb) {
        util.getZonename({log: log}, function (err, zonename_) {
            if (err) {
                log.error(err, 'failed to determine zone name');
            }

            zonename = zonename_;
            if (zonename !== 'global') {
                // Allow the config file to specify the
                // instance UUID(s). This is used for load
                // testing.
                if (!config.instances ||
                    config.instances.length === 0) {
                    config.instances = [ zonename ];
                }
            }

            autoMetadata.ZONENAME = zonename;

            return (cb(err));
        });
    },

    function gatherAutoMetadata(cb) {
        if (zonename === 'global') {
            setGlobalZoneAutoMetadata(cb);
        } else {
            setInZoneAutoMetadata(cb);
        }
    },

    // For zone instances, make sure we always default to mdata-get sapi-url
    // if the value was never passed
    function ensureSapiUrl(cb) {
        if (zonename === 'global' || config.sapi !== undefined) {
            cb();
            return;
        }

        var mdataOpts = {log: log, key: 'sapi-url'};
        util.mdataGet(mdataOpts, function (err, sapiUrl) {
            if (err) {
                cb(err);
                return;
            }

            config.sapi = { url: sapiUrl };
            cb();
        });
    },
    function (cb) {
        agent = new Agent(config, log);

        agent.init(function (err) {
            if (err) {
                log.error(err, 'failed to initialize agent');
            }
            cb(err);
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
                    cb(new Error(m));
                    return;
                }
                timeoutId = setTimeout(function timedOut() {
                    var m2 = 'process timed out';
                    log.fatal(m2);
                    cb(new Error(m2));
                    return;
                }, timeoutSeconds * 1000);
            }
            agent.checkAndRefresh(function (err) {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (err) {
                    log.error(err, 'synchronous agent '
                        + 'checkAndRefresh failure');
                } else {
                    log.info('synchronous agent '
                        + 'checkAndRefresh success');
                }
                cb(err);
                return;
            });
        }

        startPeriodicRefresh();
        cb(null);
    }
], function (err) {
    if (err) {
        process.exit(1);
    }
    // Rewrite config on `svcadm refresh config-agent`:
    process.on('SIGHUP', function () {
        log.info('Trapped SIGHUP, rewritting config synchronously');
        agent.checkAndRefresh(function (er2) {
            if (er2) {
                log.error(er2, 'failed to write config');
            } else {
                log.info('wrote configuration synchronously');
            }
        });
    });
});
/* vim: set et sw=4 sts=4 ts=4: */
