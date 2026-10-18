import type { SponsorBlockType } from '../../pages/Video';

export const PLAYER_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

export function playerPosition(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function playerTimestamp(value: string | null, fallback = 0): number {
  if (value === null || value === '') return fallback;
  if (!value.includes(':')) return playerPosition(value, fallback);
  const clock = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(value);
  if (!clock) return fallback;
  const seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  return Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER ? seconds : fallback;
}

export function playerMediaUrl(path: string, base: string): string | undefined {
  try {
    const origin = new URL(base);
    const url = new URL(path, origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin.origin ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

export function playerEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="slider"], [role="combobox"]',
      ),
    )
  );
}

export function playerSponsorSegment(time: number, sponsor?: SponsorBlockType) {
  return sponsor?.segments?.find(
    ({ actionType, segment }) =>
      actionType === 'skip' &&
      segment.length === 2 &&
      segment.every(Number.isFinite) &&
      segment[0] >= 0 &&
      segment[1] > segment[0] &&
      time >= segment[0] &&
      time <= segment[0] + 0.3,
  );
}

// Coalesce timeupdate/pause/end writes; every caller waits for the final queued position.
export function playerProgressQueue(
  write: (position: number) => Promise<void>,
  active: () => boolean,
) {
  let pending: number | undefined;
  let running: Promise<void> | undefined;
  return (position: number): Promise<void> => {
    if (!active() || !Number.isFinite(position) || position < 0) return Promise.resolve();
    pending = position;
    if (!running) {
      running = (async () => {
        try {
          while (pending !== undefined && active()) {
            const next = pending;
            pending = undefined;
            await write(next);
          }
        } finally {
          pending = undefined;
          running = undefined;
        }
      })();
    }
    return running;
  };
}

// An acknowledged edit refreshes navigation even if the independent picker reload fails.
export async function playerPlaylistChange(
  mutate: () => Promise<void>,
  refresh: () => void,
  reloadPicker: () => Promise<void>,
  pickerFailed: () => void,
) {
  await mutate();
  refresh();
  try {
    await reloadPicker();
  } catch {
    pickerFailed();
  }
}

// Native launcher and explicit button share one connection-cycle LOAD.
export function playerCastStart(
  load: () => Promise<void>,
  requestSession: () => Promise<void>,
  active: () => boolean,
) {
  let generation = 0;
  let handled = false;
  let running: Promise<void> | undefined;
  const reset = () => {
    generation++;
    handled = false;
    running = undefined;
  };
  const start = () => {
    if (!active()) return Promise.resolve();
    if (running) return running;
    handled = true;
    const cycle = generation;
    running = (async () => {
      try {
        await requestSession();
        if (active() && cycle === generation) await load();
      } catch (error) {
        if (cycle === generation) handled = false;
        throw error;
      } finally {
        if (cycle === generation) running = undefined;
      }
    })();
    return running;
  };
  return {
    start,
    reset,
    connected(value: boolean) {
      if (!value) {
        reset();
        return Promise.resolve();
      }
      return handled ? (running ?? Promise.resolve()) : start();
    },
  };
}

export function playerProgressDue(time: number, duration: number, lastBucket: number): boolean {
  return (
    Number.isFinite(time) &&
    time > 0 &&
    !(time < 10 && time === duration) &&
    Math.floor(time / 10) !== lastBucket
  );
}
