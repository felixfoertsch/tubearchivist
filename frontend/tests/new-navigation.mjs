// Run from frontend: node --test tests/new-navigation.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

function load(relativePath, imports = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false },
    }).outputText,
    { exports, URL, require: name => imports[name] },
  );
  return exports;
}
const routes = load('../src/new/routes.ts').default;
const { safeReturnTo, loginHref, classicHref } = load('../src/new/lib/navigation.ts', {
  '../routes': { default: routes },
});

test('known new routes preserve query and hash; classic escape matches route', () => {
  for (const path of [
    '/new/',
    '/new/video/abc-123?t=12',
    '/new/channel/UC123/streams/?page=2',
    '/new/playlist/PL123',
    '/new/settings/user/',
    '/new/search/?query=cats#results',
  ]) {
    assert.equal(safeReturnTo(path), path);
    assert.equal(classicHref(path), path.slice(4));
    assert.equal(new URL(loginHref(path), 'https://local.test').searchParams.get('next'), path);
  }
  assert.equal(classicHref('/new/login/'), '/login/');
  assert.equal(routes.Video('a/b?c'), '/new/video/a%2Fb%3Fc');
  assert.equal(routes.VideoAtTimestamp('a', '1&x=2'), '/new/video/a/?t=1%26x%3D2');
  assert.equal(routes.Dashboard, '/new/dashboard/');
  assert.equal(routes.Settings, '/new/settings/');
  assert.equal(safeReturnTo('/new/dashboard/'), '/new/dashboard/');
  for (const section of ['user', 'application', 'scheduling', 'actions']) {
    const path = `/new/settings/?tab=advanced#${section}`;
    assert.equal(safeReturnTo(path), path);
    assert.equal(classicHref(path), `/settings/${section}/?tab=advanced`);
  }
  assert.equal(classicHref('/new/dashboard/?tab=1'), '/settings/?tab=1');
  assert.equal(classicHref('/new/dashboard'), '/settings/');
  assert.equal(classicHref('/new/settings/?tab=1'), '/settings/user/?tab=1');
  for (const section of ['user', 'application', 'scheduling', 'actions']) {
    const path = `/new/settings/${section}/?tab=advanced#legacy`;
    assert.equal(safeReturnTo(path), path);
    assert.equal(classicHref(path), `/settings/${section}/?tab=advanced`);
  }
  assert.equal(safeReturnTo('/new/about/'), '/new/');
  assert.equal(classicHref('/new/about/'), '/');
  assert.equal(safeReturnTo('/new/channel/UC123/about/'), '/new/channel/UC123/about/');
});

test('return rejects external URLs, unknown routes, traversal and encoded separators', () => {
  for (const path of [
    null,
    '',
    '//evil.test/new/',
    'https://evil.test/new/',
    '/login/',
    '/new/login/',
    '/new/unknown/',
    '/new/channel/a/unknown/',
    '/new/playlist/a/about/',
    '/new/video/a/b',
    '/new/video/a%2fb',
    '/new/video/a%5cb',
    '/new/video/%252f',
    '/new/video/../search/',
    '/new/../new/search/',
    '/new/video/a\\b',
    '/new/video/a\n',
    '/new//search/',
  ]) {
    assert.equal(safeReturnTo(path), '/new/', String(path));
    assert.equal(classicHref(path || ''), path === '/new/login/' ? '/login/' : '/', String(path));
  }
});

test('new API 401 redirects safely without logout; 403 preserves session; classic unchanged', async () => {
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(
    readFileSync(new URL('../src/functions/APIClient.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false } },
  ).outputText;
  for (const [path, status] of [
    ['/new/video/abc', 401],
    ['/new/video/abc', 403],
    ['/', 403],
  ]) {
    let logoutCalls = 0;
    let assigned;
    const exports = {};
    const location = {
      pathname: path,
      search: '?t=12',
      assign: value => {
        assigned = value;
      },
    };
    const imports = {
      '../configuration/defaultHeaders': { default: {} },
      '../configuration/getApiUrl': { default: () => '' },
      '../configuration/getFetchCredentials': { default: () => 'same-origin' },
      '../api/actions/logOut': {
        default: () => {
          logoutCalls++;
        },
      },
      './getCookie': { default: () => '' },
      '../configuration/routes/RouteList': { default: { Login: '/login/' } },
      '../stores/BackendStore': { useBackendStore: { getState: () => ({}) } },
      '../new/lib/navigation': { loginHref },
    };
    runInNewContext(source, {
      exports,
      window: { location },
      fetch: async () => ({ status, headers: { get: () => null } }),
      require: name => imports[name] || require(name),
    });
    if (path.startsWith('/new/') && status === 403) {
      const response = await exports.default('/api/test/');
      assert.equal(response.status, 403);
      assert.equal(assigned, undefined);
    } else await assert.rejects(exports.default('/api/test/'));
    assert.equal(logoutCalls, path === '/' ? 1 : 0);
    if (status === 401) assert.equal(assigned, '/new/login/?next=%2Fnew%2Fvideo%2Fabc%3Ft%3D12');
    if (path === '/') assert.equal(location.href, '/login/');
  }
});
