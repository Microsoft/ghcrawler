// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const expect = require('chai').expect;
const GitHubProcessor = require('../lib/githubProcessor.js');
const Q = require('q');
const Request = require('../lib/request.js');
const sinon = require('sinon');
const testHelpers = require('./processorTestHelpers');
const TraversalPolicy = require('../lib/traversalPolicy');

const expectLinks = testHelpers.expectLinks;
const expectQueued = testHelpers.expectQueued;

describe('GitHubProcessor reprocessing', () => {
  it('will skip if at same version', () => {
    const processor = new GitHubProcessor();
    const request = new Request('user', 'http://test.com/users/user1');
    request.policy.freshness = 'version';
    request.document = { _metadata: { version: processor.version } };
    const result = processor.canHandle(request);
    expect(result).to.be.equal(false);
  });

  it('will skip and warn if at greater version', () => {
    const processor = new GitHubProcessor();
    const request = new Request('user', 'http://test.com/users/user1');
    request.policy.freshness = 'version';
    request.document = { _metadata: { version: processor.version + 1 } };
    const result = processor.canHandle(request);
    expect(result).to.be.equal(false);
  });

  it('will process and update if at lesser version', () => {
    const processor = new GitHubProcessor();
    const request = new Request('user', 'http://test.com/users/user1');
    request.fetch = 'none';
    request.document = { _metadata: { version: processor.version - 1 } };
    sinon.stub(processor, 'user', () => { return request.document; });
    const document = processor.process(request);
    expect(processor.user.callCount).to.be.equal(1);
    expect(document._metadata.version).to.be.equal(processor.version);
  });
});

describe('Collection processing', () => {
  it('should queue collection pages as deepShallow and elements as deepShallow', () => {
    const request = new Request('issues', 'http://test.com/issues', { elementType: 'issue' });
    request.policy.transitivity = 'deepShallow';
    request.response = {
      headers: { link: createLinkHeader(request.url, null, 2, 2) }
    };
    request.document = { _metadata: { links: {} }, elements: [{ type: 'issue', url: 'http://child1' }] };
    request.crawler = { queue: () => { }, queues: { push: () => { } } };
    sinon.spy(request.crawler, 'queue');
    const push = sinon.spy(request.crawler.queues, 'push');
    const processor = new GitHubProcessor();

    processor.process(request);

    expect(request.crawler.queues.push.callCount).to.be.equal(1);
    expect(push.getCall(0).args[1]).to.be.equal('soon');
    const newPages = request.crawler.queues.push.getCall(0).args[0];
    expect(newPages.length).to.be.equal(1);
    expect(newPages[0].policy.transitivity).to.be.equal('deepShallow');
    expect(newPages[0].url).to.be.equal('http://test.com/issues?page=2&per_page=100');
    expect(newPages[0].type).to.be.equal('issues');

    expect(request.crawler.queue.callCount).to.be.equal(1);
    const newRequest = request.crawler.queue.getCall(0).args[0];
    expect(newRequest.policy.transitivity).to.be.equal('deepShallow');
    expect(newRequest.url).to.be.equal('http://child1');
    expect(newRequest.type).to.be.equal('issue');
  });

  it('should queue deepShallow root collections as deepShallow and elements as shallow', () => {
    const request = new Request('orgs', 'http://test.com/orgs', { elementType: 'org' });
    request.policy.transitivity = 'deepShallow';
    request.response = {
      headers: { link: createLinkHeader(request.url, null, 2, 2) }
    };
    request.document = { _metadata: { links: {} }, elements: [{ type: 'org', url: 'http://child1' }] };
    request.crawler = { queue: () => { }, queues: { push: () => { } } };
    sinon.spy(request.crawler, 'queue');
    const push = sinon.spy(request.crawler.queues, 'push');
    const processor = new GitHubProcessor();

    processor.process(request);

    expect(push.callCount).to.be.equal(1);
    expect(push.getCall(0).args[1]).to.be.equal('soon');

    const newPages = push.getCall(0).args[0];
    expect(newPages.length).to.be.equal(1);
    expect(newPages[0].policy.transitivity).to.be.equal('deepShallow');
    expect(newPages[0].url).to.be.equal('http://test.com/orgs?page=2&per_page=100');
    expect(newPages[0].type).to.be.equal('orgs');

    expect(request.crawler.queue.callCount).to.be.equal(1);
    const newRequest = request.crawler.queue.getCall(0).args[0];
    expect(newRequest.policy.transitivity).to.be.equal('shallow');
    expect(newRequest.url).to.be.equal('http://child1');
    expect(newRequest.type).to.be.equal('org');
  });

  it('should queue forceForce root collection pages as forceForce and elements as forceNormal', () => {
    const request = new Request('orgs', 'http://test.com/orgs', { elementType: 'org' });
    request.policy = TraversalPolicy.update();
    request.response = {
      headers: { link: createLinkHeader(request.url, null, 2, 2) }
    };
    request.document = { _metadata: { links: {} }, elements: [{ type: 'org', url: 'http://child1' }] };
    request.crawler = { queue: () => { }, queues: { push: () => { } } };
    sinon.spy(request.crawler, 'queue');
    const push = sinon.spy(request.crawler.queues, 'push');
    const processor = new GitHubProcessor();

    processor.process(request);

    expect(push.callCount).to.be.equal(1);
    expect(push.getCall(0).args[1]).to.be.equal('soon');
    const newPages = push.getCall(0).args[0];
    expect(newPages.length).to.be.equal(1);
    expect(newPages[0].policy.transitivity).to.be.equal('deepDeep');
    expect(newPages[0].url).to.be.equal('http://test.com/orgs?page=2&per_page=100');
    expect(newPages[0].type).to.be.equal('orgs');

    expect(request.crawler.queue.callCount).to.be.equal(1);
    const newRequest = request.crawler.queue.getCall(0).args[0];
    expect(newRequest.policy.transitivity).to.be.equal('deepShallow');
    expect(newRequest.url).to.be.equal('http://child1');
    expect(newRequest.type).to.be.equal('org');
  });

  it('should queue forceForce page elements with forceNormal transitivity', () => {
    const request = new Request('orgs', 'http://test.com/orgs?page=2&per_page=100', { elementType: 'org' });
    request.policy = TraversalPolicy.update();
    request.document = { _metadata: { links: {} }, elements: [{ url: 'http://child1' }] };
    request.crawler = { queue: () => { } };
    sinon.spy(request.crawler, 'queue');
    const processor = new GitHubProcessor();

    processor.page(2, request);
    expect(request.crawler.queue.callCount).to.be.equal(1);
    const newRequest = request.crawler.queue.getCall(0).args[0];
    expect(newRequest.policy.transitivity).to.be.equal('deepShallow');
    expect(newRequest.url).to.be.equal('http://child1');
    expect(newRequest.type).to.be.equal('org');
  });
});

describe('URN building', () => {
  it('should create urn for team members', () => {
    const request = new Request('repo', 'http://test.com/foo');
    request.document = { _metadata: { links: {} }, id: 42, owner: { url: 'http://test.com/test' }, teams_url: 'http://test.com/teams', issues_url: 'http://test.com/issues', commits_url: 'http://test.com/commits', collaborators_url: 'http://test.com/collaborators' };
    request.crawler = { queue: () => { }, queues: { pushPriority: () => { } } };
    sinon.spy(request.crawler, 'queue');
    sinon.spy(request.crawler.queues, 'pushPriority');
    const processor = new GitHubProcessor();

    processor.repo(request);
    expect(request.crawler.queue.callCount).to.be.at.least(4);
    const teamsRequest = request.crawler.queue.getCall(1).args[0];
    expect(teamsRequest.context.qualifier).to.be.equal('urn:repo:42');
    expect(!!teamsRequest.context.relation.guid).to.be.true;
    delete teamsRequest.context.relation.guid;
    expect(teamsRequest.context.relation).to.be.deep.equal({ origin: 'repo', qualifier: 'urn:repo:42:teams', type: 'team' });

    request.crawler.queue.reset();
    teamsRequest.type = 'teams';
    teamsRequest.document = { _metadata: { links: {} }, elements: [{ id: 13, url: 'http://team1' }] };
    teamsRequest.crawler = request.crawler;
    const teamsPage = processor.process(teamsRequest);
    const links = teamsPage._metadata.links;
    expect(links.resources.type).to.be.equal('resource');
    expect(links.resources.hrefs.length).to.be.equal(1);
    expect(links.resources.hrefs[0]).to.be.equal('urn:team:13');
    expect(links.repo.type).to.be.equal('resource');
    expect(links.repo.href).to.be.equal('urn:repo:42');
    expect(links.origin.type).to.be.equal('resource');
    expect(links.origin.href).to.be.equal('urn:repo:42');

    const teamRequest = request.crawler.queue.getCall(0).args[0];
    expect(teamRequest.type).to.be.equal('team');
    expect(teamRequest.context.qualifier).to.be.equal('urn:');

    request.crawler.queue.reset();
    teamRequest.document = { _metadata: { links: {} }, id: 54, organization: { id: 87 }, members_url: "http://team1/members", repositories_url: "http://team1/repos" };
    teamRequest.crawler = request.crawler;
    processor.team(teamRequest);
    const membersRequest = request.crawler.queue.getCall(1).args[0];
    expect(membersRequest.url).to.be.equal('http://team1/members');
    expect(membersRequest.context.qualifier).to.be.equal('urn:team:54');
    expect(!!membersRequest.context.relation.guid).to.be.true;
    delete membersRequest.context.relation.guid;
    expect(membersRequest.context.relation).to.be.deep.equal({ qualifier: 'urn:team:54:team_members', origin: 'team', type: 'user' });
    const reposRequest = request.crawler.queue.getCall(2).args[0];
    expect(reposRequest.url).to.be.equal('http://team1/repos');
    expect(reposRequest.context.qualifier).to.be.equal('urn:team:54');
    expect(!!reposRequest.context.relation.guid).to.be.true;
    delete reposRequest.context.relation.guid;
    expect(reposRequest.context.relation).to.be.deep.equal({ qualifier: 'urn:team:54:repos', origin: 'team', type: 'repo' });
  });
});

describe('Org processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('org', 'http://org/9');
    request.context = {};
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 9,
      url: 'http://orgs/9',
      repos_url: 'http://repos',
      members_url: 'http://members{/member}'
    };

    const processor = new GitHubProcessor();
    const document = processor.org(request);

    const links = {
      self: { href: 'urn:org:9', type: 'resource' },
      siblings: { href: 'urn:orgs', type: 'collection' },
      user: { href: 'urn:user:9', type: 'resource' },
      repos: { href: 'urn:user:9:repos', type: 'collection' },
      members: { href: 'urn:org:9:org_members:pages:*', type: 'relation' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://users/9' },
      { type: 'repos', url: 'http://repos' },
      { type: 'members', url: 'http://members' }
    ];
    expectQueued(queue, queued);
  });
});

describe('User processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('user', 'http://user/9');
    request.context = {};
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 9,
      repos_url: 'http://repos',
    };

    const processor = new GitHubProcessor();
    const document = processor.user(request);

    const links = {
      self: { href: 'urn:user:9', type: 'resource' },
      siblings: { href: 'urn:users', type: 'collection' },
      repos: { href: 'urn:user:9:repos', type: 'collection' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'repos', url: 'http://repos' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Repo processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('repo', 'http://foo/repo/12');
    request.context = {};
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 12,
      owner: { id: 45, url: 'http://user/45' },
      collaborators_url: 'http://collaborators{/collaborator}',
      commits_url: 'http://commits{/sha}',
      contributors_url: 'http://contributors',
      events_url: 'http://events',
      issues_url: 'http://issues{/number}',
      pulls_url: 'http://pulls{/number}',
      subscribers_url: 'http://subscribers',
      teams_url: 'http://teams',
      organization: { id: 24, url: 'http://org/24' },
    };

    const processor = new GitHubProcessor();
    const document = processor.repo(request);

    const links = {
      self: { href: 'urn:repo:12', type: 'resource' },
      siblings: { href: 'urn:user:45:repos', type: 'collection' },
      owner: { href: 'urn:user:45', type: 'resource' },
      organization: { href: 'urn:org:24', type: 'resource' },
      events: { href: 'urn:repo:12:events', type: 'collection' },
      pull_requests: { href: 'urn:repo:12:pull_requests', type: 'collection' },
      teams: { href: 'urn:repo:12:teams:pages:*', type: 'relation' },
      collaborators: { href: 'urn:repo:12:collaborators:pages:*', type: 'relation' },
      contributors: { href: 'urn:repo:12:contributors:pages:*', type: 'relation' },
      subscribers: { href: 'urn:repo:12:subscribers:pages:*', type: 'relation' },
      commits: { href: 'urn:repo:12:commits', type: 'collection' },
      issues: { href: 'urn:repo:12:issues', type: 'collection' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/45' },
      { type: 'org', url: 'http://org/24' },
      { type: 'teams', url: 'http://teams' },
      { type: 'collaborators', url: 'http://collaborators' },
      { type: 'contributors', url: 'http://contributors' },
      { type: 'subscribers', url: 'http://subscribers' },
      { type: 'issues', url: 'http://issues' },
      { type: 'commits', url: 'http://commits' },
      { type: 'events', url: 'http://events' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue CreateEvent', () => {
    const request = new Request('CreateEvent', 'http://foo');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      repository: { id: 4, url: 'http://repo/4' }
    }
    request.document = createEvent('CreateEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.CreateEvent(request);

    const links = {
      self: { href: 'urn:repo:4:CreateEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:CreateEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      repository: { href: 'urn:repo:4', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Commit processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('commit', 'http://foo/commit');
    request.context = { qualifier: 'urn:repo:12' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      sha: '6dcb09b5b5',
      url: 'http://repo/12/commits/6dcb09b5b5',
      comments_url: 'http://comments',
      author: { id: 7, url: 'http://user/7' },
      committer: { id: 15, url: 'http://user/15' }
    };
    const processor = new GitHubProcessor();
    const document = processor.commit(request);

    const links = {
      self: { href: 'urn:repo:12:commit:6dcb09b5b5', type: 'resource' },
      siblings: { href: 'urn:repo:12:commits', type: 'collection' },
      commit_comments: { href: 'urn:repo:12:commit:6dcb09b5b5:commit_comments', type: 'collection' },
      author: { href: 'urn:user:7', type: 'resource' },
      committer: { href: 'urn:user:15', type: 'resource' },
      repo: { href: 'urn:repo:12', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' },
      { type: 'user', url: 'http://user/15' },
      { type: 'repo', url: 'http://repo/12' },
      { type: 'commit_comments', url: 'http://comments' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Commit comment processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('commit_comment', 'http://repo/commit/comment');
    request.context = { qualifier: 'urn:repo:12:commit:a1b1' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 37,
      user: { id: 7, url: 'http://user/7' }
    };
    const processor = new GitHubProcessor();
    const document = processor.commit_comment(request);

    const links = {
      self: { href: 'urn:repo:12:commit:a1b1:commit_comment:37', type: 'resource' },
      siblings: { href: 'urn:repo:12:commit:a1b1:commit_comments', type: 'collection' },
      commit: { href: 'urn:repo:12:commit:a1b1', type: 'resource' },
      user: { href: 'urn:user:7', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' },
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue CommitCommentEvent', () => {
    const request = new Request('CommitCommentEvent', 'http://foo/pull');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      comment: { id: 7, url: 'http://commit_comment/7', commit_id: 'a1b1' }
    }
    request.document = createEvent('PullRequestReviewCommentEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.CommitCommentEvent(request);

    const links = {
      self: { href: 'urn:repo:4:CommitCommentEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:CommitCommentEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      commit_comment: { href: 'urn:repo:4:commit:a1b1:commit_comment:7', type: 'resource' },
      commit: { href: 'urn:repo:4:commit:a1b1', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' },
      { type: 'commit_comment', url: 'http://commit_comment/7' },
      { type: 'commit', url: 'http://repo/4/commits/a1b1' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Deployment processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('deployment', 'http://foo');
    request.context = { qualifier: 'urn:repo:12' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 3,
      sha: '6dcb09b5b5',
      creator: { id: 7, url: 'http://user/7' }
    };
    const processor = new GitHubProcessor();
    const document = processor.deployment(request);

    const links = {
      self: { href: 'urn:repo:12:deployment:3', type: 'resource' },
      siblings: { href: 'urn:repo:12:deployments', type: 'collection' },
      creator: { href: 'urn:user:7', type: 'resource' },
      commit: { href: 'urn:repo:12:commit:6dcb09b5b5', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Pull Request processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('pull_request', 'http://foo/pull');
    request.context = { qualifier: 'urn:repo:12' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 13,
      assignee: { id: 1, url: 'http://user/1' },
      milestone: { id: 26 },
      head: { repo: { id: 45, url: 'http://repo/45' } },
      base: { repo: { id: 17, url: 'http://repo/17' } },
      _links: {
        issue: { href: 'http://issue/13' },
        review_comments: { href: 'http://review_comments' },
        commits: { href: 'http://commits' },
        statuses: { href: 'http://statuses/funkySHA' }
      },
      user: { id: 7, url: 'http://user/7' },
      merged_by: { id: 15, url: 'http://user/15' }
    };
    const processor = new GitHubProcessor();
    const document = processor.pull_request(request);

    const links = {
      self: { href: 'urn:repo:12:pull_request:13', type: 'resource' },
      siblings: { href: 'urn:repo:12:pull_requests', type: 'collection' },
      user: { href: 'urn:user:7', type: 'resource' },
      merged_by: { href: 'urn:user:15', type: 'resource' },
      assignee: { href: 'urn:user:1', type: 'resource' },
      head: { href: 'urn:repo:45', type: 'resource' },
      base: { href: 'urn:repo:17', type: 'resource' },
      review_comments: { href: 'urn:repo:12:pull_request:13:review_comments', type: 'collection' },
      commits: { href: 'urn:repo:12:pull_request:13:commits', type: 'collection' },
      statuses: { href: 'urn:repo:12:commit:funkySHA:statuses', type: 'collection' },
      issue: { href: 'urn:repo:12:issue:13', type: 'resource' },
      issue_comments: { href: 'urn:repo:12:issue:13:issue_comments', type: 'collection' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' },
      { type: 'user', url: 'http://user/15' },
      { type: 'user', url: 'http://user/1' },
      { type: 'repo', url: 'http://repo/45' },
      { type: 'repo', url: 'http://repo/17' },
      { type: 'review_comments', url: 'http://review_comments' },
      { type: 'commits', url: 'http://commits' },
      { type: 'statuses', url: 'http://statuses/funkySHA' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue PullRequestEvent', () => {
    const request = new Request('PullRequestEvent', 'http://foo/pull');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      pull_request: { id: 1, url: 'http://pull_request/1' }
    }
    request.document = createEvent('PullRequestEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.PullRequestEvent(request);

    const links = {
      self: { href: 'urn:repo:4:PullRequestEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:PullRequestEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      pull_request: { href: 'urn:repo:4:pull_request:1', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' },
      { type: 'pull_request', url: 'http://pull_request/1' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue PullRequestReviewEvent', () => {
    const request = new Request('PullRequestReviewEvent', 'http://foo/pull');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      pull_request: { id: 1, url: 'http://pull_request/1' }
    }
    request.document = createEvent('PullRequestReviewEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.PullRequestReviewEvent(request);

    const links = {
      self: { href: 'urn:repo:4:PullRequestReviewEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:PullRequestReviewEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      pull_request: { href: 'urn:repo:4:pull_request:1', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' },
      { type: 'pull_request', url: 'http://pull_request/1' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Pull request/review comment processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('review_comment', 'http://repo/pull_request/comment');
    request.context = { qualifier: 'urn:repo:12:pull_request:27' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 37,
      user: { id: 7, url: 'http://user/7' }
    };
    const processor = new GitHubProcessor();
    const document = processor.review_comment(request);

    const links = {
      self: { href: 'urn:repo:12:pull_request:27:review_comment:37', type: 'resource' },
      siblings: { href: 'urn:repo:12:pull_request:27:review_comments', type: 'collection' },
      pull_request: { href: 'urn:repo:12:pull_request:27', type: 'resource' },
      user: { href: 'urn:user:7', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' },
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue PullRequestReviewCommentEvent', () => {
    const request = new Request('PullRequestReviewCommentEvent', 'http://foo/pull');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      comment: { id: 7, url: 'http://review_comment/7' },
      pull_request: { id: 1, url: 'http://pull_request/1' }
    }
    request.document = createEvent('PullRequestReviewCommentEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.PullRequestReviewCommentEvent(request);

    const links = {
      self: { href: 'urn:repo:4:PullRequestReviewCommentEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:PullRequestReviewCommentEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      comment: { href: 'urn:repo:4:pull_request:1:review_comment:7', type: 'resource' },
      pull_request: { href: 'urn:repo:4:pull_request:1', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' },
      { type: 'review_comment', url: 'http://review_comment/7' },
      { type: 'pull_request', url: 'http://pull_request/1' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Issue processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('issue', 'http://repo/issue');
    request.context = { qualifier: 'urn:repo:12' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 27,
      assignee: { id: 1, url: 'http://user/1' },
      assignees: [{ id: 50 }, { id: 51 }],
      milestone: { id: 26 },
      labels: [{ id: 88 }, { id: 99 }],
      repo: { id: 45, url: 'http://repo/45' },
      comments_url: 'http://issue/27/comments',
      pull_request: { url: 'http://pull_request/27' },
      user: { id: 7, url: 'http://user/7' },
      closed_by: { id: 15, url: 'http://user/15' }
    };
    const processor = new GitHubProcessor();
    const document = processor.issue(request);

    const links = {
      self: { href: 'urn:repo:12:issue:27', type: 'resource' },
      siblings: { href: 'urn:repo:12:issues', type: 'collection' },
      user: { href: 'urn:user:7', type: 'resource' },
      labels: { hrefs: ['urn:repo:12:label:88', 'urn:repo:12:label:99'], type: 'resource' },
      closed_by: { href: 'urn:user:15', type: 'resource' },
      assignee: { href: 'urn:user:1', type: 'resource' },
      repo: { href: 'urn:repo:12', type: 'resource' },
      assignees: { hrefs: ['urn:user:50', 'urn:user:51'], type: 'resource' },
      issue_comments: { href: 'urn:repo:12:issue:27:issue_comments', type: 'collection' },
      pull_request: { href: 'urn:repo:12:pull_request:27', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' },
      { type: 'user', url: 'http://user/15' },
      { type: 'user', url: 'http://user/1' },
      { type: 'repo', url: 'http://repo/45' },
      { type: 'issue_comments', url: 'http://issue/27/comments' },
      { type: 'pull_request', url: 'http://pull_request/27' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue IssuesEvent', () => {
    const request = new Request('IssuesEvent', 'http://foo/pull');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      assignee: { id: 2, url: 'http://user/2' },
      issue: { id: 1, url: 'http://issue/1' },
      label: { id: 8, url: 'http://label/8' }
    }
    request.document = createEvent('IssuesEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.IssuesEvent(request);

    const links = {
      self: { href: 'urn:repo:4:IssuesEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:IssuesEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      assignee: { href: 'urn:user:2', type: 'resource' },
      issue: { href: 'urn:repo:4:issue:1', type: 'resource' },
      label: { href: 'urn:repo:4:label:8', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' },
      { type: 'user', url: 'http://user/2' },
      { type: 'issue', url: 'http://issue/1' },
      { type: 'label', url: 'http://label/8' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Issue comment processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('issue_comment', 'http://repo/issue/comment');
    request.context = { qualifier: 'urn:repo:12:issue:27' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 37,
      user: { id: 7, url: 'http://user/7' }
    };
    const processor = new GitHubProcessor();
    const document = processor.issue_comment(request);

    const links = {
      self: { href: 'urn:repo:12:issue:27:issue_comment:37', type: 'resource' },
      siblings: { href: 'urn:repo:12:issue:27:issue_comments', type: 'collection' },
      issue: { href: 'urn:repo:12:issue:27', type: 'resource' },
      user: { href: 'urn:user:7', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/7' },
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue IssueCommentEvent', () => {
    const request = new Request('IssueCommentEvent', 'http://foo/');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      comment: { id: 7, url: 'http://issue_comment/7' },
      issue: { id: 1, url: 'http://issue/1' }
    }
    request.document = createEvent('IssueCommentEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.IssueCommentEvent(request);

    const links = {
      self: { href: 'urn:repo:4:IssueCommentEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:IssueCommentEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      comment: { href: 'urn:repo:4:issue:1:issue_comment:7', type: 'resource' },
      issue: { href: 'urn:repo:4:issue:1', type: 'resource' },
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' },
      { type: 'issue_comment', url: 'http://issue_comment/7' },
      { type: 'issue', url: 'http://issue/1' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Status processing', () => {
  it('should link and queue StatusEvent', () => {
    const request = new Request('StatusEvent', 'http://foo/');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      sha: 'a1b2'
    }
    request.document = createEvent('StatusEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.StatusEvent(request);

    const links = {
      self: { href: 'urn:repo:4:StatusEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:StatusEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      commit: { href: 'urn:repo:4:commit:a1b2', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Team processing', () => {
  it('should link and queue correctly', () => {
    const request = new Request('team', 'http://team/66');
    request.context = { qualifier: 'urn' };
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    request.document = {
      _metadata: { links: {} },
      id: 66,
      members_url: 'http://teams/66/members{/member}',
      repositories_url: 'http://teams/66/repos',
      organization: { id: 9, url: 'http://orgs/9' }
    };
    const processor = new GitHubProcessor();
    const document = processor.team(request);

    const links = {
      self: { href: 'urn:team:66', type: 'resource' },
      siblings: { href: 'urn:org:9:teams', type: 'collection' },
      organization: { href: 'urn:org:9', type: 'resource' },
      members: { href: 'urn:team:66:team_members:pages:*', type: 'relation' },
      repos: { href: 'urn:team:66:repos:pages:*', type: 'relation' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'org', url: 'http://orgs/9' },
      { type: 'repos', url: 'http://teams/66/repos' },
      { type: 'members', url: 'http://teams/66/members' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue TeamEvent', () => {
    const request = new Request('TeamEvent', 'http://foo/team');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      team: { id: 7, url: 'http://team/7' },
      organization: { id: 5, url: 'http://org/5' }
    }
    request.document = createOrgEvent('TeamEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.TeamEvent(request);

    const links = {
      self: { href: 'urn:team:7:TeamEvent:12345', type: 'resource' },
      siblings: { href: 'urn:team:7:TeamEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      team: { href: 'urn:team:7', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'org', url: 'http://org/5' },
      { type: 'team', url: 'http://team/7' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue TeamEvent with repository', () => {
    const request = new Request('TeamEvent', 'http://foo/team');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      team: { id: 7, url: 'http://team/7' },
      organization: { id: 5, url: 'http://org/5' },
      repository: { id: 6, url: 'http://repo/6' }
    }
    request.document = createOrgEvent('TeamEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.TeamEvent(request);

    const links = {
      self: { href: 'urn:team:7:TeamEvent:12345', type: 'resource' },
      siblings: { href: 'urn:team:7:TeamEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      repository: { href: 'urn:repo:6', type: 'resource' },
      team: { href: 'urn:team:7', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'org', url: 'http://org/5' },
      { type: 'repo', url: 'http://repo/6' },
      { type: 'team', url: 'http://team/7' }
    ];
    expectQueued(queue, queued);
  });

  it('should link and queue TeamAddEvent', () => {
    const request = new Request('TeamAddEvent', 'http://foo/team');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      team: { id: 7, url: 'http://team/7' },
      organization: { id: 5, url: 'http://org/5' },
      repository: { id: 6, url: 'http://repo/6' }
    }
    request.document = createOrgEvent('TeamAddEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.TeamAddEvent(request);

    const links = {
      self: { href: 'urn:team:7:TeamAddEvent:12345', type: 'resource' },
      siblings: { href: 'urn:team:7:TeamAddEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      repository: { href: 'urn:repo:6', type: 'resource' },
      team: { href: 'urn:team:7', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'org', url: 'http://org/5' },
      { type: 'repo', url: 'http://repo/6' },
      { type: 'team', url: 'http://team/7' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Watch processing', () => {
  it('should link and queue WatchEvent', () => {
    const request = new Request('WatchEvent', 'http://foo/watch');
    const queue = [];
    request.crawler = { queue: sinon.spy(request => { queue.push(request) }) };
    const payload = {
      repository: { id: 4, url: 'http://repo/4' }
    }
    request.document = createEvent('WatchEvent', payload);

    const processor = new GitHubProcessor();
    const document = processor.WatchEvent(request);

    const links = {
      self: { href: 'urn:repo:4:WatchEvent:12345', type: 'resource' },
      siblings: { href: 'urn:repo:4:WatchEvents', type: 'collection' },
      actor: { href: 'urn:user:3', type: 'resource' },
      repo: { href: 'urn:repo:4', type: 'resource' },
      org: { href: 'urn:org:5', type: 'resource' },
      repository: { href: 'urn:repo:4', type: 'resource' }
    }
    expectLinks(document._metadata.links, links);

    const queued = [
      { type: 'user', url: 'http://user/3' },
      { type: 'repo', url: 'http://repo/4' },
      { type: 'org', url: 'http://org/5' }
    ];
    expectQueued(queue, queued);
  });
});

describe('Event Finder', () => {
  it('will skip duplicates', () => {
    const docs = { 'http://repo1/events/3': '{ id: 3 }', 'http://repo1/events/4': '{ id: 4}' };
    const store = { get: (type, url) => { return Q(docs[url]); } }
    const events = [];
    for (let i = 0; i < 20; i++) {
      events.push({ id: i, repo: { url: 'http://repo1' } })
    }
    const processor = new GitHubProcessor();
    processor.store = store;
    processor._findNew(events).then(newEvents => {
      expect(newEvents.length).to.be.equal(18);
    });
  });
});

// =========================== HELPERS =========================

function createEvent(type, payload) {
  return {
    _metadata: { links: {} },
    type: type,
    id: 12345,
    payload: payload,
    actor: { id: 3, url: 'http://user/3' },
    repo: { id: 4, url: 'http://repo/4' },
    org: { id: 5, url: 'http://org/5' }
  };
}

function createOrgEvent(type, payload) {
  return {
    _metadata: { links: {} },
    type: type,
    id: 12345,
    payload: payload,
    actor: { id: 3, url: 'http://user/3' },
    org: { id: 5, url: 'http://org/5' }
  };
}

function createLinkHeader(target, previous, next, last) {
  const separator = target.includes('?') ? '&' : '?';
  const firstLink = null; //`<${urlHost}/${target}${separator}page=1>; rel="first"`;
  const prevLink = previous ? `<${target}${separator}page=${previous}>; rel="prev"` : null;
  const nextLink = next ? `<${target}${separator}page=${next}>; rel="next"` : null;
  const lastLink = last ? `<${target}${separator}page=${last}>; rel="last"` : null;
  return [firstLink, prevLink, nextLink, lastLink].filter(value => { return value !== null; }).join(',');
}