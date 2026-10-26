import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../src/new/pages/Login.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function render(options) {
  let stateIndex = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(source, {
    exports,
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useEffect() {},
          useState: initial => [stateIndex++ === 7 ? options : initial, () => {}],
        };
      if (name === 'react-router-dom')
        return { useSearchParams: () => [new URLSearchParams('next=/video/test/')] };
      if (name === '../lib/navigation') return { safeReturnTo: () => '/video/test/' };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return exports.default();
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

test('OIDC login exposes exact same-origin Authentik link and local recovery', () => {
  const tree = nodes(render({ oidc_enabled: true, oidc_login_url: '/api/user/oidc/login/' }));
  assert(
    tree.some(
      node =>
        node.type === 'a' &&
        node.props.href === '/api/user/oidc/login/?next=%2Fvideo%2Ftest%2F' &&
        node.props.children === 'Sign in with Authentik',
    ),
  );
  assert(tree.some(node => node.type === 'form'));
  assert(tree.some(node => node.type === 'h2' && node.props.children === 'Local recovery'));
});

test('unconfigured or unexpected login URL cannot create external SSO link', () => {
  for (const options of [
    null,
    { oidc_enabled: false },
    { oidc_enabled: true, oidc_login_url: 'https://evil.example/' },
  ]) {
    const tree = nodes(render(options));
    assert(
      !tree.some(node => node.type === 'a' && node.props.children === 'Sign in with Authentik'),
    );
    assert(tree.some(node => node.type === 'form'));
  }
});
