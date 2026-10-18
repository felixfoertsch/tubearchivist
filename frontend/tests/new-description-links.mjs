import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('description renderer', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ta-description-links-'));
  let server;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      cacheDir,
      configFile: false,
      server: { middlewareMode: true },
    });
    const { PlayerText } = await server.ssrLoadModule('/src/new/components/Comments.tsx');
    const render = children => renderToStaticMarkup(createElement(PlayerText, { children }));
    await t.test('HTTP and HTTPS URLs become links', () => {
      const html = render('http://example.com https://example.com/path?x=1&y=2.');
      assert.match(html, /href="http:\/\/example.com"/);
      assert.match(html, /href="https:\/\/example.com\/path\?x=1&amp;y=2"/);
      assert.equal((html.match(/<a /g) ?? []).length, 2);
    });
    await t.test('external links isolate their opener', () => {
      assert.match(render('https://example.com'), /target="_blank" rel="noopener noreferrer"/);
    });
    await t.test('newlines remain intact', () => {
      assert.match(render('First line\nSecond line'), /First line\nSecond line/);
    });
    await t.test('markup remains escaped text', () => {
      const html = render('<img src=x onerror=alert(1)>');
      assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.doesNotMatch(html, /<img/);
    });
    await t.test('unsafe schemes remain inert text', () => {
      const html = render('javascript:alert(1) data:text/html,bad file:///etc/passwd');
      assert.match(html, /javascript:alert\(1\) data:text\/html,bad file:\/\/\/etc\/passwd/);
      assert.doesNotMatch(html, /<a /);
    });
    await t.test('timestamps remain plain text without seek callback', () => {
      const html = render('01:23');
      assert.match(html, /01:23/);
      assert.doesNotMatch(html, /<button/);
    });
    await t.test('trailing punctuation stays outside link', () => {
      assert.match(render('https://example.com.'), />https:\/\/example.com<\/a>\./);
    });
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
});
