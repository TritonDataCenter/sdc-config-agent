/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/common/util.js: utility functions
 */

var assert = require('assert-plus');

var exec = require('child_process').exec;


// -- Exported interface

module.exports.zonename = zonename;

/*
 * Return the current zone name.
 */
function zonename(cb) {
	assert.func(cb, 'cb');

	exec('/usr/bin/zonename', function (err, stdout) {
		if (err)
			return (cb(new Error(err.message)));

		return (cb(null, stdout.trim()));
	});
}
