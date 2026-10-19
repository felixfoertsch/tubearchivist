// Run with: node --test tests/classic-buttons.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('classic icon actions use named native buttons, not clickable images', () => {
  for (const path of ['pages/Download.tsx', 'components/Filterbar.tsx']) {
    const source = read(path);
    assert.doesNotMatch(source, /<img\b[^>]*onClick=/s);
    const buttons = [...source.matchAll(/<button\b([^>]*className="classic-icon-button"[^>]*)>/gs)];
    assert.equal(buttons.length, path.includes('Download') ? 7 : 8);
    for (const [, props] of buttons) {
      assert.match(props, /type="button"/);
      assert.match(props, /aria-label="[^"]+"/);
    }
    assert.match(source, /aria-expanded=/);
    assert.match(source, /aria-pressed=/);
    for (const image of source.matchAll(/<img\b[^>]*\/>/gs)) {
      assert.match(image[0], /alt=""/);
    }
  }
  const download = read('pages/Download.tsx');
  assert.match(download, /id="rescan-icon"/);
  assert.match(download, /id="download-icon"/);
  for (const animation of ['rotate-img', 'bounce-img', 'pulse-img']) {
    assert.ok(download.includes(animation));
  }
  for (const task of ['update_subscribed', 'download_pending']) {
    assert.ok(download.includes(`await updateTaskByName('${task}')`));
  }
  assert.match(read('components/Filterbar.tsx'), /id="animate-icon"/);
});

test('classic destructive and download controls communicate their real action', () => {
  assert.match(
    read('components/DownloadListItem.tsx'),
    /label="Forget"\s+className="danger-button"/,
  );
  const download = read('pages/Download.tsx');
  assert.match(download, /Forget ignores\s+search text and error-state filters/);
  assert.match(download, /Forget matching videos/);
  assert.match(
    download,
    /deleteDownloadQueueByFilter\(\s*showIgnoredFilter,\s*channelFilterFromUrl,\s*vidTypeFilterFromUrl,\s*\)/,
  );
  const video = read('pages/Video.tsx');
  assert.match(
    video,
    /<a\s+className="classic-button-link"\s+id="download-item"\s+download=""\s+href=\{`\$\{getApiUrl\(\)\}\$\{video.media_url\}`\}\s*>\s*Download File\s*<\/a>/,
  );
  assert.doesNotMatch(video, /<a\b[^>]*>\s*<Button/);
  const css = read('style.css');
  assert.match(css, /\.classic-icon-button:focus-visible/);
  assert.match(css, /\.classic-button-link:focus-visible/);
});
