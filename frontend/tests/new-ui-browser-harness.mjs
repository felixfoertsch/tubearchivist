import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewServer } from './new-ui-browser-server.mjs';
import { ids } from './fixtures/preview-data.mjs';

// HTTP fixture checks, not DOM/feature-parity checks. Mounted browser uses actual dist separately.
test('local preview HTTP boundary, modes, permissions and in-memory writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ta-preview-'));
  await mkdir(join(directory, 'new'));
  await mkdir(join(directory, 'assets'));
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><title>Classic static test asset</title>',
  );
  await writeFile(
    join(directory, 'new/index.html'),
    '<!doctype html><title>Modern static test asset</title><body></body>',
  );
  await writeFile(join(directory, 'assets/test.js'), 'export const fixture = true;');
  await symlink('/etc/hosts', join(directory, 'assets/outside'));
  const preview = createPreviewServer({ dist: directory });
  const address = await preview.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.headers.get('X-Preview-Data'), 'LOCAL FIXTURES ONLY');
    return {
      status: response.status,
      data: response.status === 204 ? await response.text() : await response.json(),
    };
  };
  try {
    const modern = await fetch(base + '/new/channel/local');
    assert.equal(modern.status, 200);
    assert.match(await modern.text(), /LOCAL FIXTURES ONLY/);
    assert.equal((await fetch(base + '/')).status, 200);
    const asset = await fetch(base + '/assets/test.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    const media = await fetch(base + '/__preview__/sample.wav', {
      headers: { Range: 'bytes=0-43' },
    });
    assert.equal(media.status, 206);
    assert.equal(Buffer.from(await media.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
    assert.equal((await fetch(base + '/__preview__/subtitle.vtt')).status, 200);
    assert.equal((await fetch(base + '/assets/outside')).status, 403);
    assert.equal((await call('/api/unknown/')).status, 501);
    assert.equal(
      (await fetch(base + '/api/user/me/', { headers: { Origin: 'https://untrusted.invalid' } }))
        .status,
      403,
    );
    const unsafe = await new Promise((resolve, reject) => {
      const req = request(base, { path: '/%2e%2e/AGENTS.md' }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(unsafe, 403);
    await call('/__preview__/state', { account: 'ordinary' });
    assert.equal((await call('/api/user/account/')).data.is_staff, false);
    assert.equal((await call('/api/download/')).status, 403);
    assert.equal(
      (await call(`/api/channel/${ids.channel}/`, { channel_subscribed: false })).status,
      403,
    );
    assert.equal((await call('/api/user/me/', { page_size: 24 })).data.page_size, 24);
    for (const field of ['view_style_channel', 'view_style_playlist']) {
      assert.equal((await call('/api/user/me/', { [field]: 'table' })).data[field], 'table');
      assert.equal((await call('/api/user/me/', { [field]: 'unsupported' })).status, 400);
      assert.equal((await call('/api/user/me/')).data[field], 'table');
    }
    assert.equal((await call('/api/user/me/', { view_style_downloads: 'table' })).status, 400);
    await call('/__preview__/state', { account: 'anonymous' });
    assert.equal((await call('/api/ping/')).status, 401);
    const invalidLogin = await call('/api/user/login/', {
      username: 'anything',
      password: 'not-valid',
    });
    assert.equal(invalidLogin.status, 400);
    assert.equal((await call('/api/ping/')).status, 401);
    const login = await call('/api/user/login/', {
      username: 'ordinary',
      password: 'LOCAL_FIXTURE_PASSWORD',
    });
    assert.deepEqual(login, { status: 204, data: '' });
    assert.equal((await call('/api/ping/')).status, 200);
    assert.equal((await call('/api/user/account/')).data.is_staff, false);
    await call('/__preview__/state', { mutationStatus: 403 });
    assert.equal((await call('/api/user/logout/', {})).status, 403);
    assert.equal((await call('/api/ping/')).status, 200);
    await call('/__preview__/state', { mutationStatus: 200 });
    assert.deepEqual(await call('/api/user/logout/', {}), { status: 204, data: '' });
    assert.equal((await call('/api/ping/')).status, 401);
    await call('/__preview__/state', { account: 'admin', mode: 'empty' });
    assert.deepEqual((await call('/api/video/')).data.data, []);
    await call('/__preview__/state', { mode: 'error', failurePath: '/api/video/' });
    assert.equal((await call('/api/video/')).status, 500);
    assert.equal((await call('/api/ping/')).status, 200);
    await call('/__preview__/state', { mode: 'success', mutationStatus: 401 });
    assert.equal((await call('/api/user/me/', { page_size: 42 })).status, 401);
    await call('/__preview__/state', { mutationStatus: 403 });
    assert.equal((await call('/api/user/me/', { page_size: 42 })).status, 403);
    assert.equal((await call('/api/user/me/')).data.page_size, 24);
    await call('/__preview__/state', { mutationStatus: 200, delay: 25 });
    await call('/api/watched/', { id: ids.video, is_watched: true });
    assert.equal((await call(`/api/video/${ids.video}/`)).data.player.watched, true);
    await call(`/api/channel/${ids.channel}/`, { channel_overwrites: { rolling_window_size: 8 } });
    assert.equal(
      (await call(`/api/channel/${ids.channel}/`)).data.channel_overwrites.rolling_window_size,
      8,
    );
    await call('/api/download/local-pending/', { status: 'ignore' });
    assert.equal((await call('/api/download/?filter=ignore')).data.paginate.total_hits, 2);
    assert.deepEqual((await call('/api/download/aggs/')).data.buckets[0].key, [
      'Local fixture channel',
      ids.channel,
    ]);
    const watch = (await call('/api/stats/watch/')).data;
    assert.deepEqual([watch.watched.progress, watch.unwatched.progress], [0.25, 0.75]);
    assert.equal(watch.total.duration, 120);
    assert.equal(watch.watched.duration + watch.unwatched.duration, watch.total.duration);
    const page1 = (await call('/api/video/')).data;
    assert.equal(page1.data.length, 1);
    assert.equal(page1.paginate.current_page, 0);
    assert.deepEqual(page1.paginate.next_pages, []);
    assert.equal(page1.paginate.last_page, 2);
    const finalPage = (await call('/api/video/?page=2')).data;
    assert.equal(finalPage.data[0].youtube_id, 'local-second');
    assert.deepEqual(finalPage.paginate.prev_pages, []);
    assert.equal(finalPage.paginate.last_page, 0);
    assert.equal((await call('/api/video/?page=1')).data.data[0].youtube_id, ids.video);
    const channels = (await call('/api/channel/')).data;
    assert.equal(channels.data[0].channel_id, ids.channel);
    assert.equal(channels.paginate.last_page, 0);
    const playlists = (await call('/api/playlist/')).data;
    assert.equal(playlists.data[0].playlist_id, ids.playlist);
    assert.equal(playlists.paginate.last_page, 2);
    assert.equal((await call('/api/playlist/?page=2')).data.paginate.last_page, 0);
    assert.equal(
      (await call(`/api/video/${ids.video}/similar/`)).data[0].youtube_id,
      'local-second',
    );
    assert.equal(
      (await call(`/api/video/${ids.video}/nav/`)).data[0].playlist_next.youtube_id,
      'local-second',
    );
    assert.equal((await call('/__preview__/state', { taskMode: 'invalid' })).status, 400);
    await call('/__preview__/state', { taskMode: 'running' });
    const notification = (await call('/api/notification/?filter=download')).data[0];
    assert.equal(notification.progress, 0.5);
    assert.equal(notification.api_stop, true);
    assert.equal(notification.level, 'info');
    await call('/__preview__/state', { account: 'ordinary' });
    assert.equal((await call('/api/task/by-id/local-task/', { command: 'stop' })).status, 403);
    assert.equal((await call('/__preview__/state')).data.taskMode, 'running');
    await call('/__preview__/state', { account: 'admin', taskMode: 'error' });
    assert.equal((await call('/api/notification/')).data[0].level, 'error');
    for (const command of ['stop', 'kill']) {
      await call('/__preview__/state', { taskMode: 'running' });
      assert.deepEqual(await call('/api/task/by-id/local-task/', { command }), {
        status: 204,
        data: '',
      });
      assert.deepEqual((await call('/api/notification/')).data, []);
    }
    const taskActions = (await call('/__preview__/state')).data.actions.filter(
      action => action.route === 'task',
    );
    assert.deepEqual(
      taskActions.map(action => action.payload.command),
      ['stop', 'kill'],
    );
    assert.match(
      (await call('/api/search/')).data.results.fulltext_results[0].subtitle_line,
      /<span class="settings-current">Synthetic<\/span>/,
    );
    await call('/api/appsettings/membership/token/', { token: 'DO_NOT_LOG_RAW_TOKEN' });
    await call('/api/appsettings/cookie/', { cookie: 'DO_NOT_LOG_RAW_COOKIE' }, 'PUT');
    const log = (await call('/__preview__/state')).data.actions;
    assert(
      log.some(
        action =>
          action.route === 'watched' &&
          action.path === '/api/watched/' &&
          action.payload.is_watched === true,
      ),
    );
    assert(!JSON.stringify(log).includes('DO_NOT_LOG'));
    assert(log.some(action => action.payload.channel_overwrites?.rolling_window_size === 8));
    await call(
      '/api/video/local-DO_NOT_LOG_SECRET/?query=DO_NOT_LOG&token=DO_NOT_LOG&type=shorts&page=2',
    );
    const reads = (await call('/__preview__/state')).data.apiReads;
    assert(reads.some(read => read.path === '/api/download/' && read.method === 'GET'));
    assert(!JSON.stringify(reads).includes('DO_NOT_LOG'));
    assert.deepEqual(reads.at(-1), {
      route: 'video',
      method: 'GET',
      path: '/api/video/:fixture-id/',
      query: 'type=shorts&page=2',
    });
    await call('/__preview__/reset', {});
    assert.deepEqual((await call('/__preview__/state')).data.apiReads, []);
    assert.equal((await call('/api/user/me/')).data.page_size, 12);
    assert.deepEqual((await call('/__preview__/state')).data.actions, []);
    assert.equal((await call('/__preview__/state', { delay: -1 })).status, 400);
  } finally {
    await preview.close();
    await rm(directory, { recursive: true, force: true });
  }
});
