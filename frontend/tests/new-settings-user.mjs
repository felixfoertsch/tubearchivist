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
const { checkedUserConfig, pageSizePayload } = load('../src/new/lib/settingsUser.ts');
test('accepts valid user configuration and rejects failed or malformed responses', () => {
  const config = {
    stylesheet: 'dark.css',
    page_size: 12,
    show_help_text: true,
    file_size_unit: 'binary',
  };
  assert.equal(checkedUserConfig({ status: 200, data: config }), config);
  assert.throws(() => checkedUserConfig({ status: 500 }), /request failed/);
  assert.throws(
    () => checkedUserConfig({ status: 200, data: { ...config, stylesheet: 'invalid' } }),
    /invalid/,
  );
});
test('page size maps current draft to payload; empty, fractional, nonfinite and unsafe values reject', () => {
  assert.deepEqual({ ...pageSizePayload('12') }, { page_size: 12 });
  assert.deepEqual(
    { ...pageSizePayload('9007199254740991') },
    { page_size: Number.MAX_SAFE_INTEGER },
  );
  for (const invalid of ['', '0', '-1', '1.5', 'NaN', '9007199254740992'])
    assert.throws(() => pageSizePayload(invalid), /positive safe whole number/);
});
