import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(path, imports = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports, require: name => imports[name] || {} },
  );
  return exports;
}
const { schedulePayload, scheduleConfig, scheduleTimestamp } = load(
  '../src/new/lib/settingsSchedule.ts',
);
test('schedule timestamps use ISO and 24-hour UTC', () => {
  assert.equal(scheduleTimestamp('2026-10-18T15:30:00+02:00'), '2026-10-18 13:30 UTC');
  assert.equal(scheduleTimestamp(null), 'Never');
  assert.equal(scheduleTimestamp('10/18/2026'), 'Unknown time');
});
const { validateStats, statsProgress } = load('../src/new/lib/settingsStats.ts');
test('watch progress ratio formats as percent', () => {
  assert.equal(
    statsProgress(0.5),
    new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(0.5),
  );
  assert.match(statsProgress(0.5), /50/);
  assert.match(statsProgress(1), /100/);
});
const { backupDate } = load('../src/new/lib/settingsBackup.ts', {
  './settingsApplication': load('../src/new/lib/settingsApplication.ts'),
});
test('native backup timestamps display ISO local time; malformed dates fail closed', () => {
  const date = new Date('2024-02-29T12:30:00Z');
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  assert.equal(backupDate('20240229T123000Z'), expected);
  for (const value of ['20260229T120000Z', '20240229', 'bad'])
    assert.equal(backupDate(value), 'Unknown date');
});
test('scheduler preserves cron protocol and both config keys without defaults', () => {
  assert.equal(JSON.stringify(scheduleConfig('days', '90')), '{"config":{"days":90}}');
  assert.equal(JSON.stringify(scheduleConfig('rotate', '0')), '{"config":{"rotate":0}}');
  assert.equal(JSON.stringify(schedulePayload(' 0 15 * ')), '{"schedule":"0 15 *"}');
  assert.equal(
    JSON.stringify(schedulePayload('auto', 'days', '90')),
    '{"schedule":"auto","config":{"days":90}}',
  );
  assert.equal(
    JSON.stringify(schedulePayload('0 18 0', 'rotate', '0')),
    '{"schedule":"0 18 0","config":{"rotate":0}}',
  );
  for (const cron of ['', '* 15 *', '60 15 *', '0 0 * * *'])
    assert.throws(() => schedulePayload(cron));
  for (const number of ['', '-1', '1.5', '9007199254740992'])
    assert.throws(() => schedulePayload('auto', 'days', number));
});
test('statistics rejects missing, nonfinite and negative data rather than inventing zero values', () => {
  const stats = {
    doc_count: 0,
    watched: { progress: 25, duration_str: '01:00' },
    history: [{ date: '2026-01-01', count: 1 }],
  };
  assert.equal(validateStats(stats), stats);
  assert.equal(validateStats({ watched: null }).watched, null);
  assert.equal(validateStats([]).length, 0);
  assert.throws(() => validateStats({}, ['doc_count']));
  assert.throws(() => validateStats([], ['doc_count']));
  for (const invalid of [
    null,
    undefined,
    'failed',
    { count: -1 },
    { count: Infinity },
    { count: false },
  ])
    assert.throws(() => validateStats(invalid));
});
