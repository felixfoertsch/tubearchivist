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
    '/',
    '/video/abc-123?t=12',
    '/channel/UC123/streams/?page=2',
    '/playlist/PL123',
    '/settings/user/',
    '/search/?query=cats#results',
  ]) {
    assert.equal(safeReturnTo(path), path);
    assert.equal(classicHref(path), `/old${path}`);
    assert.equal(new URL(loginHref(path), 'https://local.test').searchParams.get('next'), path);
  }
  assert.equal(classicHref('/login/'), '/old/login/');
  assert.equal(routes.Video('a/b?c'), '/video/a%2Fb%3Fc');
  assert.equal(routes.VideoAtTimestamp('a', '1&x=2'), '/video/a/?t=1%26x%3D2');
  assert.equal(routes.Dashboard, '/dashboard/');
  assert.equal(routes.Settings, '/settings/');
  assert.equal(safeReturnTo('/dashboard/'), '/dashboard/');
  for (const section of ['user', 'application', 'scheduling', 'actions']) {
    const path = `/settings/?tab=advanced#${section}`;
    assert.equal(safeReturnTo(path), path);
    assert.equal(classicHref(path), `/old/settings/${section}/?tab=advanced`);
  }
  assert.equal(classicHref('/dashboard/?tab=1'), '/old/settings/?tab=1');
  assert.equal(classicHref('/dashboard'), '/old/settings/');
  assert.equal(classicHref('/settings/?tab=1'), '/old/settings/user/?tab=1');
  for (const section of ['user', 'application', 'scheduling', 'actions']) {
    const path = `/settings/${section}/?tab=advanced#legacy`;
    assert.equal(safeReturnTo(path), path);
    assert.equal(classicHref(path), `/old/settings/${section}/?tab=advanced`);
  }
  assert.equal(safeReturnTo('/about/'), '/');
  assert.equal(classicHref('/about/'), '/old/');
  assert.equal(safeReturnTo('/channel/UC123/about/'), '/channel/UC123/about/');
});

test('return rejects external URLs, unknown routes, traversal and encoded separators', () => {
  for (const path of [
    null,
    '',
    '//evil.test/',
    'https://evil.test/',
    '/login/',
    '/old/',
    '/old/video/abc',
    '/unknown/',
    '/channel/a/unknown/',
    '/playlist/a/about/',
    '/video/a/b',
    '/video/a%2fb',
    '/video/a%5cb',
    '/video/%252f',
    '/video/../search/',
    '/../search/',
    '/video/a\\b',
    '/video/a\n',
    '//search/',
  ]) {
    assert.equal(safeReturnTo(path), '/', String(path));
    assert.equal(
      classicHref(path || ''),
      path === '/login/' ? '/old/login/' : '/old/',
      String(path),
    );
  }
});

test('new API 401 redirects safely without logout; 403 preserves session; classic unchanged', async () => {
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(
    readFileSync(new URL('../src/functions/APIClient.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false } },
  ).outputText;
  for (const [path, status] of [
    ['/video/abc', 401],
    ['/video/abc', 403],
    ['/old/', 403],
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
      '../configuration/routes/RouteList': { default: { Login: '/old/login/' } },
      '../stores/BackendStore': { useBackendStore: { getState: () => ({}) } },
      '../new/lib/navigation': { loginHref },
    };
    runInNewContext(source, {
      exports,
      window: { location },
      fetch: async () => ({ status, headers: { get: () => null } }),
      require: name => imports[name] || require(name),
    });
    if (!path.startsWith('/old/') && status === 403) {
      const response = await exports.default('/api/test/');
      assert.equal(response.status, 403);
      assert.equal(assigned, undefined);
    } else await assert.rejects(exports.default('/api/test/'));
    assert.equal(logoutCalls, path === '/old/' ? 1 : 0);
    if (status === 401) assert.equal(assigned, '/login/?next=%2Fvideo%2Fabc%3Ft%3D12');
    if (path === '/old/') assert.equal(location.href, '/old/login/');
  }
});
