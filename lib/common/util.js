/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * lib/common/util.js: utility functions
 */

var assert = require('assert-plus');
var execFile = require('child_process').execFile;
var mod_verror = require('verror');
var os = require('os');

var WError = mod_verror.WError;
var VError = mod_verror.VError;


// ---- internal support

/**
 * A convenience wrapper around `child_process.execFile` to take away some
 * logging and error handling boilerplate.
 *
 * @param args {Object}
 *      - argv {Array} Required.
 *      - log {Bunyan Logger} Required. Use to log details at trace level.
 * @param cb {Function} `function (err, stdout, stderr)` where `err` here is
 *      an `verror.WError` wrapper around the child_process error.
 *
 * TODO: support env or just exec opts in general.
 */
function execFilePlus(args, cb) {
    assert.object(args, 'args');
    assert.arrayOfString(args.argv, 'args.argv');
    assert.object(args.log, 'args.log');
    assert.func(cb);
    var argv = args.argv;

    args.log.trace({exec: true, argv: argv}, 'exec start');
    var execOpts = {};
    if (args.maxBuffer) {
        execOpts.maxBuffer = args.maxBuffer;
    }

    execFile(argv[0], argv.slice(1), execOpts,
            function (err, stdout, stderr) {
        args.log.trace({exec: true, argv: argv, err: err,
            stdout: stdout, stderr: stderr}, 'exec done');
        if (err) {
            var e = new WError(err,
                'exec error:\n'
                + '\targv: %j\n'
                + '\texit status: %s\n'
                + '\tstdout:\n%s\n'
                + '\tstderr:\n%s',
                argv, err.code, stdout.trim(), stderr.trim());
            cb(e, stdout, stderr);
            return;
        }
        cb(null, stdout, stderr);
    });
}



// ---- Exports

/*
 * Return the current zone name.
 */
function getZonename(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var zonenamePath = os.platform() === 'linux' ?
        '/usr/triton/bin/zonename' : '/usr/bin/zonename';
    var execOpts = {
        argv: [zonenamePath],
        log: opts.log
    };
    execFilePlus(execOpts, function (err, stdout) {
        if (err) {
            cb(err);
            return;
        }
        cb(null, stdout.trim());
    });
}


/**
 * Run `mdata-get $key`.
 *
 * Limitation: this doesn't quote the given `$key` carefully.
 */
function mdataGet(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.string(opts.key, 'opts.key');
    assert.func(cb, 'cb');
    // TODO: Fix this when we have mdata-agent working on linux
    var execOpts = {
        argv: ['/usr/sbin/mdata-get', opts.key],
        log: opts.log
    };
    execFilePlus(execOpts, function (err, stdout) {
        if (err) {
            cb(err);
            return;
        }
        cb(null, stdout.trim());
    });
}


/**
 * Return data from `sysinfo`.
 */
function getSysinfo(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var sysinfoPath = os.platform() === 'linux' ?
        '/usr/triton/bin/sysinfo' : '/usr/bin/sysinfo';
    execFilePlus({
        argv: [sysinfoPath],
        log: opts.log
    }, function (err, stdout) {
        if (err) {
            cb(err);
            return;
        }

        var sysinfo;

        try {
            sysinfo = JSON.parse(stdout.trim());
        } catch (e) {
            cb(new VError(e, 'failed to parse sysinfo output'));
            return;
        }

        cb(null, sysinfo);
    });
}


/**
 * Copies over all keys in `from` to `to`, or
 * to a new object if `to` is not given.
 */
function objCopy(from, to) {
    if (to === undefined) {
        to = {};
    }
    for (var k in from) {
        to[k] = from[k];
    }
    return (to);
}



module.exports = {
    getZonename: getZonename,
    mdataGet: mdataGet,
    getSysinfo: getSysinfo,
    objCopy: objCopy
};
/* vim: set et sw=4 sts=4 ts=4: */
