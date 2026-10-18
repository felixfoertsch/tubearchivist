import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
const source = ts.transpileModule(
  readFileSync(new URL('../src/new/lib/player.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
runInNewContext(source, { exports, URL });
const { playerMediaUrl, playerPosition, playerProgressDue, playerSponsorSegment } = exports;

test('player resume and query positions reject nonfinite or negative values, retain explicit zero', () => {
  assert.equal(playerPosition('0', 30), 0);
  assert.equal(playerPosition('-1', 30), 30);
  assert.equal(playerPosition('Infinity', 30), 30);
  assert.equal(playerPosition('12.5'), 12.5);
});

test('URL timestamps accept seconds and bounded clock notation without changing progress parsing', () => {
  const timestamp = exports.playerTimestamp;
  assert.equal(timestamp('2', 1), 2);
  assert.equal(timestamp('0', 1), 0);
  assert.equal(timestamp('1:02:03', 1), 3723);
  assert.equal(timestamp('00:00:02', 1), 2);
  assert.equal(timestamp('00:00:01.250', 1), 1.25);
  for (const value of [
    null,
    '',
    '-1',
    'Infinity',
    '1:60:00',
    '1:00:60',
    '1:2:03',
    '00:02',
    '-1:00:00',
    '9007199254740991:00:00',
  ])
    assert.equal(timestamp(value, 1), 1);
  assert.equal(playerPosition('00:00:02', 1), 1);
});

test('player media, subtitles and metadata artwork allow only same-origin HTTP URLs without credentials', () => {
  const base = 'https://archive.invalid';
  for (const path of ['/media/video.mp4', '/media/subtitle.vtt', '/cache/artwork.jpg']) {
    assert.equal(playerMediaUrl(path, base), `${base}${path}`);
    assert.equal(playerMediaUrl(`${base}${path}`, base), `${base}${path}`);
  }
  assert.equal(
    playerMediaUrl('/media/video.mp4', 'http://localhost:8000'),
    'http://localhost:8000/media/video.mp4',
  );
  for (const url of [
    'javascript:alert(1)',
    'data:text/vtt,secret',
    '//evil.invalid/a',
    'https://user:pass@archive.invalid/a',
    'https://archive.invalid:444/a',
    'file:///media/video.mp4',
  ])
    assert.equal(playerMediaUrl(url, base), undefined);
  assert.equal(playerMediaUrl('/cache/artwork.jpg', 'not a URL'), undefined);
});

test('player progress deduplicates buckets, catches skipped events and rewind, excludes zero and short end', () => {
  assert.equal(playerProgressDue(0, 300, -1), false);
  assert.equal(playerProgressDue(10.1, 300, 0), true);
  assert.equal(playerProgressDue(10.2, 300, 1), false);
  assert.equal(playerProgressDue(21.5, 300, 1), true);
  assert.equal(playerProgressDue(20, 300, 10), true);
  assert.equal(playerProgressDue(5, 5, -1), false);
  assert.equal(playerProgressDue(300, 300, 29), true);
  assert.equal(playerProgressDue(300, 300, 30), false);
  assert.equal(playerProgressDue(NaN, 300, 0), false);
  assert.equal(playerProgressDue(Infinity, 300, 0), false);
});

test('player SponsorBlock retains skip onset window and rejects malformed ranges', () => {
  const sponsor = {
    is_enabled: true,
    last_refresh: 0,
    has_unlocked: false,
    segments: [
      {
        actionType: 'skip',
        category: 'sponsor',
        segment: [10, 20],
        UUID: 'fixture',
        videoDuration: 100,
        locked: 1,
        votes: 1,
      },
    ],
  };
  assert.equal(playerSponsorSegment(10.2, sponsor)?.UUID, 'fixture');
  assert.equal(playerSponsorSegment(10.5, sponsor), undefined);
  sponsor.segments[0].segment = [10, Infinity];
  assert.equal(playerSponsorSegment(10, sponsor), undefined);
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('progress queue waits for delayed final write before end callers can advance', async () => {
  const first = deferred();
  const final = deferred();
  const positions = [];
  const queue = exports.playerProgressQueue(
    async position => {
      positions.push(position);
      await (positions.length === 1 ? first.promise : final.promise);
    },
    () => true,
  );
  const timeupdate = queue(290);
  const pause = queue(299);
  const ended = queue(300);
  assert.equal(ended, timeupdate);
  assert.equal(pause, ended);
  let complete = false;
  void ended.then(() => {
    complete = true;
  });
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(positions, [290, 300]);
  assert.equal(complete, false);
  final.resolve();
  await ended;
  assert.equal(complete, true);
});

test('progress queue rejects failed final write, permits retry, drops queued writes after disposal', async () => {
  const waiting = deferred();
  let active = true;
  const positions = [];
  const queue = exports.playerProgressQueue(
    async position => {
      positions.push(position);
      await waiting.promise;
    },
    () => active,
  );
  const saving = queue(10);
  queue(20);
  active = false;
  waiting.resolve();
  await saving;
  assert.deepEqual(positions, [10]);
  let fail = true;
  const retryQueue = exports.playerProgressQueue(
    async () => {
      if (fail) throw new Error('fixture failure');
    },
    () => true,
  );
  await assert.rejects(retryQueue(300), /fixture failure/);
  fail = false;
  await retryQueue(300);
});

test('Cast native connection loads once per cycle and explicit connection cannot double LOAD', async () => {
  let loads = 0;
  const connection = deferred();
  const cast = exports.playerCastStart(
    async () => {
      loads++;
    },
    () => connection.promise,
    () => true,
  );
  const explicit = cast.start();
  const native = cast.connected(true);
  assert.equal(explicit, native);
  connection.resolve();
  await Promise.all([explicit, native]);
  assert.equal(loads, 1);
  await cast.connected(true);
  assert.equal(loads, 1);
  await cast.connected(false);
  await cast.connected(true);
  assert.equal(loads, 2);
});

test('Cast native-only connection loads, failed LOAD can retry, unmounted session never loads', async () => {
  let loads = 0;
  const cast = exports.playerCastStart(
    async () => {
      loads++;
      if (loads === 1) throw new Error('fixture failure');
    },
    async () => {},
    () => true,
  );
  await assert.rejects(cast.connected(true), /fixture failure/);
  await cast.start();
  assert.equal(loads, 2);
  let active = true;
  const connection = deferred();
  const disposed = exports.playerCastStart(
    async () => {
      loads++;
    },
    () => connection.promise,
    () => active,
  );
  const pending = disposed.start();
  active = false;
  connection.resolve();
  await pending;
  assert.equal(loads, 2);
});

test('Cast reconnect starts fresh LOAD while old LOAD remains pending; stale completion preserves new cycle', async () => {
  const oldLoad = deferred();
  const newLoad = deferred();
  let loads = 0;
  const cast = exports.playerCastStart(
    () => (++loads === 1 ? oldLoad.promise : newLoad.promise),
    async () => {},
    () => true,
  );
  const first = cast.connected(true);
  await new Promise(resolve => setImmediate(resolve));
  await cast.connected(false);
  const second = cast.connected(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, 2);
  assert.notEqual(first, second);
  oldLoad.resolve();
  await first;
  assert.equal(cast.connected(true), second);
  newLoad.resolve();
  await second;
  await cast.connected(true);
  assert.equal(loads, 2);
});

test('Cast reset invalidates old setup request before cleanup/setup reuse', async () => {
  const oldConnection = deferred();
  let requests = 0;
  let loads = 0;
  const cast = exports.playerCastStart(
    async () => {
      loads++;
    },
    () => (++requests === 1 ? oldConnection.promise : Promise.resolve()),
    () => true,
  );
  const old = cast.start();
  cast.reset();
  await cast.connected(true);
  oldConnection.resolve();
  await old;
  assert.equal(loads, 1);
});

test('acknowledged playlist edit refreshes navigation before failed picker reload without reporting mutation failure', async () => {
  const events = [];
  await exports.playerPlaylistChange(
    async () => {
      events.push('mutation acknowledged');
    },
    () => events.push('navigation refresh'),
    async () => {
      events.push('picker reload');
      throw new Error('fixture reload failure');
    },
    () => events.push('picker error'),
  );
  assert.deepEqual(events, [
    'mutation acknowledged',
    'navigation refresh',
    'picker reload',
    'picker error',
  ]);
  events.length = 0;
  await assert.rejects(
    exports.playerPlaylistChange(
      async () => {
        throw new Error('mutation rejected');
      },
      () => events.push('navigation refresh'),
      async () => {
        events.push('picker reload');
      },
      () => events.push('picker error'),
    ),
    /mutation rejected/,
  );
  assert.deepEqual(events, []);
});

test('earlier progress failure rejects queued terminal completion, never advances, terminal retry saves final position', async () => {
  const first = deferred();
  const positions = [];
  const queue = exports.playerProgressQueue(
    async position => {
      positions.push(position);
      if (positions.length === 1) await first.promise;
    },
    () => true,
  );
  const earlier = queue(290);
  const terminal = queue(300);
  let advances = 0;
  const result = terminal.then(() => {
    advances++;
  });
  first.reject(new Error('fixture earlier write failed'));
  await assert.rejects(earlier, /fixture earlier write failed/);
  await assert.rejects(result, /fixture earlier write failed/);
  assert.equal(advances, 0);
  await queue(300);
  assert.deepEqual(positions, [290, 300]);
});
