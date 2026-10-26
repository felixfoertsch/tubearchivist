// Run after npm run build: node --test tests/new-theme.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ts from 'typescript';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('only modern entry builds CSS and runtime variable bridges', () => {
  const manifest = JSON.parse(read('../dist/.vite/manifest.json'));
  const modern = manifest['index.html'];
  assert.deepEqual(
    Object.keys(manifest).filter(key => manifest[key].isEntry),
    ['index.html'],
  );
  assert.equal(manifest['old/index.html'], undefined);
  assert.equal(existsSync(new URL('../dist/old/index.html', import.meta.url)), false);
  const css = read(`../dist/${modern.css[0]}`);
  assert.match(css, /--primary:oklch\((?:0?\.525|52\.5%)/);
  assert.match(css, /--primary:oklch\((?:0?\.6496|64\.96%)/);
  assert.match(css, /font-family:var\(--theme-font-sans\)/);
  assert.match(css, /var\(--theme-shadow-sm\)/);
  assert.match(css, /var\(--theme-spacing\)/);
  assert.match(css, /border-radius:calc\(var\(--radius\)/);
  assert.doesNotMatch(css, /@import\s+url\(/);
});
test('stock Progress announces known value through Radix', () => {
  const exports = {};
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(read('../src/new/ui/progress.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: name =>
      name === '../lib/utils'
        ? { cn: (...values) => values.filter(Boolean).join(' ') }
        : require(name),
  });
  const html = renderToStaticMarkup(
    createElement(exports.Progress, { value: 20, 'aria-label': 'Watch progress' }),
  );
  assert.match(html, /aria-valuenow="20"/);
  assert.match(html, /data-state="loading"/);
});
