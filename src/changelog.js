require("babel-polyfill")

let Promise = require("bluebird")
let GithubApi = require('github')
let moment = require('moment')
let paginator = require('./paginator')
let spawnSync = require('child_process').spawnSync;
let {filter, clone} = require('./utils')
let Logger = require('./logger')

let github = new GithubApi({
  version: '3.0.0',
  timeout: 10000,
  protocol: 'https'
});

Promise.promisifyAll(github.repos);
Promise.promisifyAll(github.issues);
Promise.promisifyAll(github.pullRequests);

function authenticate() {
  github.authenticate({
    type: "oauth",
    token: process.env['GITHUB_ACCESS_TOKEN']
  });
}

/*
  Commits
*/

// Get the tag diff locally
function getCommitDiffLocal({owner, repo, base, head, localClone}) {
  let gitDirParams = ['--git-dir', `${localClone}/.git`, '--work-tree', localClone]

  let remote = spawnSync('git', gitDirParams.concat(['config', '--get', 'remote.origin.url'])).stdout.toString()
  if (remote.indexOf(`:${owner}/${repo}.git`) < 0)
    return null

  let commitRegex = /([\da-f]+) ([\d]+) (.+)/
  let commitStrings = spawnSync('git', gitDirParams.concat(['log', '--format="%H %ct %s"', `${base}...${head}`])).stdout.toString().trim().split('\n')
  let commits = commitStrings.map((commitString) => {
    let match = commitString.match(commitRegex)
    let [__, sha, timestamp, summary] = match
    return {sha: sha, summary: summary, date: moment.unix(timestamp)}
  })

  return formatCommits(commits)
}

// This will only return 250 commits when using the API
async function getCommitDiff({owner, repo, base, head, localClone}) {
  let commits
  if (localClone) {
    commits = getCommitDiffLocal({owner, repo, base, head, localClone})
    if (commits) {
      Logger.log('Found', commits.length, 'local commits');
      return commits
    }
    else
      Logger.warn(`Cannot fetch local commit diff, cannot find local copy of ${owner}/${repo}`);
  }

  authenticate()
  let options = {
    user: owner,
    repo: repo,
    base: base,
    head: head
  }

  let compareView = await github.repos.compareCommitsAsync(options)
  Logger.log('Found', compareView.commits.length, 'commits from the GitHub API');
  return formatCommits(compareView.commits)
}

function formatCommits(commits) {
  let commitsResult = []
  let shas = {}
  for (let commit of commits) {
    if (shas[commit.sha]) continue;
    shas[commit.sha] = true
    if (commit.summary)
      commitsResult.push(commit)
    else
      commitsResult.push({
        sha: commit.sha,
        summary: commit.commit.message.split('\n')[0],
        message: commit.commit.message,
        date: moment(commit.commit.committer.date),
        author: commit.commit.author.name
      })
  }
  commitsResult.sort((a, b) => {
    if (a.date.isBefore(b.date))
      return -1
    else if (b.date.isBefore(a.date))
      return 1
    return 0
  })
  return commitsResult
}

/*
  Pull Requests
*/

async function getPullRequestsBetweenDates({owner, repo, fromDate, toDate}) {
  authenticate()
  let options = {
    user: owner,
    repo: repo,
    state: 'closed',
    sort: 'updated',
    direction: 'desc'
  }

  let mergedPRs = await paginator(options, (options) => {
    return github.pullRequests.getAllAsync(options)
  }, (prs) => {
    prs = filter(prs, (pr) => {
      return !!pr.merged_at
    })
    if (prs.length == 0) return prs

    prs = filter(prs, (pr) => {
      return fromDate.isBefore(moment(pr.merged_at))
    })

    // stop pagination when there are no PRs earlier than this
    if (prs.length == 0) return null

    return prs
  })

  mergedPRs = filter(mergedPRs, (pr) => {
    return toDate.isAfter(moment(pr.merged_at))
  })

  return formatPullRequests(mergedPRs)
}

function filterPullRequestsByCommits(pullRequests, commits) {
  let prRegex = /Merge pull request #(\d+)/
  let filteredPullRequests = []
  let pullRequestsByNumber = {}

  for (let pr of pullRequests) {
    pullRequestsByNumber[pr.number] = pr
  }

  for (let commit of commits) {
    let match = commit.summary.match(prRegex)
    if (!match) continue;

    let prNumber = match[1]
    if (pullRequestsByNumber[prNumber])
      filteredPullRequests.push(pullRequestsByNumber[prNumber])
    else
      Logger.log('No PR found for', prNumber, '; Commit text:', commit.summary);
  }

  return formatPullRequests(filteredPullRequests)
}

function formatPullRequests(pullRequests) {
  let pullRequestsResult = []
  for (let pullRequest of pullRequests) {
    if (pullRequest.htmlURL)
      pullRequestsResult.push(pullRequest)
    else
      pullRequestsResult.push({
        number: pullRequest.number,
        title: pullRequest.title,
        htmlURL: pullRequest.html_url,
        mergedAt: moment(pullRequest.merged_at),
        author: pullRequest.user.login,
        repoName: pullRequest.base.repo.full_name
      })
  }
  pullRequestsResult.sort((a, b) => {
    if (a.mergedAt.isBefore(b.mergedAt))
      return -1
    else if (b.mergedAt.isBefore(a.mergedAt))
      return 1
    return 0
  })
  return pullRequestsResult
}

function pullRequestsToString(pullRequests) {
  let pullRequestStrings = []
  for (let pullRequest of pullRequests) {
    pullRequestStrings.push(`* [${pullRequest.repoName}#${pullRequest.number} - ${pullRequest.title}](${pullRequest.htmlURL})`)
  }
  return pullRequestStrings.join('\n')
}

function defaultChangelogFormatter({pullRequests, owner, repo, fromTag, toTag}) {
  let changelog = pullRequestsToString(pullRequests)
  let title = repo
  if (repo == 'atom')
    title = 'Atom Core'
  return `### [${title}](https://github.com/${owner}/${repo})\n\n${fromTag}...${toTag}\n\n${changelog}`
}

async function getFormattedPullRequests({owner, repo, fromTag, toTag, localClone, changelogFormatter}) {
  Logger.log('\nComparing', `${owner}/${repo}`, `${fromTag}...${toTag}`);
  if (localClone) Logger.log('Local clone of repo', localClone);

  if (!changelogFormatter) {
    Logger.warn('A `changelogFormatter` must be specified!')
    return ''
  }

  let commits = await getCommitDiff({
    owner: owner,
    repo: repo,
    base: fromTag,
    head: toTag,
    localClone: localClone
  })
  let firstCommit = commits[0]
  let lastCommit = commits[commits.length - 1]
  let fromDate = firstCommit.date
  let toDate = lastCommit.date

  Logger.log("Fetching PRs between dates", fromDate.toISOString(), toDate.toISOString());
  let pullRequests = await getPullRequestsBetweenDates({
    owner: owner,
    repo: repo,
    fromDate: fromDate,
    toDate: toDate
  })
  Logger.log("Found", pullRequests.length, "merged PRs");

  pullRequests = filterPullRequestsByCommits(pullRequests, commits)

  if (pullRequests.length) {
    return changelogFormatter({
      owner: owner,
      repo: repo,
      fromTag: fromTag,
      toTag: toTag,
      pullRequests: pullRequests
    })
  }
  else
    return ''
}

/*
  Generating changelog from child packages
*/

async function getFormattedPullRequestsForDependencies({owner, repo, fromTag, toTag, dependencyKey, changelogFormatter}) {
  let options, fromRefContent, toRefContent, changedDependencies
  let resultList = []
  let contentOptions = {
    user: owner,
    repo: repo,
    path: 'package.json'
  }

  Logger.log(`\nGenerating dependency changelog for '${dependencyKey}' on ${owner}/${repo}`)

  function getContent(results) {
    return new Buffer(results.content, results.encoding).toString('utf-8')
  }

  function getDependencies(packageJSON) {
    let json = JSON.parse(packageJSON)
    return json[dependencyKey]
  }

  function getChangedDependencies(fromPackageJSONStr, toPackageJSONStr) {
    let changedDependencies = {}
    let fromDeps = getDependencies(fromPackageJSONStr)
    let toDeps = getDependencies(toPackageJSONStr)

    for (let packageName in fromDeps) {
      if (fromDeps[packageName] != toDeps[packageName]) {
        changedDependencies[packageName] = {
          // Tags are prefixed with the `v`, not an ideal solution
          fromRef: `v${fromDeps[packageName]}`,
          toRef: `v${toDeps[packageName]}`
        }
      }
    }

    return changedDependencies
  }

  authenticate()
  options = clone(contentOptions)
  options.ref = fromTag
  fromRefContent = github.repos.getContentAsync(options)

  authenticate()
  options = clone(contentOptions)
  options.ref = toTag
  toRefContent = github.repos.getContentAsync(options)

  try {
    fromRefContent = getContent(await fromRefContent)
    toRefContent = getContent(await toRefContent)
  }
  catch (e) {
    Logger.log("Cannot get package.json content:", e.message || e)
    return ''
  }

  changedDependencies = getChangedDependencies(fromRefContent, toRefContent)
  for (let packageName in changedDependencies) {
    let {fromRef, toRef} = changedDependencies[packageName]
    let formattedPR = await getFormattedPullRequests({
      owner: owner,
      repo: packageName,
      fromTag: fromRef,
      toTag: toRef,
      changelogFormatter: changelogFormatter
    })
    if (formattedPR) resultList.push(formattedPR)
  }

  return resultList.join('\n\n')
}

async function getChangelog(options) {
  let mainPackageChangelog, childrenChangelog, results

  // These could be done in parallel, but serially threads the log messages nicely
  mainPackageChangelog = await getFormattedPullRequests(options)
  if (options.dependencyKey)
    childrenChangelog = await getFormattedPullRequestsForDependencies(options)

  results = [mainPackageChangelog]
  if (childrenChangelog) results.push(childrenChangelog)

  return results.join('\n\n')
}

module.exports = {
  getChangelog: getChangelog,
  pullRequestsToString: pullRequestsToString,
  defaultChangelogFormatter: defaultChangelogFormatter
}
