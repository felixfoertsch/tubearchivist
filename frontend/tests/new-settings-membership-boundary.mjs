import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../src/new/pages/SettingsApplication.tsx', import.meta.url), 'utf8') +
    '\nexport { Membership };',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function renderMembership(admin) {
  const calls = [];
  let confirmations = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(source, {
    exports,
    AbortController,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useEffect: effect => effect(),
          useState: initial => [initial, () => {}],
        };
      if (name === '../components/useConfirm')
        return {
          useConfirm: () => ({
            confirm: async () => {
              confirmations++;
              return true;
            },
            dialog: { type: 'confirm-dialog' },
          }),
        };
      if (name === '../lib/settings')
        return {
          requestJson: async (url, options) => {
            calls.push([url, options]);
            return url.endsWith('/token/') ? { token: null } : {};
          },
          settingsError: String,
        };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return { tree: exports.Membership({ admin }), calls, confirmations: () => confirmations };
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

test('operator gets sync and confirmation without credential requests or controls', async () => {
  const { tree, calls, confirmations } = renderMembership(false);
  const all = nodes(tree);
  const sync = all.find(
    node => node.type === 'Button' && node.props.children === 'Sync subscriptions',
  );
  assert(sync);
  assert(all.some(node => node.type === 'confirm-dialog'));
  assert.equal(calls.length, 0);
  assert(!all.some(node => node.props?.['aria-label'] === 'Membership API key'));
  assert(!all.some(node => node.props?.children === 'Validate'));
  sync.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(confirmations(), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/appsettings/membership/sync/');
  assert.equal(calls[0][1].method, 'POST');
});

test('admin retains credential controls and token fetch', () => {
  const { tree, calls } = renderMembership(true);
  const all = nodes(tree);
  assert(all.some(node => node.props?.['aria-label'] === 'Membership API key'));
  assert.equal(calls[0][0], '/api/appsettings/membership/token/');
});
