import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/image.yml', 'utf8');
assert.deepEqual(readdirSync('.github/workflows').sort(), ['image.yml', 'preserve-stable.yml']);
const preservation = readFileSync('.github/workflows/preserve-stable.yml', 'utf8');
assert(preservation.includes('workflow_dispatch:'));
assert(preservation.includes('sha256:cde3cab697290fc9d59e2e1bf47b1e2b35bc3df464cb63ff8d0ed3c24153a408'));
assert(preservation.includes('b8c413495fd61f7a584e7a2e239a03b5e717ccef'));
assert(!preservation.includes('inputs:'));
assert(preservation.includes('group: fork-image-publication'));
const preservationPublisher = preservation.slice(preservation.indexOf('  promote:'));
assert(!preservationPublisher.includes('actions/checkout'));
assert(!preservationPublisher.includes('node scripts/'));
assert(!preservation.slice(0, preservation.indexOf('  promote:')).includes('packages: write'));
assert(!/schedule:|workflow_dispatch:|contents: write|actions: write|pull_request_target:/.test(workflow));
assert(workflow.includes('ref: ${{ github.sha }}'));
assert(workflow.includes('persist-credentials: false'));
assert(workflow.includes("github.event_name != 'pull_request'"));
assert(workflow.includes("!github.event.release.prerelease"));
assert(workflow.includes('platforms: linux/amd64,linux/arm64'));
assert(workflow.includes('npm run --prefix frontend build\n          node --test frontend/tests/*.mjs\n'));
assert(!workflow.includes('npm run --prefix frontend build:deploy'));
const publisher = workflow.slice(workflow.indexOf('  publish:'));
assert(!publisher.includes('actions/checkout'));
assert(publisher.includes('group: fork-image-publication'));
assert(publisher.includes('cancel-in-progress: false'));
assert(!workflow.slice(0, workflow.indexOf('  publish:')).includes('packages: write'));
const script = publisher.split('          script: |\n')[1].split('          github-token:')[0]
	.split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('require', 'context', 'github', 'process', script);
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

async function scenario({ event = 'push', stale = false, prerelease = false, moved = false, latest = 1, exists = false, denied = false, staleAfterCopy = false, wrongImage = false, singleArch = false, annotated = false, mismatchedAlias, matchingExisting = false, failAlias } = {}) {
	const copies = [];
	const release = { id: 1, tag_name: 'v1.2.3', prerelease, draft: false };
	const context = { repo: { owner: 'felixfoertsch', repo: 'tubearchivist' }, eventName: event, ref: 'refs/heads/main', sha, actor: 'test', runId: 42, serverUrl: 'https://github.com', payload: { release } };
	const github = { rest: {
		git: { getTag: async () => ({ data: { object: { type: 'commit', sha: moved ? 'c'.repeat(40) : sha } } }), getRef: async ({ ref }) => ({ data: { object: { type: annotated && ref.startsWith('tags/') ? 'tag' : 'commit', sha: stale || (moved && ref.startsWith('tags/')) || (staleAfterCopy && copies.length) ? 'c'.repeat(40) : sha } } }) },
		repos: { getRelease: async () => ({ data: release }), getLatestRelease: async () => ({ data: { id: latest } }) },
	} };
	const execFileSync = (command, args) => {
		assert.equal(command, 'skopeo');
		if (args[0] === 'login') return '';
		if (args[0] === 'inspect' && args.at(-1) === 'oci-archive:candidate.tar') return JSON.stringify({ Digest: digest });
		if (args[0] === 'copy') {
			copies.push(args.at(-1));
			if (failAlias && args.at(-1).endsWith(`:${failAlias}`)) throw new Error('Registry copy failed');
			return '';
		}
		if (args.includes('--raw')) return JSON.stringify({ manifests: (singleArch ? ['amd64'] : ['amd64', 'arm64']).map(architecture => ({ platform: { os: 'linux', architecture } })) });
		if (args.includes('--config')) return JSON.stringify({ config: { Labels: { 'org.opencontainers.image.revision': wrongImage ? 'bad' : sha, 'org.opencontainers.image.source': 'https://github.com/felixfoertsch/tubearchivist' } } });
		if (!copies.length && !exists && !matchingExisting) throw Object.assign(new Error('registry'), { stderr: denied ? 'unauthorized' : 'manifest unknown' });
		return JSON.stringify({ Digest: exists || (mismatchedAlias && args.at(-1).endsWith(`:${mismatchedAlias}`)) ? `sha256:${'c'.repeat(64)}` : digest });
	};
	let error;
	try { await run(() => ({ execFileSync }), context, github, { env: { ARCHIVE: 'oci-archive:candidate.tar', GITHUB_RUN_ATTEMPT: '1', GITHUB_SERVER_URL: 'https://github.com' } }); } catch (caught) { error = caught; }
	return { copies, error };
}

assert.deepEqual((await scenario()).copies.map(tag => tag.split(':').at(-1)), ['build-42-1', 'nightly']);
assert.deepEqual((await scenario({ event: 'release' })).copies.map(tag => tag.split(':').at(-1)), ['v1.2.3', 'stable', 'latest']);
for (const options of [{ stale: true }, { event: 'pull_request' }, { event: 'release', prerelease: true }, { event: 'release', moved: true }, { event: 'release', latest: 2 }, { event: 'release', exists: true }, { denied: true }]) {
	const result = await scenario(options);
	assert(result.error, JSON.stringify(options));
	assert.deepEqual(result.copies, []);
}
assert.equal((await scenario({ event: 'release', annotated: true })).error, undefined);
for (const options of [{ wrongImage: true }, { singleArch: true }]) {
	const result = await scenario(options);
	assert(result.error);
	assert.equal(result.copies.length, 1);
}
const raced = await scenario({ staleAfterCopy: true });
assert(raced.error);
assert.equal(raced.copies.length, 1); // Candidate may remain; alias cannot move.
for (const [event, mismatchedAlias, count] of [['push', 'nightly', 2], ['release', 'stable', 2], ['release', 'latest', 3]]) {
	const result = await scenario({ event, mismatchedAlias });
	assert.equal(result.error?.message, 'Alias digest mismatch');
	assert.equal(result.copies.length, count);
}
const resumed = await scenario({ event: 'release', matchingExisting: true });
assert.equal(resumed.error, undefined);
assert.deepEqual(resumed.copies.map(tag => tag.split(':').at(-1)), ['stable', 'latest']);
for (const options of [{ wrongImage: true }, { singleArch: true }]) {
	const result = await scenario({ event: 'release', matchingExisting: true, ...options });
	assert(result.error);
	assert.deepEqual(result.copies, []);
}
for (const failAlias of ['stable', 'latest']) {
	const partial = await scenario({ event: 'release', failAlias });
	assert.equal(partial.error?.message, 'Registry copy failed');
	const retry = await scenario({ event: 'release', matchingExisting: true });
	assert.equal(retry.error, undefined);
	assert.deepEqual(retry.copies.map(tag => tag.split(':').at(-1)), ['stable', 'latest']);
}
const preservationScript = preservationPublisher.split('          script: |\n')[1].split('          github-token:')[0]
	.split('\n').map(line => line.slice(12)).join('\n');
const preserve = new AsyncFunction('require', 'context', 'github', 'process', preservationScript);
const production = 'sha256:cde3cab697290fc9d59e2e1bf47b1e2b35bc3df464cb63ff8d0ed3c24153a408';
const revision = 'b8c413495fd61f7a584e7a2e239a03b5e717ccef';
const previous = 'sha256:38cace6d1aac9508725fc7488e8239caf3a06ae112627d9af94798966a04abe7';
async function preservationScenario({ stale = false, wrongParent = false, wrongDigest = false, wrongRevision = false, wrongSource = false, singleArch = false, changedAlias = false, staleAfterCopy = false, corruptCopy = false, failLatest = false, resumed = false, event = 'workflow_dispatch', ref = 'refs/heads/main' } = {}) {
	const copies = [];
	const aliases = { stable: resumed ? production : previous, latest: previous };
	if (changedAlias) aliases.latest = digest;
	const env = { IMAGE: 'ghcr.io/felixfoertsch/tubearchivist', DIGEST: production, REVISION: revision, PREVIOUS: previous, ARCHIVE: 'oci-archive:production.tar' };
	const context = { repo: { owner: 'felixfoertsch', repo: 'tubearchivist' }, eventName: event, ref, sha, actor: 'test' };
	const github = { rest: {
		git: { getRef: async () => ({ data: { object: { sha: stale || (staleAfterCopy && copies.length) ? revision : sha } } }) },
		repos: { getCommit: async () => ({ data: { parents: [{ sha: wrongParent ? sha : revision }] } }) },
	} };
	const execFileSync = (command, args) => {
		assert.equal(command, 'skopeo');
		if (args[0] === 'login') return '';
		if (args[0] === 'copy') {
			assert.deepEqual(args.slice(0, 4), ['copy', '--all', '--preserve-digests', env.ARCHIVE]);
			const alias = args.at(-1).split(':').at(-1);
			if (failLatest && alias === 'latest') throw new Error('Registry copy failed');
			copies.push(alias);
			aliases[alias] = corruptCopy ? digest : production;
			return '';
		}
		if (args.includes('--raw')) return JSON.stringify({ manifests: (singleArch ? ['amd64'] : ['amd64', 'arm64']).map(architecture => ({ platform: { os: 'linux', architecture } })) });
		if (args.includes('--config')) return JSON.stringify({ config: { Labels: { 'org.opencontainers.image.revision': wrongRevision ? sha : revision, 'org.opencontainers.image.source': wrongSource ? 'https://github.com/untrusted/image' : 'https://github.com/felixfoertsch/tubearchivist' } } });
		return JSON.stringify({ Digest: args.at(-1) === env.ARCHIVE ? wrongDigest ? digest : production : aliases[args.at(-1).split(':').at(-1)] });
	};
	let error;
	try { await preserve(() => ({ execFileSync }), context, github, { env }); } catch (caught) { error = caught; }
	return { copies, aliases, error };
}
for (const options of [{}, { resumed: true }]) {
	const result = await preservationScenario(options);
	assert.equal(result.error, undefined);
	assert.deepEqual(result.copies, ['stable', 'latest']);
	assert.deepEqual(result.aliases, { stable: production, latest: production });
}
for (const options of [{ stale: true }, { wrongParent: true }, { wrongDigest: true }, { wrongRevision: true }, { wrongSource: true }, { singleArch: true }, { changedAlias: true }, { event: 'push' }, { ref: 'refs/heads/other' }]) {
	const result = await preservationScenario(options);
	assert(result.error, JSON.stringify(options));
	assert.deepEqual(result.copies, []);
}
for (const options of [{ staleAfterCopy: true }, { corruptCopy: true }, { failLatest: true }]) {
	const result = await preservationScenario(options);
	assert(result.error, JSON.stringify(options));
	assert.deepEqual(result.copies, ['stable']);
}
console.log('Workflow contract checks passed');
