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
    { exports },
  );
  return exports;
}
const { requestedPage, nextPage } = load('../src/new/pagination.ts');
const { currentResult, channelNumber, errorMessage, assertResponse, isoDate, duration, progress } =
  load('../src/new/videoMetadata.ts');
const { togglePageSelection } = load('../src/new/components/BulkSelection.tsx');
test('keyed result never exposes another playlist channel or failed request', () => {
  const previous = { key: 'channel-a', data: { channel_id: 'channel-a' } };
  assert.equal(currentResult(previous, 'channel-b'), undefined);
  assert.equal(currentResult(previous, 'channel-a'), previous);
  assert.equal(currentResult({ key: 'request-a', error: 'Failed A' }, 'request-b'), undefined);
  assert.equal(currentResult(undefined, 'request-b'), undefined);
});
test('channel numeric overrides validate positive rolling windows before requests', () => {
  assert.equal(channelNumber('  ', 1), null);
  assert.equal(channelNumber('0'), 0);
  assert.equal(channelNumber(' 12 ', 1), 12);
  assert.equal(channelNumber('2147483647', 1), 2147483647);
  for (const value of ['0', '-1', '1.5', '1e2', '2147483648'])
    assert.throws(() => channelNumber(value, 1));
});
test('bulk page selection preserves other pages, deduplicates and toggles current page', () => {
  assert.deepEqual(Array.from(togglePageSelection(['old', 'a'], ['a', 'b'])), ['old', 'a', 'b']);
  assert.deepEqual(Array.from(togglePageSelection(['old', 'a', 'b'], ['a', 'b'])), ['old']);
  assert.deepEqual(Array.from(togglePageSelection(['old'], [])), ['old']);
});
test('pagination uses last-page metadata and respects 10000-result window', () => {
  assert.equal(nextPage({ current_page: 0, next_pages: [], last_page: 2 }), 2);
  assert.equal(nextPage({ current_page: 2, next_pages: [], last_page: 3 }), 3);
  assert.equal(nextPage({ current_page: 3, next_pages: [], last_page: false }), undefined);
  assert.equal(nextPage({ current_page: 0, next_pages: [2, 3], last_page: 4 }), 2);
  assert.equal(requestedPage('834', 12), 834);
  assert.equal(requestedPage('835', 12), null);
  assert.equal(requestedPage('10000', 12), null);
  assert.equal(requestedPage('1.5', 12), null);
  assert.equal(requestedPage(null, 12), 0);
});
test('mutation response rejects HTTP and payload errors; accepts no-content success', () => {
  assert.doesNotThrow(() => assertResponse({ status: 204 }));
  assert.equal(
    errorMessage({ status: 400, message: 'Invalid playlist' }, 'Failed'),
    'Invalid playlist',
  );
  assert.equal(errorMessage(null, 'Failed'), 'Failed');
  assert.throws(() => assertResponse({ status: 403 }), /Request failed \(403\)/);
  assert.throws(() => assertResponse({ status: 200, error: { error: 'Denied' } }), /Denied/);
});
test('video metadata handles index date/timestamp formats and bounded progress', () => {
  assert.equal(isoDate('2024-02-09'), '2024-02-09');
  assert.equal(isoDate('1707436800'), '2024-02-09');
  assert.equal(duration(3661), '1:01:01');
  assert.equal(duration(NaN), '0:00');
  assert.equal(progress(200, 100), 100);
  assert.equal(progress(10, 0), 0);
  assert.equal(progress(undefined, 100), 0);
});
