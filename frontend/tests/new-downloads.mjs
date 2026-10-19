import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadPage,
  assertDownloadResponse,
  assertTaskNotifications,
  pollWhileActive,
  taskPercent,
  taskTransition,
  downloadPreviousPage,
  downloadQueryKey,
  downloadBulkScope,
} from '../src/new/lib/download.ts';

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const exports = {};
runInNewContext(
  ts.transpileModule(readFileSync(new URL('../src/new/pagination.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports },
);
const { nextPage } = exports;

test('backend first/two-page/final navigation preserves false sentinel', () => {
  const base = {
    page_size: 12,
    page_from: 0,
    current_page: 0,
    last_page: false,
    next_pages: [],
    prev_pages: null,
    total_hits: 1,
    max_hits: false,
    params: '',
  };
  const single = assertDownloadResponse({ status: 200, data: { data: [], paginate: base } });
  assert.equal(single.paginate.last_page, false);
  assert.equal(nextPage(base), undefined);
  assert.equal(downloadPreviousPage(0), undefined);
  const first = { ...base, total_hits: 20, last_page: 2 };
  assert.equal(nextPage(first), 2);
  const final = { ...base, total_hits: 20, current_page: 2, page_from: 12, prev_pages: [] };
  assert.equal(
    assertDownloadResponse({ status: 200, data: { data: [], paginate: final } }).paginate.last_page,
    false,
  );
  assert.equal(downloadPreviousPage(2), 1);
  assert.equal(nextPage(final), undefined);
  assert.equal(nextPage({ ...first, last_page: 4, next_pages: [2, 3] }), 2);
});
test('query identities include every filter and deletion scope excludes unsupported filters', () => {
  const key = downloadQueryKey(0, 'A', null, null, false, 'title');
  assert.notEqual(key, downloadQueryKey(0, 'B', null, null, false, 'title'));
  assert.notEqual(key, downloadQueryKey(0, 'A', null, 'true', false, 'title'));
  assert.equal(
    downloadBulkScope(false, 'A', 'videos'),
    'status: pending; channel: A; type: videos',
  );
  assert.equal(
    downloadBulkScope(true, null, null, 'true'),
    'status: ignore; channel: all; type: all; error: true',
  );
});

test('download API payload, pagination, and notification validation', () => {
  assert.equal(downloadPage('3'), 3);
  assert.equal(downloadPage('0'), 0);
  assert.equal(downloadPage('3.2'), 0);
  assert.equal(downloadPage(null), 0);
  const record = {
    youtube_id: 'video-id',
    title: 'Title',
    channel_id: 'channel-id',
    channel_name: 'Channel',
    status: 'pending',
    vid_type: 'videos',
    duration: '1:00',
    published: null,
  };
  const page = {
    page_size: 12,
    page_from: 0,
    current_page: 0,
    last_page: 2,
    next_pages: [],
    prev_pages: null,
    total_hits: 20,
    max_hits: false,
    params: '',
  };
  assert.deepEqual(
    assertDownloadResponse({ status: 200, data: { data: [record], paginate: page } }),
    { data: [record], paginate: page },
  );
  assert.throws(
    () => assertDownloadResponse({ status: 500, data: { data: [] } }),
    /Request failed \(500\)/,
  );
  assert.throws(
    () =>
      assertDownloadResponse({ status: 200, data: { data: [{ ...record, status: 'deleted' }] } }),
    /Invalid download queue item/,
  );
  assert.deepEqual(
    assertDownloadResponse({
      status: 200,
      data: {
        data: [record],
        paginate: {
          ...page,
          current_page: 2,
          page_from: 12,
          last_page: false,
          next_pages: [],
          prev_pages: [],
        },
      },
    }).paginate,
    { ...page, current_page: 2, page_from: 12, last_page: false, next_pages: [], prev_pages: [] },
  );
  assert.throws(
    () =>
      assertDownloadResponse({
        status: 200,
        data: { data: [], paginate: { ...page, current_page: -1 } },
      }),
    /Invalid download pagination response/,
  );
  const task = {
    id: 'task-id',
    title: 'Downloading',
    group: 'download',
    api_stop: true,
    level: 'info',
    messages: ['Video', 'Queued'],
    progress: 0.5,
    command: 'STOP',
  };
  assert.deepEqual(assertTaskNotifications([task]), [task]);
  assert.throws(
    () => assertTaskNotifications([{ id: 'bad', progress: 'half' }]),
    /Invalid task notification response/,
  );
});

test('polling continues while active and does not consume or reschedule after cleanup', async () => {
  let resolveRequest;
  let scheduled;
  let cancelled = false;
  let consumed = 0;
  let errors = 0;
  const cleanup = pollWhileActive(
    () =>
      new Promise(resolve => {
        resolveRequest = resolve;
      }),
    () => {
      consumed += 1;
      return false;
    },
    () => 3000,
    () => {
      errors += 1;
    },
    (callback, delay) => {
      scheduled = { callback, delay };
      return 1;
    },
    () => {
      cancelled = true;
    },
  );
  cleanup();
  resolveRequest([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(consumed, 0);
  assert.equal(scheduled, undefined);
  assert.equal(cancelled, true);
  assert.equal(errors, 0);
});

test('task transitions report finished runs and advancing downloads; percent is clamped', () => {
  const a = { youtube_id: 'a' };
  const plain = {};
  assert.deepEqual(taskTransition([], []), { finished: false, advanced: false });
  assert.deepEqual(taskTransition([a], [a]), { finished: false, advanced: false });
  assert.deepEqual(taskTransition([a], [{ youtube_id: 'b' }]), { finished: false, advanced: true });
  assert.deepEqual(taskTransition([a], [plain]), { finished: false, advanced: true });
  assert.deepEqual(taskTransition([plain], []), { finished: true, advanced: true });
  assert.deepEqual(taskTransition([plain], [a]), { finished: false, advanced: false });
  assert.deepEqual(
    [taskPercent(undefined), taskPercent(-1), taskPercent(0.456), taskPercent(2)],
    [0, 0, 46, 100],
  );
  const task = {
    id: 't',
    title: 'Downloading',
    api_stop: true,
    level: 'info',
    messages: [],
    youtube_id: 'a',
  };
  assert.deepEqual(assertTaskNotifications([task]), [task]);
  assert.throws(() => assertTaskNotifications([{ ...task, youtube_id: 1 }]), /Invalid task/);
});
