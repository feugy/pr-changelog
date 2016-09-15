"use strict";

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

require("babel-polyfill");

var Promise = require("bluebird");
var GithubApi = require('github');
var moment = require('moment');
var paginator = require('./paginator');
var spawnSync = require('child_process').spawnSync;

var _require = require('./utils');

var filter = _require.filter;
var clone = _require.clone;

var Logger = require('./logger');

function authenticate() {
  var _ref = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

  var host = _ref.host;
  var pathPrefix = _ref.pathPrefix;

  var opts = {
    timeout: 10000,
    protocol: 'https'
  };
  if (host) {
    opts.pathPrefix = pathPrefix || '/api/v3';
    opts.host = host;
  }

  var github = new GithubApi(opts);

  Promise.promisifyAll(github.repos);
  Promise.promisifyAll(github.issues);
  Promise.promisifyAll(github.pullRequests);

  github.authenticate({
    type: "oauth",
    token: process.env['GITHUB_ACCESS_TOKEN']
  });

  return github;
}

/*
  Commits
*/

// Get the tag diff locally
function getCommitDiffLocal(_ref2) {
  var owner = _ref2.owner;
  var repo = _ref2.repo;
  var base = _ref2.base;
  var head = _ref2.head;
  var localClone = _ref2.localClone;

  var gitDirParams = ['--git-dir', localClone + "/.git", '--work-tree', localClone];

  var remote = spawnSync('git', gitDirParams.concat(['config', '--get', 'remote.origin.url'])).stdout.toString();
  if (remote.indexOf(":" + owner + "/" + repo + ".git") < 0 || remote.indexOf("/" + owner + "/" + repo + ".git") < 0) return null;

  var commitRegex = /([\da-f]+) ([\d]+) (.+)/;
  var commitStrings = spawnSync('git', gitDirParams.concat(['log', '--format="%H %ct %s"', base + "..." + head])).stdout.toString().trim().split('\n');
  var commits = commitStrings.map(function (commitString) {
    var match = commitString.match(commitRegex);
    if (match) {
      var _match = _slicedToArray(match, 4);

      var __ = _match[0];
      var sha = _match[1];
      var timestamp = _match[2];
      var summary = _match[3];

      return { sha: sha, summary: summary, date: moment.unix(timestamp) };
    }
    return null;
  });

  return formatCommits(commits);
}

// This will only return 250 commits when using the API
function getCommitDiff(_ref3) {
  var owner = _ref3.owner;
  var repo = _ref3.repo;
  var base = _ref3.base;
  var head = _ref3.head;
  var localClone = _ref3.localClone;
  var gitOpts = _ref3.gitOpts;
  var commits, github, options, compareView;
  return regeneratorRuntime.async(function getCommitDiff$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          commits = void 0;

          if (!localClone) {
            _context.next = 9;
            break;
          }

          commits = getCommitDiffLocal({ owner: owner, repo: repo, base: base, head: head, localClone: localClone, gitOpts: gitOpts });

          if (!commits) {
            _context.next = 8;
            break;
          }

          Logger.log('Found', commits.length, 'local commits');
          return _context.abrupt("return", commits);

        case 8:
          Logger.warn("Cannot fetch local commit diff, cannot find local copy of " + owner + "/" + repo);

        case 9:
          github = authenticate(gitOpts);
          options = {
            user: owner,
            repo: repo,
            base: base,
            head: head
          };
          _context.next = 13;
          return regeneratorRuntime.awrap(github.repos.compareCommitsAsync(options));

        case 13:
          compareView = _context.sent;

          Logger.log('Found', compareView.commits.length, 'commits from the GitHub API');
          return _context.abrupt("return", formatCommits(compareView.commits));

        case 16:
        case "end":
          return _context.stop();
      }
    }
  }, null, this);
}

function formatCommits(commits) {
  var commitsResult = [];
  var shas = {};
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = commits[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var commit = _step.value;

      if (!commit) continue;
      if (shas[commit.sha]) continue;
      shas[commit.sha] = true;
      if (commit.summary) commitsResult.push(commit);else commitsResult.push({
        sha: commit.sha,
        summary: commit.commit.message.split('\n')[0],
        message: commit.commit.message,
        date: moment(commit.commit.committer.date),
        author: commit.commit.author.name
      });
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator.return) {
        _iterator.return();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }

  commitsResult.sort(function (a, b) {
    if (a.date.isBefore(b.date)) return -1;else if (b.date.isBefore(a.date)) return 1;
    return 0;
  });
  return commitsResult;
}

/*
  Pull Requests
*/

function getPullRequest(_ref4) {
  var owner = _ref4.owner;
  var repo = _ref4.repo;
  var number = _ref4.number;
  var gitOpts = _ref4.gitOpts;
  var github;
  return regeneratorRuntime.async(function getPullRequest$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          github = authenticate(gitOpts);
          _context2.prev = 1;
          _context2.next = 4;
          return regeneratorRuntime.awrap(github.pullRequests.getAsync({
            user: owner,
            repo: repo,
            number: number
          }));

        case 4:
          return _context2.abrupt("return", _context2.sent);

        case 7:
          _context2.prev = 7;
          _context2.t0 = _context2["catch"](1);

          Logger.warn('Cannot find PR', owner + "/" + repo + "#" + number, _context2.t0.code, _context2.t0.message);
          return _context2.abrupt("return", null);

        case 11:
        case "end":
          return _context2.stop();
      }
    }
  }, null, this, [[1, 7]]);
}

function getPullRequestsBetweenDates(_ref5) {
  var owner = _ref5.owner;
  var repo = _ref5.repo;
  var fromDate = _ref5.fromDate;
  var toDate = _ref5.toDate;
  var gitOpts = _ref5.gitOpts;
  var github, options, mergedPRs;
  return regeneratorRuntime.async(function getPullRequestsBetweenDates$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          github = authenticate(gitOpts);
          options = {
            user: owner,
            repo: repo,
            state: 'closed',
            sort: 'updated',
            direction: 'desc'
          };
          _context3.next = 4;
          return regeneratorRuntime.awrap(paginator(options, function (options) {
            return github.pullRequests.getAllAsync(options);
          }, function (prs) {
            prs = filter(prs, function (pr) {
              return !!pr.merged_at;
            });
            if (prs.length == 0) return prs;

            prs = filter(prs, function (pr) {
              return fromDate.isBefore(moment(pr.merged_at));
            });

            // stop pagination when there are no PRs earlier than this
            if (prs.length == 0) return null;

            return prs;
          }));

        case 4:
          mergedPRs = _context3.sent;


          mergedPRs = filter(mergedPRs, function (pr) {
            return toDate.isAfter(moment(pr.merged_at));
          });

          return _context3.abrupt("return", formatPullRequests(mergedPRs));

        case 7:
        case "end":
          return _context3.stop();
      }
    }
  }, null, this);
}

function filterPullRequestCommits(commits) {
  var prRegex = /Merge pull request #(\d+)/;
  var filteredCommits = [];

  var _iteratorNormalCompletion2 = true;
  var _didIteratorError2 = false;
  var _iteratorError2 = undefined;

  try {
    for (var _iterator2 = commits[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
      var commit = _step2.value;

      var match = commit.summary.match(prRegex);
      if (!match) continue;

      // TODO: not ideal jamming these properties on the object
      commit.prNumber = match[1];
      filteredCommits.push(commit);
    }
  } catch (err) {
    _didIteratorError2 = true;
    _iteratorError2 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion2 && _iterator2.return) {
        _iterator2.return();
      }
    } finally {
      if (_didIteratorError2) {
        throw _iteratorError2;
      }
    }
  }

  return filteredCommits;
}

function formatPullRequests(pullRequests) {
  var pullRequestsResult = [];
  var _iteratorNormalCompletion3 = true;
  var _didIteratorError3 = false;
  var _iteratorError3 = undefined;

  try {
    for (var _iterator3 = pullRequests[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
      var pullRequest = _step3.value;

      if (pullRequest.htmlURL) pullRequestsResult.push(pullRequest);else pullRequestsResult.push({
        number: pullRequest.number,
        title: pullRequest.title,
        htmlURL: pullRequest.html_url,
        mergedAt: moment(pullRequest.merged_at),
        author: pullRequest.user.login,
        repoName: pullRequest.base.repo.full_name
      });
    }
  } catch (err) {
    _didIteratorError3 = true;
    _iteratorError3 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion3 && _iterator3.return) {
        _iterator3.return();
      }
    } finally {
      if (_didIteratorError3) {
        throw _iteratorError3;
      }
    }
  }

  pullRequestsResult.sort(function (a, b) {
    if (a.mergedAt.isBefore(b.mergedAt)) return -1;else if (b.mergedAt.isBefore(a.mergedAt)) return 1;
    return 0;
  });
  return pullRequestsResult;
}

function pullRequestsToString(pullRequests) {
  var pullRequestStrings = [];
  var _iteratorNormalCompletion4 = true;
  var _didIteratorError4 = false;
  var _iteratorError4 = undefined;

  try {
    for (var _iterator4 = pullRequests[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
      var pullRequest = _step4.value;

      pullRequestStrings.push("* [" + pullRequest.repoName + "#" + pullRequest.number + " - " + pullRequest.title + "](" + pullRequest.htmlURL + ")");
    }
  } catch (err) {
    _didIteratorError4 = true;
    _iteratorError4 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion4 && _iterator4.return) {
        _iterator4.return();
      }
    } finally {
      if (_didIteratorError4) {
        throw _iteratorError4;
      }
    }
  }

  return pullRequestStrings.join('\n');
}

function defaultChangelogFormatter(_ref6) {
  var pullRequests = _ref6.pullRequests;
  var owner = _ref6.owner;
  var repo = _ref6.repo;
  var fromTag = _ref6.fromTag;
  var toTag = _ref6.toTag;
  var gitOpts = _ref6.gitOpts;

  var changelog = pullRequestsToString(pullRequests);
  var title = repo;
  if (repo == 'atom') title = 'Atom Core';
  var host = gitOpts.host || 'github.com';
  return "### [" + title + "](https://" + host + "/" + owner + "/" + repo + ")\n\n" + fromTag + "..." + toTag + "\n\n" + changelog;
}

function getFormattedPullRequests(_ref7) {
  var owner = _ref7.owner;
  var repo = _ref7.repo;
  var fromTag = _ref7.fromTag;
  var toTag = _ref7.toTag;
  var localClone = _ref7.localClone;
  var changelogFormatter = _ref7.changelogFormatter;
  var gitOpts = _ref7.gitOpts;

  var commits, firstCommit, lastCommit, fromDate, toDate, pullRequests, prCommits, filteredPullRequests, pullRequestsByNumber, _iteratorNormalCompletion5, _didIteratorError5, _iteratorError5, _iterator5, _step5, pr, _iteratorNormalCompletion6, _didIteratorError6, _iteratorError6, _iterator6, _step6, commit, pullRequest;

  return regeneratorRuntime.async(function getFormattedPullRequests$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          Logger.log('\nComparing', owner + "/" + repo, fromTag + "..." + toTag);
          if (localClone) Logger.log('Local clone of repo', localClone);

          if (changelogFormatter) {
            _context4.next = 5;
            break;
          }

          Logger.warn('A `changelogFormatter` must be specified!');
          return _context4.abrupt("return", '');

        case 5:
          _context4.next = 7;
          return regeneratorRuntime.awrap(getCommitDiff({
            owner: owner,
            repo: repo,
            gitOpts: gitOpts,
            base: fromTag,
            head: toTag,
            localClone: localClone
          }));

        case 7:
          commits = _context4.sent;

          if (!(commits.length == 0)) {
            _context4.next = 10;
            break;
          }

          return _context4.abrupt("return", '');

        case 10:
          firstCommit = commits[0];
          lastCommit = commits[commits.length - 1];
          fromDate = firstCommit.date;
          toDate = lastCommit.date;


          Logger.log("Fetching PRs between dates", fromDate.toISOString(), toDate.toISOString());
          _context4.next = 17;
          return regeneratorRuntime.awrap(getPullRequestsBetweenDates({
            owner: owner,
            repo: repo,
            gitOpts: gitOpts,
            fromDate: fromDate,
            toDate: toDate
          }));

        case 17:
          pullRequests = _context4.sent;

          Logger.log("Found", pullRequests.length, "merged PRs");

          prCommits = filterPullRequestCommits(commits);
          filteredPullRequests = [];
          pullRequestsByNumber = {};
          _iteratorNormalCompletion5 = true;
          _didIteratorError5 = false;
          _iteratorError5 = undefined;
          _context4.prev = 25;


          for (_iterator5 = pullRequests[Symbol.iterator](); !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
            pr = _step5.value;

            pullRequestsByNumber[pr.number] = pr;
          }_context4.next = 33;
          break;

        case 29:
          _context4.prev = 29;
          _context4.t0 = _context4["catch"](25);
          _didIteratorError5 = true;
          _iteratorError5 = _context4.t0;

        case 33:
          _context4.prev = 33;
          _context4.prev = 34;

          if (!_iteratorNormalCompletion5 && _iterator5.return) {
            _iterator5.return();
          }

        case 36:
          _context4.prev = 36;

          if (!_didIteratorError5) {
            _context4.next = 39;
            break;
          }

          throw _iteratorError5;

        case 39:
          return _context4.finish(36);

        case 40:
          return _context4.finish(33);

        case 41:
          _iteratorNormalCompletion6 = true;
          _didIteratorError6 = false;
          _iteratorError6 = undefined;
          _context4.prev = 44;
          _iterator6 = prCommits[Symbol.iterator]();

        case 46:
          if (_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done) {
            _context4.next = 64;
            break;
          }

          commit = _step6.value;

          if (!pullRequestsByNumber[commit.prNumber]) {
            _context4.next = 52;
            break;
          }

          filteredPullRequests.push(pullRequestsByNumber[commit.prNumber]);
          _context4.next = 61;
          break;

        case 52:
          if (!(fromDate.toISOString() == toDate.toISOString())) {
            _context4.next = 60;
            break;
          }

          Logger.log('PR', commit.prNumber, 'not in date range, fetching explicitly');
          _context4.next = 56;
          return regeneratorRuntime.awrap(getPullRequest({ owner: owner, repo: repo, gitOpts: gitOpts, number: commit.prNumber }));

        case 56:
          pullRequest = _context4.sent;

          if (pullRequest) filteredPullRequests.push(pullRequest);else Logger.warn('PR #', commit.prNumber, 'not found! Commit text:', commit.summary);
          _context4.next = 61;
          break;

        case 60:
          Logger.log('PR', commit.prNumber, 'not in date range, likely a merge commit from a fork-to-fork PR');

        case 61:
          _iteratorNormalCompletion6 = true;
          _context4.next = 46;
          break;

        case 64:
          _context4.next = 70;
          break;

        case 66:
          _context4.prev = 66;
          _context4.t1 = _context4["catch"](44);
          _didIteratorError6 = true;
          _iteratorError6 = _context4.t1;

        case 70:
          _context4.prev = 70;
          _context4.prev = 71;

          if (!_iteratorNormalCompletion6 && _iterator6.return) {
            _iterator6.return();
          }

        case 73:
          _context4.prev = 73;

          if (!_didIteratorError6) {
            _context4.next = 76;
            break;
          }

          throw _iteratorError6;

        case 76:
          return _context4.finish(73);

        case 77:
          return _context4.finish(70);

        case 78:

          pullRequests = formatPullRequests(filteredPullRequests);

          if (!pullRequests.length) {
            _context4.next = 83;
            break;
          }

          return _context4.abrupt("return", changelogFormatter({
            owner: owner,
            repo: repo,
            fromTag: fromTag,
            toTag: toTag,
            pullRequests: pullRequests,
            gitOpts: gitOpts
          }));

        case 83:
          return _context4.abrupt("return", '');

        case 84:
        case "end":
          return _context4.stop();
      }
    }
  }, null, this, [[25, 29, 33, 41], [34,, 36, 40], [44, 66, 70, 78], [71,, 73, 77]]);
}

/*
  Generating changelog from child packages
*/

function getFormattedPullRequestsForDependencies(_ref8) {
  var owner = _ref8.owner;
  var repo = _ref8.repo;
  var fromTag = _ref8.fromTag;
  var toTag = _ref8.toTag;
  var dependencyKey = _ref8.dependencyKey;
  var changelogFormatter = _ref8.changelogFormatter;
  var gitOpts = _ref8.gitOpts;

  var options, fromRefContent, toRefContent, changedDependencies, resultList, contentOptions, getContent, getDependencies, getChangedDependencies, github, packageName, _changedDependencies$, fromRef, toRef, formattedPR;

  return regeneratorRuntime.async(function getFormattedPullRequestsForDependencies$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          getChangedDependencies = function getChangedDependencies(fromPackageJSONStr, toPackageJSONStr) {
            var changedDependencies = {};
            var fromDeps = getDependencies(fromPackageJSONStr);
            var toDeps = getDependencies(toPackageJSONStr);

            for (var packageName in fromDeps) {
              if (fromDeps[packageName] != toDeps[packageName]) {
                changedDependencies[packageName] = {
                  // Tags are prefixed with the `v`, not an ideal solution
                  fromRef: fromDeps[packageName] ? "v" + fromDeps[packageName] : null,
                  toRef: toDeps[packageName] ? "v" + toDeps[packageName] : null
                };
              }
            }

            return changedDependencies;
          };

          getDependencies = function getDependencies(packageJSON) {
            var json = JSON.parse(packageJSON);
            return json[dependencyKey];
          };

          getContent = function getContent(results) {
            return new Buffer(results.content, results.encoding).toString('utf-8');
          };

          options = void 0, fromRefContent = void 0, toRefContent = void 0, changedDependencies = void 0;
          resultList = [];
          contentOptions = {
            user: owner,
            repo: repo,
            path: 'package.json'
          };


          Logger.log("\nGenerating dependency changelog for '" + dependencyKey + "' on " + owner + "/" + repo);

          // get old package.json
          github = authenticate(gitOpts);

          options = clone(contentOptions);
          options.ref = fromTag;
          fromRefContent = github.repos.getContentAsync(options);

          // get new package.json
          github = authenticate(gitOpts);
          options = clone(contentOptions);
          options.ref = toTag;
          toRefContent = github.repos.getContentAsync(options);

          _context5.prev = 15;
          _context5.next = 18;
          return regeneratorRuntime.awrap(fromRefContent);

        case 18:
          _context5.t0 = _context5.sent;
          fromRefContent = getContent(_context5.t0);
          _context5.next = 22;
          return regeneratorRuntime.awrap(toRefContent);

        case 22:
          _context5.t1 = _context5.sent;
          toRefContent = getContent(_context5.t1);
          _context5.next = 30;
          break;

        case 26:
          _context5.prev = 26;
          _context5.t2 = _context5["catch"](15);

          Logger.log("Cannot get package.json content:", _context5.t2.message || _context5.t2);
          return _context5.abrupt("return", '');

        case 30:

          changedDependencies = getChangedDependencies(fromRefContent, toRefContent);
          _context5.t3 = regeneratorRuntime.keys(changedDependencies);

        case 32:
          if ((_context5.t4 = _context5.t3()).done) {
            _context5.next = 44;
            break;
          }

          packageName = _context5.t4.value;
          _changedDependencies$ = changedDependencies[packageName];
          fromRef = _changedDependencies$.fromRef;
          toRef = _changedDependencies$.toRef;

          if (!(fromRef && toRef)) {
            _context5.next = 42;
            break;
          }

          _context5.next = 40;
          return regeneratorRuntime.awrap(getFormattedPullRequests({
            owner: owner,
            repo: packageName,
            fromTag: fromRef,
            toTag: toRef,
            changelogFormatter: changelogFormatter,
            gitOpts: gitOpts
          }));

        case 40:
          formattedPR = _context5.sent;

          if (formattedPR) resultList.push(formattedPR);

        case 42:
          _context5.next = 32;
          break;

        case 44:
          return _context5.abrupt("return", resultList.join('\n\n'));

        case 45:
        case "end":
          return _context5.stop();
      }
    }
  }, null, this, [[15, 26]]);
}

function getChangelog(options) {
  var mainPackageChangelog, childrenChangelog, results;
  return regeneratorRuntime.async(function getChangelog$(_context6) {
    while (1) {
      switch (_context6.prev = _context6.next) {
        case 0:
          mainPackageChangelog = void 0, childrenChangelog = void 0, results = void 0;

          // These could be done in parallel, but serially threads the log messages nicely

          _context6.next = 3;
          return regeneratorRuntime.awrap(getFormattedPullRequests(options));

        case 3:
          mainPackageChangelog = _context6.sent;

          if (!options.dependencyKey) {
            _context6.next = 8;
            break;
          }

          _context6.next = 7;
          return regeneratorRuntime.awrap(getFormattedPullRequestsForDependencies(options));

        case 7:
          childrenChangelog = _context6.sent;

        case 8:

          results = [mainPackageChangelog];
          if (childrenChangelog) results.push(childrenChangelog);

          return _context6.abrupt("return", results.join('\n\n'));

        case 11:
        case "end":
          return _context6.stop();
      }
    }
  }, null, this);
}

module.exports = {
  getChangelog: getChangelog,
  pullRequestsToString: pullRequestsToString,
  defaultChangelogFormatter: defaultChangelogFormatter
};