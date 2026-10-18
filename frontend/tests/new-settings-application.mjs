import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports, require: () => ({}) },
  );
  return exports;
}
const { requireData, validateAppSettings, validateSnapshots, validateCookie, isoDateTime } = load(
  '../src/new/lib/settingsApplication.ts',
);
const validSettings = {
  subscriptions: {
    channel_size: 50,
    live_channel_size: 0,
    shorts_channel_size: 0,
    playlist_size: 50,
    auto_start: false,
    extract_flat: false,
  },
  downloads: {
    limit_speed: null,
    sleep_interval: 10,
    autodelete_days: null,
    format: null,
    format_sort: null,
    add_metadata: 'simple',
    subtitle: null,
    subtitle_source: 'user',
    subtitle_index: false,
    comment_max: null,
    comment_sort: 'top',
    cookie_import: false,
    pot_provider_url: null,
    throttledratelimit: null,
    extractor_lang: null,
    integrate_ryd: false,
    integrate_sponsorblock: false,
  },
  application: { enable_snapshot: false, enable_cast: false },
};

test('application settings validates every section and preserves simple metadata mode', () => {
  assert.equal(validateAppSettings(validSettings), validSettings);
  const unsetSort = {
    ...validSettings,
    downloads: { ...validSettings.downloads, comment_sort: null },
  };
  assert.equal(validateAppSettings(unsetSort).downloads.comment_sort, null);
  assert.throws(
    () =>
      validateAppSettings({
        ...validSettings,
        downloads: { ...validSettings.downloads, add_metadata: 'other' },
      }),
    /add_metadata/,
  );
  assert.throws(
    () =>
      validateAppSettings({
        ...validSettings,
        subscriptions: { ...validSettings.subscriptions, auto_start: 1 },
      }),
    /auto_start/,
  );
  assert.throws(() =>
    validateAppSettings({
      ...validSettings,
      downloads: { ...validSettings.downloads, comment_sort: 'invalid' },
    }),
  );
});
test('API response data requires success status and data', () => {
  const data = { ok: true };
  assert.equal(requireData({ status: 200, data }, 'settings'), data);
  assert.throws(() => requireData({ status: 403, data }, 'settings'), /request failed/);
  assert.throws(() => requireData({ status: 200 }, 'settings'), /request failed/);
});
test('snapshots validate server fields and preserve disabled sentinel', () => {
  const snapshots = { next_exec: 1_800_000_000, expire_after: '30d', snapshots: false };
  assert.equal(validateSnapshots(snapshots).snapshots, false);
  assert.throws(
    () => validateSnapshots({ ...snapshots, snapshots: [{ id: 'x', state: 'SUCCESS' }] }),
    /snapshot list/,
  );
});
test('cookie validation accepts absent optional fields and rejects malformed fields', () => {
  assert.equal(validateCookie({ cookie_enabled: false }).cookie_enabled, false);
  assert.throws(
    () => validateCookie({ cookie_enabled: true, validated: Infinity }),
    /cookie status/,
  );
});
test('epoch and ISO instants render local ISO date-time, invalid date values fail closed', () => {
  const expected = date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  assert.equal(isoDateTime(0), expected(new Date(0)));
  assert.equal(isoDateTime('2024-03-01T12:34:56Z'), expected(new Date('2024-03-01T12:34:56Z')));
  assert.equal(isoDateTime('yesterday'), 'Unknown');
});
