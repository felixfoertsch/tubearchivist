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
const { isoDate, duration, progress } = load('../src/new/videoMetadata.ts');
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
test('video metadata handles index date/timestamp formats and bounded progress', () => {
  assert.equal(isoDate('2024-02-09'), '2024-02-09');
  assert.equal(isoDate('1707436800'), '2024-02-09');
  assert.equal(duration(3661), '1:01:01');
  assert.equal(duration(NaN), '0:00');
  assert.equal(progress(200, 100), 100);
  assert.equal(progress(10, 0), 0);
  assert.equal(progress(undefined, 100), 0);
});
