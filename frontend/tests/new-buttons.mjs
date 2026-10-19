import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../src/new/${path}`, import.meta.url), 'utf8');
function button(path, label) {
  const source = ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = [];
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(source).match(/^(Button|AlertDialogAction)$/)
    ) {
      if (
        node.children
          .map(child => child.getText(source))
          .join('')
          .replace(/\s+/g, ' ')
          .trim() === label
      ) {
        found.push(
          Object.fromEntries(
            node.openingElement.attributes.properties
              .filter(ts.isJsxAttribute)
              .map(prop => [prop.name.getText(source), prop.initializer?.getText(source)]),
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.length, 1, `${path}: ${label}`);
  return found[0];
}

test('constructive actions are primary; utilities and destructive consent stay distinct', () => {
  for (const label of [
    'Rescan subscriptions',
    'Start download',
    'Add to queue',
    'Save title filter',
  ]) {
    const props = button('pages/Download.tsx', label);
    assert.equal(props.variant, '"default"', label);
    assert.match(props.disabled, /pending/);
  }
  assert.equal(button('pages/Download.tsx', 'Refresh').variant, '"outline"');
  assert.equal(button('pages/Download.tsx', 'Confirm forget').variant, '"destructive"');
  assert.equal(
    button('components/useConfirm.tsx', "{request.actionLabel ?? 'Confirm'}").variant,
    "{request.variant ?? 'destructive'}",
  );
  assert.equal(button('pages/Login.tsx', "{busy ? 'Signing in…' : 'Login'}").variant, '"default"');
  assert.equal(
    button('pages/SettingsScheduling.tsx', "{pending ? 'Saving…' : 'Save schedule'}").variant,
    '"default"',
  );
  const toggle = button(
    'components/VideoActions.tsx',
    "{video.player.watched ? 'Mark unwatched' : 'Mark watched'}",
  );
  assert.equal(toggle.variant, "{video.player.watched ? 'secondary' : 'default'}");
  assert.equal(toggle['aria-pressed'], undefined);
  const subscription = button(
    'components/PlaylistList.tsx',
    "{pending ? 'Saving…' : playlist.playlist_subscribed ? 'Unsubscribe playlist' : 'Subscribe playlist'}",
  );
  assert.equal(subscription.variant, "{playlist.playlist_subscribed ? 'secondary' : 'default'}");
  assert.equal(subscription['aria-pressed'], undefined);
});

test('data-replacing snapshot and backup restore launchers stay destructive', () => {
  assert.equal(button('pages/SettingsApplication.tsx', 'Restore').variant, '"destructive"');
  assert.equal(
    button('pages/SettingsActions.tsx', "{pending === backup.filename ? 'Queuing…' : 'Restore'}")
      .variant,
    '"destructive"',
  );
});

test('stock button renders semantic variant, pressed state, and native disabled guard', () => {
  const exports = {};
  const require = createRequire(import.meta.url);
  runInNewContext(
    ts.transpileModule(read('ui/button.tsx'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      exports,
      require: name =>
        name === '../lib/utils'
          ? { cn: (...values) => values.filter(Boolean).join(' ') }
          : require(name),
    },
  );
  const html = renderToStaticMarkup(
    createElement(exports.Button, { disabled: true, 'aria-pressed': true }, 'Save'),
  );
  assert.match(html, /data-variant="default"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /disabled:opacity-50/);
});

// WCAG relative luminance: OKLCH → linear sRGB, gamut clip, encoded-sRGB alpha compositing.
const linear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encoded = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function rgb([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180),
    b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(v => Math.max(0, Math.min(1, v)));
}
const luminance = rgb =>
  rgb.reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
test('primary and destructive button text meets 4.5:1 on page/card/popover, normal and hover, both themes', () => {
  const css = read('style.css');
  for (const [theme, block] of [
    ['light', css.split(':root.new-ui {')[1].split('}')[0]],
    ['dark', css.split('.new-ui.dark {')[1].split('}')[0]],
  ]) {
    const colors = Object.fromEntries(
      [...block.matchAll(/--([\w-]+): oklch\(([^)]+)\)/g)].map(([, name, value]) => [
        name,
        rgb(value.split(' ').map(Number)),
      ]),
    );
    for (const variant of ['primary', 'destructive']) {
      const foreground = variant === 'destructive' ? [1, 1, 1] : colors['primary-foreground'];
      for (const state of ['normal', 'hover']) {
        const alpha =
          state === 'hover' ? 0.9 : variant === 'destructive' && theme === 'dark' ? 0.6 : 1;
        const ratios = ['background', 'card', 'popover'].map(surface => {
          const background = colors[variant].map((v, i) =>
            linear(encoded(v) * alpha + encoded(colors[surface][i]) * (1 - alpha)),
          );
          const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
          return (values[1] + 0.05) / (values[0] + 0.05);
        });
        const minimum = Math.min(...ratios);
        console.log(`${theme} ${variant} ${state}: ${minimum.toFixed(2)}:1 minimum`);
        assert.ok(minimum >= 4.5, `${theme} ${variant} ${state}: ${minimum}`);
      }
    }
  }
});
