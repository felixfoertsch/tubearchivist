import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createPreviewServer } from './new-ui-browser-server.mjs';
import { previewData } from './fixtures/preview-data.mjs';

const transpile = path =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: false,
    },
  }).outputText;
const metadata = {};
runInNewContext(transpile('../src/new/lib/settingsApplication.ts'), {
  exports: metadata,
  require: () => ({}),
});
const backup = {};
let status = 200,
  requested,
  clicked = false,
  link,
  transportError,
  apiUrl = 'https://local.test',
  credentials = 'same-origin';
runInNewContext(transpile('../src/new/lib/settingsBackup.ts'), {
  exports: backup,
  require: name =>
    name === './settingsApplication'
      ? metadata
      : { default: () => (name.endsWith('getApiUrl') ? apiUrl : credentials) },
  fetch: async (url, options) => {
    requested = { url, options };
    if (transportError) throw transportError;
    return { ok: status === 200, status, blob: () => assert.fail('Must not buffer dump') };
  },
  URL: { createObjectURL: () => assert.fail('Must not create blob URL') },
  document: {
    createElement: () => {
      link = {
        click: () => {
          clicked = true;
        },
      };
      return link;
    },
  },
});

test('native backup contract rejects malformed lists, dates, sizes and legacy ZIPs', () => {
  const files = previewData().backups;
  assert.equal(backup.validateBackups(files), files);
  for (const value of [
    {},
    [{ ...files[0], filename: '../escape.dump' }],
    [{ ...files[0], filename: 'old.zip' }],
    [{ ...files[0], file_size: -1 }],
    [{ ...files[0], timestamp: '20260229T120000Z' }],
  ])
    assert.throws(() => backup.validateBackups(value), /Invalid database backup/);
});

test('download validates access with HEAD then uses native attachment, never buffers body', async () => {
  const filename = previewData().backups[0].filename;
  for (status of [401, 403, 404, 500]) {
    clicked = false;
    await assert.rejects(backup.downloadBackup(filename), new RegExp(String(status)));
    assert.equal(clicked, false);
  }
  status = 200;
  await backup.downloadBackup(filename);
  assert.equal(requested.url, `https://local.test/api/appsettings/backup/${filename}/download/`);
  assert.equal(requested.options.credentials, 'same-origin');
  assert.equal(requested.options.method, 'HEAD');
  assert.equal(clicked, true);
  assert.equal(link.href, requested.url);
  assert.equal(link.download, filename);
  transportError = new Error('Network unavailable');
  clicked = false;
  await assert.rejects(backup.downloadBackup(filename), /Network unavailable/);
  assert.equal(clicked, false);
  transportError = undefined;
  apiUrl = 'http://localhost:8000';
  credentials = 'include';
  await backup.downloadBackup(filename);
  assert.equal(requested.options.credentials, 'include');
  assert.equal(link.href, `http://localhost:8000/api/appsettings/backup/${filename}/download/`);
  assert.equal(requested.options.headers, undefined);
  apiUrl = 'https://local.test';
  credentials = 'same-origin';
});

test('database backup page supports download/delete, no restore; failed list surfaces alert', async () => {
  for (const fail of [false, true]) {
    const exports = {},
      states = [],
      requests = [],
      effects = [];
    let cursor = 0;
    const jsx = (type, props) => ({ type, props });
    const requestJson = async (path, options = {}) => {
      requests.push([path, options.method || 'GET']);
      if (fail) throw new Error('Backup list failed (503)');
      return options.method ? undefined : previewData().backups;
    };
    runInNewContext(transpile('../src/new/pages/SettingsActions.tsx'), {
      exports,
      AbortController,
      require: name => {
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'react')
          return {
            useState: initial => {
              const i = cursor++;
              if (!(i in states)) states[i] = initial;
              return [
                states[i],
                value => {
                  states[i] = typeof value === 'function' ? value(states[i]) : value;
                },
              ];
            },
            useEffect: effect => {
              effects.push(effect);
            },
          };
        if (name.endsWith('/useIsAdmin')) return { default: () => true };
        if (name.endsWith('/useConfirm'))
          return { useConfirm: () => ({ confirm: async () => true }) };
        if (name.endsWith('/settings')) return { requestJson, settingsError: e => e.message };
        if (name.endsWith('/settingsBackup')) return backup;
        return {};
      },
    });
    function render() {
      cursor = 0;
      const root = exports.default();
      return root.type(root.props);
    }
    const nodes = node =>
      !node || typeof node !== 'object'
        ? []
        : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
    render();
    effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    const page = render();
    assert.doesNotMatch(JSON.stringify(page), /Restore ZIP|snapshots|file_path/);
    assert.ok(!nodes(page).some(node => node.props?.children === 'Restore'));
    if (fail) {
      assert.ok(
        nodes(page).some(
          node => node.props?.role === 'alert' && node.props.children.includes('503'),
        ),
      );
      assert.ok(!nodes(page).some(node => node.props?.children === 'Loading backups…'));
    } else {
      status = 403;
      await nodes(page)
        .find(node => node.props?.children === 'Download')
        .props.onClick();
      assert.ok(
        nodes(render()).some(
          node => node.props?.role === 'alert' && node.props.children.includes('403'),
        ),
      );
      status = 200;
      const deletion = nodes(render()).find(node => node.props?.variant === 'destructive');
      await deletion.props.onClick();
      assert.deepEqual(requests.at(-1), [
        `/api/appsettings/backup/${previewData().backups[0].filename}/`,
        'DELETE',
      ]);
    }
  }
});

test('preview models native list/create/download/delete and refuses online restore', async () => {
  const server = createPreviewServer();
  try {
    const address = await server.listen(0),
      base = `http://127.0.0.1:${address.port}`;
    const list = '/api/appsettings/backup/';
    const files = await (await fetch(base + list)).json();
    assert.equal(files[0].filename.endsWith('.dump'), true);
    assert.equal((await fetch(base + list, { method: 'POST' })).status, 200);
    const item = base + list + files[0].filename + '/';
    assert.equal((await fetch(item, { method: 'POST' })).status, 409);
    const head = await fetch(item + 'download/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.match(head.headers.get('content-disposition'), /attachment/);
    assert.equal(await head.text(), '');
    assert.match(await (await fetch(item + 'download/')).text(), /^PGDMP/);
    assert.equal((await fetch(item, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(item + 'download/')).status, 404);
    assert.equal((await fetch(base + '/api/appsettings/snapshot/')).status, 410);
  } finally {
    await server.close();
  }
});
