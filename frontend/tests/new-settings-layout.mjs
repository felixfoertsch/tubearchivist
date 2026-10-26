import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

test('unified settings renders one frame and visible role-gated sections', async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost' } };
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const { default: Settings } = await server.ssrLoadModule('/src/new/pages/Settings.tsx');
    const { useUserAccountStore } = await server.ssrLoadModule('/src/stores/UserAccountStore.ts');
    for (const is_staff of [false, true]) {
      Object.assign(useUserAccountStore.getInitialState(), { userAccount: { is_staff } });
      const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(Settings)));
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.equal((html.match(/<title>/g) || []).length, 1);
      assert.doesNotMatch(html, /aria-label="Settings"|role="tab/);
      for (const section of ['user', 'application', 'scheduling', 'actions']) {
        assert.equal(html.includes(`id="${section}"`), section === 'user' || is_staff);
      }
      assert.match(html, /User/);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length);
      assert.doesNotMatch(html, /<form[^>]*>(?:(?!<\/form>)[\s\S])*<form/);
      if (!is_staff)
        assert.doesNotMatch(html, /Loading application|Loading schedule|Database backups/);
    }
  } finally {
    await server.close();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

// Execute actual composition with a mount/effect runtime: forbidden child mounts fail immediately.
test('ordinary user never mounts admin children; hash effects follow history changes', () => {
  const source = ts.transpileModule(
    readFileSync(new URL('../src/new/pages/Settings.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  let hash = '#user';
  const mounted = [],
    scrolled = [],
    effects = [];
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  runInNewContext(source, {
    exports,
    document: { getElementById: id => ({ scrollIntoView: () => scrolled.push(id) }) },
    require: path => {
      if (path === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (path === 'react') return { useEffect: callback => effects.push(callback) };
      if (path === 'react-router-dom') return { useLocation: () => ({ hash }) };
      if (path.endsWith('/useIsAdmin')) return () => false;
      if (path.endsWith('/SettingsFrame')) return ({ children }) => children;
      return () => {
        mounted.push(path);
        assert.equal(path, './SettingsUser');
        return null;
      };
    },
  });
  const mount = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(mount);
    if (typeof node.type === 'function') return mount(node.type(node.props));
    mount(node.props?.children);
  };
  for (const next of ['#user', '#application', '#user', '#invalid']) {
    hash = next;
    mount(exports.default());
    effects.splice(0).forEach(callback => callback());
  }
  assert.deepEqual(mounted, Array(4).fill('./SettingsUser'));
  assert.deepEqual(scrolled, ['user', 'application', 'user']);
});

test('actual router redirects legacy sections, removes product About, keeps channel About', async () => {
  const source = ts.transpileModule(
    readFileSync(new URL('../src/new/main.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  const routes = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL('../src/new/routes.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports: routes },
  );
  let router;
  const jsx = (type, props) => ({ type, props });
  runInNewContext(source, {
    exports: {},
    document: { getElementById() {} },
    require: path => {
      if (path === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (path === 'react-dom/client') return { createRoot: () => ({ render() {} }) };
      if (path === 'react-router-dom')
        return {
          createBrowserRouter: value => {
            router = value;
          },
          useLocation: () => ({ pathname: '/settings/', search: '', hash: '#application' }),
          redirect: value => value,
        };
      if (path === 'react') return { useState: initial => [initial, () => {}], useEffect() {} };
      if (path === '../functions/useIsAdmin') return () => true;
      if (path === '../stores/AuthDataStore')
        return {
          useAuthStore: selector =>
            selector({
              auth: { version: '0.5.1', ta_update: { version: '0.5.2', is_breaking: true } },
            }),
        };
      if (path === './lib/theme') return { readTheme: () => 'system', applyTheme() {} };
      if (path === './routes') return routes;
      return new Proxy({}, { get: () => () => null });
    },
  });
  const app = router[0].children.find(route => route.path === '/');
  const shell = app.element.type();
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    nodes.push(node);
    walk(node.props?.children);
  };
  walk(shell);
  assert.ok(
    nodes.some(node => node.props?.to === '/dashboard/' && node.props.children === 'Dashboard'),
  );
  assert.ok(
    nodes.some(node => node.props?.to === '/settings/' && node.props.children === 'Settings'),
  );
  assert.ok(!nodes.some(node => node.props?.to === '/about/'));
  const footer = nodes.find(node => node.type === 'footer');
  const footerNodes = [];
  const oldLength = nodes.length;
  walk(footer);
  footerNodes.push(...nodes.slice(oldLength));
  assert.ok(!footerNodes.some(node => node.type === 'a' || node.props?.href || node.props?.to));
  assert.ok(
    footerNodes.some(node => node.type === 'span' && node.props.children.includes('0.5.2')),
  );
  const paths = app.children.map(route => route.path);
  assert.ok(paths.includes('dashboard'));
  assert.ok(paths.includes('settings'));
  assert.ok(paths.includes('channel/:channelId/about'));
  assert.ok(paths.includes('*'));
  assert.ok(!paths.includes('about/'));
  for (const section of ['user', 'application', 'scheduling', 'actions']) {
    assert.equal(
      await app.children.find(route => route.path === `settings/${section}`).loader(),
      `/settings/#${section}`,
    );
  }
});
