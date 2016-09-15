#! /usr/bin/env node
'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var expandHomeDir = require('expand-home-dir');
var Changelog = require('./changelog');
var Logger = require('./logger');
var argv = require('yargs').usage('Usage: $0 [options] <baseTag>...<headTag>').alias('r', 'repo').describe('r', 'Repository e.g. atom/atom').default('r', 'atom/atom').alias('l', 'local-clone').describe('l', 'Path to local clone of repository').boolean('P').alias('P', 'packages').describe('P', 'Generate changelog for the changed packages. Uses `packageDependencies` package.json key').boolean('v').alias('v', 'verbose').describe('v', 'Verbose').alias('H', 'host').describe('H', 'If using private Enterprise Github, host. Might require a path-prefix').describe('path-prefix', 'API path prefix used if reaching a private Enterprise Github, default to /api/v3').help('h').alias('h', 'help').demand(1).argv;

Logger.setVerbose(argv.verbose);

var spanRegex = /(.+)(?:[\.]{3})(.+)/;
var repoRegex = /([^\/]+)\/([^\/]+)/;

var _spanRegex$exec = spanRegex.exec(argv._[0]);

var _spanRegex$exec2 = _slicedToArray(_spanRegex$exec, 3);

var __ = _spanRegex$exec2[0];
var fromTag = _spanRegex$exec2[1];
var toTag = _spanRegex$exec2[2];

var _repoRegex$exec = repoRegex.exec(argv.repo);

var _repoRegex$exec2 = _slicedToArray(_repoRegex$exec, 3);

var ___ = _repoRegex$exec2[0];
var owner = _repoRegex$exec2[1];
var repo = _repoRegex$exec2[2];

var localClone = expandHomeDir(argv.localClone);
var dependencyKey = argv.packages ? 'packageDependencies' : null;

Changelog.getChangelog({
  owner: owner,
  repo: repo,
  fromTag: fromTag,
  toTag: toTag,
  localClone: localClone,
  dependencyKey: dependencyKey,
  changelogFormatter: Changelog.defaultChangelogFormatter,
  gitOpts: { host: argv.host, pathPrefix: argv['path-prefix'] }
}).then(function (output) {
  console.log(output);
}).catch(function (err) {
  console.error('error', err.stack || err);
});