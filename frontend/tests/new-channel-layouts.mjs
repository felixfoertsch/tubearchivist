import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import { createPreviewServer } from './new-ui-browser-server.mjs';
import { previewData } from './fixtures/preview-data.mjs';

test('channel density cohort stays opt-in and bounded', async () => {
  const preview = createPreviewServer();
  try {
    const address = await preview.listen(0);
    const origin = `http://127.0.0.1:${address.port}`;
    const list = async () => (await fetch(`${origin}/api/channel/`)).json();
    assert.equal((await list()).data.length, 1);
    const control = channelCount =>
      fetch(`${origin}/__preview__/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelCount }),
      });
    assert.equal((await control(12)).status, 200);
    const cohort = await list();
    assert.equal(cohort.data.length, 12);
    assert.equal(new Set(cohort.data.map(channel => channel.channel_id)).size, 12);
    assert.ok(cohort.data.some(channel => channel.channel_name.length > 200));
    assert.equal(new Set(cohort.data.map(channel => channel.channel_subscribed)).size, 2);
    for (const invalid of [0, 25, 1.5, '12']) assert.equal((await control(invalid)).status, 400);
    await fetch(`${origin}/__preview__/reset`, { method: 'POST' });
    assert.equal((await list()).data.length, 1);
  } finally {
    await preview.close();
  }
});

test('channel directory renders distinct compact saved views', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ta-channel-layouts-'));
  let server;
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost' } };
  try {
    server = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      cacheDir,
      configFile: false,
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    const { ChannelsList } = await server.ssrLoadModule('/src/new/components/ChannelsList.tsx');
    const { PlaylistList } = await server.ssrLoadModule('/src/new/components/PlaylistList.tsx');
    const { DownloadItem } = await server.ssrLoadModule('/src/new/components/DownloadItem.tsx');
    const { Collection } = await server.ssrLoadModule('/src/new/components/Collection.tsx');
    const { VideoCollection } = await server.ssrLoadModule(
      '/src/new/components/VideoCollection.tsx',
    );
    const { collectionGrid, collectionCard, collectionBody } = await server.ssrLoadModule(
      '/src/new/components/collectionLayout.ts',
    );
    const { useUserConfigStore } = await server.ssrLoadModule('/src/stores/UserConfigStore.ts');
    const { useUserAccountStore } = await server.ssrLoadModule('/src/stores/UserAccountStore.ts');
    // SSR must observe each explicitly selected store snapshot rather than its startup snapshot.
    const setAccount = userAccount =>
      Object.assign(useUserAccountStore.getInitialState(), { userAccount });
    const channels = Array.from({ length: 12 }, (_, i) => ({
      channel_id: `channel-${i}`,
      channel_name: `Long channel name ${i} ${'word'.repeat(30)}`,
      channel_thumb_url: `/avatar-${i}.jpg`,
      channel_banner_url: `/banner-${i}.jpg`,
      channel_subs: 1234,
      channel_last_refresh: '2026-10-18T12:00:00Z',
      channel_subscribed: i % 2 === 0,
    }));
    const render = view => {
      const { userConfig } = useUserConfigStore.getState();
      Object.assign(useUserConfigStore.getInitialState(), {
        userConfig: { ...userConfig, view_style_channel: view },
      });
      return renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(ChannelsList, { channels, refresh() {} })),
      );
    };
    await t.test('table has column headings and one data row per channel', () => {
      const html = render('table');
      assert.match(html, /<table/);
      assert.match(html, /<th[^>]*>Subscribers<\/th>/);
      assert.match(html, /<th[^>]*>Last refreshed<\/th>/);
      assert.equal((html.match(/<tr\b/g) ?? []).length, 13);
    });
    await t.test('list uses compact semantic rows, not cards', () => {
      const html = render('list');
      assert.match(html, /<ul/);
      assert.equal((html.match(/<li\b/g) ?? []).length, 12);
      assert.doesNotMatch(html, /data-slot="card"|<table/);
    });
    await t.test('grid uses channel artwork in shared media frames, never banners', () => {
      const html = render('grid');
      assert.equal((html.match(/data-slot="card"/g) ?? []).length, 12);
      assert.match(html, /src="\/avatar-0.jpg"/);
      assert.doesNotMatch(html, /banner-\d/);
      assert.match(html, /aspect-video w-full object-cover/);
      assert.match(html, /href="\/channel\/channel-0"/);
      assert.match(html, /2026-10-18/);
      assert.match(html, /1,234/);
    });
    await t.test(
      'Home and Channels share responsive grid and unclipped card footprint at saved column counts',
      () => {
        for (const [saved, expected] of [
          [1, 3],
          [3, 3],
          [7, 7],
          [9, 7],
        ]) {
          const { userConfig } = useUserConfigStore.getInitialState();
          Object.assign(useUserConfigStore.getInitialState(), {
            userConfig: { ...userConfig, grid_items: saved },
          });
          const channelHtml = render('grid');
          const videoHtml = renderToStaticMarkup(
            createElement(
              MemoryRouter,
              null,
              createElement(VideoCollection, {
                videos: previewData().videos,
                view: 'grid',
                bulk: false,
                refresh() {},
              }),
            ),
          );
          for (const html of [channelHtml, videoHtml]) {
            assert.ok(html.includes(`class="${collectionGrid}"`));
            assert.ok(html.includes(`--home-columns:${expected}`));
            assert.ok(html.includes(collectionCard));
            assert.ok(html.includes(collectionBody));
            assert.match(html, /aspect-video w-full object-cover/);
            assert.doesNotMatch(collectionBody, /overflow-hidden|(?:^| )h-/);
          }
        }
      },
    );
    await t.test('all directory domains render same semantic compact row and media slot', () => {
      const data = previewData();
      const { userConfig } = useUserConfigStore.getInitialState();
      Object.assign(useUserConfigStore.getInitialState(), {
        userConfig: { ...userConfig, view_style_playlist: 'list' },
      });
      const wrap = element => renderToStaticMarkup(createElement(MemoryRouter, null, element));
      const htmls = [
        render('list'),
        wrap(
          createElement(VideoCollection, {
            videos: data.videos,
            view: 'list',
            bulk: false,
            refresh() {},
          }),
        ),
        wrap(createElement(PlaylistList, { playlists: data.playlists, refresh() {} })),
        wrap(
          createElement(
            Collection,
            { grid: false },
            createElement(DownloadItem, { download: data.queue[0], refresh() {} }),
          ),
        ),
      ];
      for (const html of htmls) {
        assert.match(html, /<ul class="divide-y rounded-xl border"/);
        assert.match(
          html,
          /<li class="flex min-w-0 flex-wrap items-center gap-3 p-2 sm:flex-nowrap"/,
        );
        assert.match(html, /flex h-10 w-16 items-center justify-center/);
        assert.doesNotMatch(html, /data-slot="card"|aspect-video/);
      }
      Object.assign(useUserConfigStore.getInitialState(), {
        userConfig: { ...userConfig, view_style_playlist: 'table' },
      });
      const table = wrap(createElement(PlaylistList, { playlists: data.playlists, refresh() {} }));
      assert.match(table, /<table/);
      assert.equal((table.match(/<tr\b/g) ?? []).length, data.playlists.length + 1);
    });
    await t.test('subscription controls stay permission-gated across views', () => {
      for (const view of ['grid', 'list', 'table']) {
        setAccount({ is_staff: false, is_superuser: false, can_manage_app: false });
        assert.doesNotMatch(render(view), /<button/);
        setAccount({ is_staff: true, can_manage_app: true });
        const html = render(view);
        assert.equal((html.match(/<button/g) ?? []).length, 12);
        assert.match(html, />Unsubscribe<\/button>/);
        assert.match(html, />Subscribe<\/button>/);
      }
    });
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  }
});
