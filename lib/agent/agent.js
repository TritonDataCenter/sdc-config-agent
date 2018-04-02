/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * An `Agent` class responsible for maintaining configuration files.
 *
 * This agent makes extensive use of objects called configuration manifests.
 * These manifests describe all data associated with a configuration file,
 * including but not limited to its template, where that file is installed, and
 * a command to run after the file is installed.  These manifests are generated
 * by and retrieved from the Services API (SAPI).
 *
 * The full list of fields includes:
 *
 *  name		The manifest's name.
 *
 *  template	The file's hogan.js template.
 *
 *	contents	The rendered configuration file, basically the
 *			template + metadata.  This is not actually stored in
 *			SAPI but rather generated here in the zone.
 *
 *	path		Where this file is installed.
 *
 *	post_cmd	(Optional) If a file is updated, this command is run
 *			after the file is updated.
 *
 * In addition to the configuration manfiests, each zone also has a set of
 * metadata values.  These values are used to render the configuration file from
 * the manifest's template.  These values are stored separately from each
 * manifest since the metadata values apply to all manifests in a zone.
 */

var p = console.log;

var assert = require('assert-plus');
var async = require('async');
var exec = require('child_process').exec;
var fs = require('fs');
var hogan = require('hogan.js');
var jsprim = require('jsprim');
var objCopy = require('../common/util').objCopy;
var getZonename = require('../common/util').getZonename;
var once = require('once');
var path = require('path');
var sdc = require('sdc-clients');
var sprintf = require('util').format;
var uuidv4 = require('uuid/v4');
var vasync = require('vasync');


var mkdirp = require('mkdirp');


function Agent(config, log) {
	assert.object(config, 'config');
	assert.arrayOfString(config.instances, 'config.instances');
	assert.object(config.sapi, 'config.sapi');
	assert.string(config.sapi.url, 'config.sapi.url');

	this.log = log;

	/*
	 * If the config.localManifestDirs field is specified, the agent will
	 * find and read any manifests in those directories.  If any of those
	 * manifests has the same name as a manifest retrieved from SAPI, the
	 * local version of the manifest will override the SAPI version.
	 *
	 * Since config-agent has been updated to work on Compute Nodes,
	 * and thus being able to handle multiple instances,
	 * localManifestDirs can have an additional form where the
	 * instance UUIDs are known and don't correspond to `zonename`.
	 * The regular (since instance) format for localManifestDirs
	 * goes like this:
	 *
	 * localManifestDirs: [ "/path/one", "/path/two", "/path/three", .. ]
	 *
	 * For supporting more than one instance, localManifestDirs
	 * can also adopt the following format:
	 *
	 * localManifestDirs: { "<uuid>": [/path/one", "/path/two", .. ]  }
	 *
	 * Where there is an array of localManifestDirs per instance UUID.
	 */
	this.localManifestDirs = config.localManifestDirs || {};

	/*
	 * Keep a reference to the config object etags for every instance
	 */
	this.etags = {};

	/*
	 * If the config.localMetadata field is set, include that metadata with
	 * any metadata from SAPI.
	 */
	assert.optionalObject(config.localMetadata, 'config.localMetadata');
	this.localMetadata = config.localMetadata || {};

	assert.optionalObject(config.autoMetadata, 'config.autoMetadata');
	this.autoMetadata = config.autoMetadata || {};

	this.instances = config.instances;

	log.info({ config: config }, 'using config');

	this.sapi = new sdc.SAPI({
		log: log,
		url: config.sapi.url,
		agent: false
	});
}

Agent.prototype.init = function init(cb) {
	var self = this;
	var log = this.log;

	log.info({ localMetadata: this.localMetadata }, 'using local metadata');
	self.localManifests = {};

	// Load instances at config-agent.d/ when initializing the agent.
	self.loadInstances(function (loadErr) {
		if (loadErr) {
			cb(loadErr);
			return;
		}

		if (!self.localManifestDirs) {
			log.info('using 0 local manifests');
			return (cb(null));
		}

		// vm instance behaviour: if localManifestDirs is an array,
		// transform the variable to the general
		// { uuid: localManifestDirs } object. vm instances can
		// only have one instance configuration so we use instances[0]
		if (Array.isArray(self.localManifestDirs)) {
			assert.arrayOfString(self.localManifestDirs);
			assert.equal(self.instances.length, 1);

			var localManifestDirs = {};
			localManifestDirs[self.instances[0]] =
				self.localManifestDirs;
			self.localManifestDirs = localManifestDirs;
		}

		vasync.forEachParallel({
			func: function (instance, subsubcb) {
				self.initInstance.call(self, instance,
					subsubcb);
			},
			inputs: self.instances
		}, function (err) {
			if (cb)
				cb();
		});
	});

	return (null);
};

/*
 * In addition to instances specified in a configuration file, config-agent
 * supports instances to be added by placing a json file in a special
 * config-agent.d/ directory. Files that are dropped in that directory
 * must have the following format
 *
 * {
 *	 "instance": "<instance_id>",
 *	 "localManifestDirs": <array-of-dirs>
 * }
 *
 * This is only for config-agent in global zone mode (multiple instances)
 */
Agent.prototype.loadInstances = function loadInstances(cb) {
	var self = this;
	var log = this.log;
	var dir = '/opt/smartdc/agents/etc/config-agent.d';

	getZonename({log: log}, function (err, zonename) {
		if (err) {
			log.error(err, 'failed to determine zone name ' +
				'for loadInstances');
			cb(err);
		}

		if (zonename !== 'global') {
			cb();
			return;
		}


		fs.readdir(dir, function (dirErr, files) {
			if (dirErr) {
				log.warn(dirErr, 'Error reading ' + dir);
				cb();
				return;
			}

			async.forEachSeries(files, loadInstance,
			function (loadErr) {
				if (loadErr) {
					log.error(loadErr,
						'Error loading instances from '
						+ dir);
					cb(loadErr);
					return;
				}

				cb();
			});
		});
	});

	var JSON_FILE_REGEX = /^.*.json$/;

	function loadInstance(file, next) {
		if (!JSON_FILE_REGEX.test(file)) {
			log.warn('"%s" is not a .json file', file);
			next();
			return;
		}

		var filepath = path.join(dir, file);
		var obj;
		try {
			obj = require(filepath);
		} catch (parseErr) {
			log.error(parseErr, 'Could not parse "%s"', file);
			next(parseErr);
			return;
		}

		if (!obj.instance || !obj.localManifestDirs ||
			!Array.isArray(obj.localManifestDirs)) {
			log.warn('"%s" does\'t have a valid format, ignoring',
				file);
			next();
			return;
		}

		if (self.instances.indexOf(obj.instance) === -1) {
			self.instances.push(obj.instance);
		}

		self.localManifestDirs[obj.instance] = obj.localManifestDirs;
		next();
	}
};

Agent.prototype.initInstance = function initInstance(instance, cb) {
	var self = this;
	var log = this.log;

	if (!this.localManifestDirs[instance]) {
		self.localManifests[instance] = [];
		log.info('using 0 local manifests for instance %s', instance);
		return (cb(null));
	}

	assert.arrayOfString(this.localManifestDirs[instance]);

	self.findManifestDirs(this.localManifestDirs[instance],
	function (err, dirs) {
		if (err)
			return (cb(err));

		vasync.forEachParallel({
			func: readManifests.bind(self),
			inputs: dirs
		}, function (suberr, results) {
			if (suberr)
				return (cb(suberr));

			var manifests = [];

			results.successes.forEach(function (suc) {
				manifests = manifests.concat(suc);
			});

			self.localManifests[instance] = manifests;

			log.info('using %d local manifests for instance %s',
				manifests.length, instance);
			log.debug({ localManifests: manifests },
				'local manifests');

			cb();
		});
	});

	return (null);
};

Agent.prototype.checkAndRefresh = function checkAndRefresh(cb) {
	assert.func(cb, 'cb');

	var self = this;
	var startTime = Date.now();
	var log = self.log.child({req_id: uuidv4()}, true);

	log.trace('checkAndRefresh: start');

	vasync.forEachParallel({
		func: function checkAnInst(inst, next) {
			self.checkAndRefreshInst({
				inst: inst,
				log: log
			}, next);
		},
		inputs: self.instances
	}, function doneCheckInsts(err) {
		var elapsedMs = Date.now() - startTime;
		if (err) {
			log.warn({err: err, elapsedMs: elapsedMs},
				'checkAndRefresh: finish: failure');
		} else {
			log.debug({elapsedMs: elapsedMs},
				'checkAndRefresh: finish: success');
		}
		cb(err);
	});
};

Agent.prototype.checkAndRefreshInst = function checkAndRefreshInst(opts, cb) {
	assert.object(opts, 'opts');
	assert.uuid(opts.inst, 'opts.inst');
	assert.object(opts.log, 'opts.log');
	assert.uuid(opts.log.fields.req_id, 'opts.log.fields.req_id');
	assert.func(cb, 'cb');

	var self = this;
	var inst = opts.inst;
	var log = opts.log.child({inst: inst}, true);

	var autoInstanceMetadata = {
		INSTANCE_UUID: inst
	};

	var reqOpts = {
		headers: {
			'x-request-id': log.fields.req_id
		}
	};
	if (self.etags[inst]) {
		reqOpts.headers['if-none-match'] = self.etags[inst];
	}

	log.debug('call SAPI GetConfig');
	self.sapi.getConfig(inst, reqOpts, function (err, config, req, res) {
		if (err) {
			log.error(err, 'SAPI GetConfig error');
			cb(err);
			return;
		}


		if (res.statusCode === 304) {
			log.debug('config has not changed (304 response)');
			cb();
			return;
		}
		log.trace({config: config}, 'SAPI GetConfig result');

		// Only write etags if SAPI is returning them.
		if (res.headers.etag) {
			self.etags[inst] = res.headers.etag;
		}

		refresh(config);
	});

	function refresh(config) {
		async.waterfall([
			function resolveLocalManifests(next) {
				var manifests = self.resolveManifests(
					log,
					config.manifests,
					self.localManifests[inst] || []);

				next(null, manifests, config.metadata);
			},
			function renderFiles(manifests, metadata, next) {
				assert.object(manifests, 'manifests');
				assert.object(metadata, 'metadata');
				assert.func(next, 'next');

				Object.keys(manifests).forEach(function (name) {
					self.renderConfigFile(
						log.child({manifest: name}, true),
						manifests[name],
						metadata,
						autoInstanceMetadata);
				});

				next(null, manifests);
			},
			function writeFiles(manifests, next) {
				assert.object(manifests, 'manifests');

				vasync.forEachParallel({
					func: function (name, nextManifest) {
						self.writeConfigFile(
							log.child({manifest: name}, true),
							manifests[name],
							nextManifest);
					},
					inputs: Object.keys(manifests)
				}, function (err) {
					return (next(err));
				});
			}
		], function (err, results) {
			if (err) {
				log.error(err,
						'failed to write files for ' +
						'instance %s', inst);
			}
			cb(err);
		});
	}
};

/*
 * Look through a list of directories for subdirs named "sapi_manifests".
 */
Agent.prototype.findManifestDirs = function findManifestDirs(dirs, cb) {
	var log = this.log;

	assert.arrayOfString(dirs, 'dirs');
	assert.func(cb, 'cb');

	cb = once(cb);

	var searchDirs = [];

	async.forEachSeries(dirs, function (dir, subcb) {
		subcb = once(subcb);

		/*
		 * If the directory already contains a trailing
		 * "sapi_manifests", (i.e. the operator specified
		 * /opt/smartdc/cnapi/sapi_manifests as one of the search
		 * directories), then don't append that directory.
		 */
		var suffix = 'sapi_manifests';

		dir = path.resolve(dir);
		var index = dir.indexOf(suffix);
		if (index !== dir.length - suffix.length)
			dir = path.join(dir, 'sapi_manifests');

		fs.readdir(dir, function (err, dirents) {
			if (err) {
				log.warn(err, 'failed to read directory "%s"',
					dir);
			} else {
				searchDirs.push(dir);
			}

			subcb();
		});
	}, function (err) {
		cb(err, searchDirs);
	});
};

/*
 * Given a particular sapi_manifests directory (e.g.
 * /opt/smartdc/vmapi/sapi_manifests), read all the manifests from that
 * location.
 */
function readManifests(dir, cb) {
	var self = this;
	var log = self.log;
	var sapi = self.sapi;

	assert.string(dir, 'dir');
	assert.func(cb, 'cb');

	fs.readdir(dir, function (err, files) {
		if (err) {
			log.warn(err, 'failed to read directory %s', dir);
			return (cb(err));
		}

		vasync.forEachParallel({
			func: function (item, subcb) {
				var dirname = path.join(dir, item);

				sapi.readManifest(dirname, subcb);
			},
			inputs: files
		}, function (suberr, results) {
			log.info('read %d local manifests from %s',
				results.successes.length, dir);

			log.debug({ manifests: results.successes },
				'read these manifests from %s', dir);

			cb(suberr, results.successes);
		});
	});
}

/*
 * Given a list of SAPI manifests and local manifests, find the set of manifests
 * to be used for this zone's configuration.  Any local manifest with the same
 * name as a SAPI manifest will override that SAPI manifest.
 */
Agent.prototype.resolveManifests =
function resolveManifests(log, sapiManifests, localManifests) {
	assert.arrayOfObject(sapiManifests, 'sapiManifests');
	assert.arrayOfObject(localManifests, 'localManifests');

	var manifests = {};
	var paths = {};

	sapiManifests.forEach(function (manifest) {
		log.trace('using manifest "%s" from SAPI', manifest.name);
		if (paths[manifest.path] !== undefined) {
			log.warn({
				'name': manifest.name,
				'overrides': paths[manifest.path]
			}, 'path collision between sapi manifests, ' +
				'keeping the first');
			return;
		}
		manifests[manifest.name] = manifest;
		paths[manifest.path] = manifest.name;
	});

	/*
	 * If there are local manifests, use those
	 * instead of manifests provided from SAPI.
	 */
	var localPaths = {};
	localManifests.forEach(function (manifest) {
		log.trace('using manifest %s from local image', manifest.name);

		if (manifests[manifest.name] !== undefined ||
			paths[manifest.path] !== undefined) {
			var over = manifests[manifest.name];
			if (!over) {
				over = manifests[paths[manifest.path]];
			}
			log.info({
				'localName': manifest.name,
				'localPath': manifest.path,
				'sapiName': over.name,
				'sapiPath': over.path
			}, 'local manifest overriding SAPI manifest');
			delete paths[over.path];
			delete manifests[over.name];
		}

		if (localPaths[manifest.path] !== undefined) {
			log.warn({
				'name': manifest.name,
				'overrides': localPaths[manifest.path]
			}, 'path collision between local sapi manifests, ' +
				'keeping the first');
			return;
		}

		manifests[manifest.name] = manifest;
		localPaths[manifest.path] = manifest.name;
	});

	log.debug({ manifests: manifests },
		'resolved SAPI and local manifests');

	return (manifests);
};


Agent.prototype.runPostCommand = function runPostCommand(log, post_cmd, cb) {
	assert.object(log, 'log');
	assert.string(post_cmd, 'post_cmd');
	assert.func(cb, 'cb');

	log.info({post_cmd: post_cmd}, 'running post_cmd');

	exec(post_cmd, function (err, stdout, stderr) {
		if (err) {
			log.warn({
				err: err,
				stdout: stdout,
				stderr: stderr,
				post_cmd: post_cmd
			}, 'post_cmd failed');
		} else {
			log.info({
				post_cmd: post_cmd
			}, 'post_cmd ran successfully');
		}

		return (cb(err));
	});
};


/*
 * Render a configuration file from its manifest.
 */
Agent.prototype.renderConfigFile =
function renderConfigFile(log, manifest, rawMetadata, autoInstanceMetadata)
{
	var self = this;

	assert.object(log, 'log');
	assert.object(manifest, 'manifest');
	assert.string(manifest.template, 'manifest.template');
	assert.object(rawMetadata, 'rawMetadata');
	var metadata = objCopy(rawMetadata);

	Object.keys(self.localMetadata).forEach(function (key) {
		if (metadata[key]) {
			log.debug('overwriting metadata key "%s" with ' +
				'localMetadata', key);
		}
		metadata[key] = self.localMetadata[key];
	});

	var auto = jsprim.mergeObjects(self.autoMetadata, autoInstanceMetadata);
	if (metadata.auto) {
		log.warn({oldAuto: metadata.auto, newAuto: auto},
			'overwriting existing "metadata.auto" section');
	}
	metadata.auto = auto;

	var contents = null;
	try {
		contents = hogan.compile(manifest.template).render(metadata);
	} catch (e) {
		log.error('invalid hogan template: ' + e.message);
	}
	if (!contents) {
		log.error('failed to render configuration file');
	}

	manifest.contents = contents;

	log.debug('rendered manifest file contents');

	return (manifest);
};


Agent.prototype.writeConfigFile = function writeConfigFile(log, manifest, cb) {
	var self = this;

	assert.object(log, 'log');
	assert.object(manifest, 'manifest');
	assert.string(manifest.name, 'manifest.name');
	assert.string(manifest.path, 'manifest.path');
	assert.string(manifest.contents, 'manifest.contents');
	assert.func(cb, 'cb');

	var contents = manifest.contents;
	var existing = null;

	async.waterfall([
		function (subcb) {
			var dirname = path.dirname(manifest.path);

			log.debug('mkdir -p %s', dirname);

			mkdirp(dirname, function (err) {
				if (err) {
					log.warn(err, 'failed to mkdir -p %s',
						dirname);
				}

				subcb(null);
			});
		},
		function (subcb) {
			fs.readFile(manifest.path, 'ascii',
			function (err, file) {
				if (err) {
					log.warn(err, 'failed to read file %s',
						manifest.path);
					return (subcb(null));
				}

				existing = file;
				return (subcb(null));
			});
		},
		function (subcb) {
			if (existing && contents === existing) {
				log.debug('file %s unchanged; not updating ' +
					'file', manifest.path);
				return (subcb(null, false));
			}

			log.info({
				path: manifest.path,
				updated: contents,
				existing: existing
			}, 'writing updated file');

			fs.writeFile(manifest.path, contents, function (err) {
				if (err) {
					log.error(err, 'failed to write ' +
						'file %s', manifest.path);
					return (subcb(err));
				}

				log.info('updated file %s', manifest.path);

				return (subcb(null, true));
			});

			return (null);
		},
		function (updated, subcb) {
			assert.bool(updated, 'updated');
			assert.func(subcb, 'subcb');

			if (!updated) {
				return (subcb(null));
			}

			if (!manifest.post_cmd) {
				log.trace('no post_cmd');
				return (subcb(null));
			}

			self.runPostCommand(log, manifest.post_cmd,
			function (err) {
				/*
				 * If the post command fails, it's not a fatal
				 * error.  The failure will be logged in the
				 * runPostCommand() function.
				 */
				subcb(null);
			});
			return (null);
		}
	], function (err) {
		if (err) {
			log.error(err, 'failed to update file for manifest %s',
				manifest.name);
			return (cb(err));
		}

		return (cb(null));
	});
};

module.exports = Agent;
/* vim: set noet sw=4 sts=4 ts=4: */
