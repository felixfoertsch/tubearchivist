import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { previewData } from './fixtures/preview-data.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
      location: { origin: 'http://localhost', pathname: '/new/settings/application/' },
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
  } finally {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('unsuccessful snapshots disable Restore and guard programmatic clicks', () => {
  const source = ts.transpileModule(
    readFileSync(new URL('../src/new/pages/SettingsApplication.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  for (const snapshotState of ['SUCCESS', 'FAILED', 'PARTIAL', 'IN_PROGRESS']) {
    const data = previewData();
    data.snapshots.snapshots[0].state = snapshotState;
    let index = 0,
      confirmations = 0;
    const jsx = (type, props) => ({ type, props });
    const exports = {};
    runInNewContext(source, {
      exports,
      require: path => {
        if (path === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (path === 'react')
          return {
            useState: initial => [
              index++ === 0
                ? {
                    settings: data.config,
                    snapshots: data.snapshots,
                    cookie: data.cookie,
                    token: data.token,
                  }
                : initial,
              () => {},
            ],
            useEffect() {},
          };
        if (path.endsWith('/useConfirm'))
          return {
            useConfirm: () => ({
              confirm: async () => {
                confirmations++;
                return false;
              },
            }),
          };
        if (path.endsWith('/useIsAdmin')) return () => true;
        if (path.endsWith('/settingsApplication')) return { isoDateTime: () => '2026-01-12 10:00' };
        return new Proxy({}, { get: () => () => null });
      },
    });
    const root = exports.default();
    const page = root.type(root.props);
    const find = node => {
      if (!node || typeof node !== 'object') return;
      if (node.props?.children === 'Restore') return node;
      const children = node.props?.children ?? node;
      if (Array.isArray(children)) {
        for (const child of children.flat(Infinity)) {
          const found = find(child);
          if (found) return found;
        }
      } else if (children !== node) return find(children);
    };
    const button = find(page);
    assert.ok(button);
    assert.equal(button.props.disabled, snapshotState !== 'SUCCESS');
    button.props.onClick();
    assert.equal(confirmations, snapshotState === 'SUCCESS' ? 1 : 0);
  }
});
