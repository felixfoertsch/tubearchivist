import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { previewData } from './fixtures/preview-data.mjs';
test('validated application saves update shared capabilities only on success', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ta-settings-capabilities-'));
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  let server;
  try {
    globalThis.window = {
      location: { origin: 'http://localhost', pathname: '/settings/application/' },
    };
    globalThis.document = { cookie: '' };
    server = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      cacheDir,
      configFile: false,
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    const { saveApplicationSetting } = await server.ssrLoadModule(
      '/src/new/lib/settingsApplication.ts',
    );
    const { useAppSettingsStore } = await server.ssrLoadModule('/src/stores/AppSettingsStore.ts');
    const config = previewData().config;
    config.application.enable_cast = true;
    globalThis.fetch = async () => new Response(JSON.stringify(config), { status: 200 });
    await saveApplicationSetting('application', 'enable_cast', true);
    assert.equal(useAppSettingsStore.getState().appSettingsConfig.application.enable_cast, true);
    const saved = useAppSettingsStore.getState().appSettingsConfig;
    for (const [status, data] of [
      [500, {}],
      [200, {}],
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(data), { status });
      await assert.rejects(saveApplicationSetting('application', 'enable_cast', false));
      assert.equal(useAppSettingsStore.getState().appSettingsConfig, saved);
    }
    // Retired snapshot endpoint must never be requested.
    const { loadApplicationSettings } = await server.ssrLoadModule(
      '/src/new/lib/settingsApplication.ts',
    );
    const fixture = previewData();
    globalThis.fetch = async url => {
      const path = String(url);
      assert.ok(!path.includes('/snapshot/'));
      const body = path.endsWith('/token/')
        ? { token: 'fixture-token' }
        : path.endsWith('/cookie/')
          ? fixture.cookie
          : fixture.config;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const loaded = await loadApplicationSettings();
    assert.equal(loaded.snapshots, undefined);
    assert.equal(loaded.token, 'fixture-token');
  } finally {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
