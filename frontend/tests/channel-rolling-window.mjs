// Run with: node --test tests/channel-rolling-window.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise real component handlers without adding a DOM or test-framework dependency.
const source = readFileSync(
  new URL('../src/components/ChannelRollingWindow.tsx', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

function mount(initialValue) {
  const state = [];
  const calls = [];
  let cursor = 0;
  let response = { status: 200 };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [
              state[index],
              value => {
                state[index] = value;
              },
            ];
          },
        };
      if (name === '../api/actions/updateChannelOverwrite')
        return {
          __esModule: true,
          default: async (...args) => {
            calls.push(args);
            if (response instanceof Error) throw response;
            return response;
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  function render() {
    cursor = 0;
    return exports.default({ channelId: 'channel-id', initialValue });
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat().flatMap(child => nodes(child))];
  }
  return {
    calls,
    response(value) {
      response = value;
    },
    input(value) {
      nodes(render())
        .find(node => node.type === 'input')
        .props.onChange({ target: { value } });
    },
    submit() {
      return nodes(render())
        .find(node => node.type === 'form')
        .props.onSubmit({ preventDefault() {} });
    },
    reset() {
      return nodes(render())
        .find(node => node.props?.children === 'Reset (disable)')
        .props.onClick();
    },
    hasRole(role) {
      return nodes(render()).some(node => node.props?.role === role);
    },
    value() {
      return nodes(render()).find(node => node.type === 'input').props.value;
    },
    disabled() {
      return nodes(render())
        .filter(node => ['input', 'button'].includes(node.type))
        .every(node => node.props.disabled);
    },
    text() {
      return JSON.stringify(render());
    },
  };
}

test('validates positive whole numbers without sending invalid requests', async () => {
  const ui = mount();
  assert.equal(ui.value(), '');
  assert.match(ui.text(), /Channel scans may be slow for large channels/);
  assert.match(
    ui.text(),
    /unavailable or members-only videos are skipped; uncertain metadata or incomplete scans postpone rolling downloads and cleanup/,
  );
  for (const value of [
    '0',
    '-1',
    '1.5',
    '1e2',
    'Infinity',
    'abc',
    '2147483648',
    '9007199254740992',
  ]) {
    ui.input(value);
    await ui.submit();
    assert.equal(ui.hasRole('alert'), true, value);
    assert.equal(ui.calls.length, 0, value);
  }
  ui.input('12');
  await ui.submit();
  assert.deepEqual(ui.calls[0], ['channel-id', 'rolling_window_size', 12]);
  assert.equal(ui.hasRole('status'), true);
  assert.match(ui.text(), /12 regular videos/);
  ui.input('2147483647');
  await ui.submit();
  assert.deepEqual(ui.calls.at(-1), ['channel-id', 'rolling_window_size', 2147483647]);
  assert.equal(ui.hasRole('status'), true);
});

test('blank and reset save null; failures preserve saved state and allow retry', async () => {
  const ui = mount(8);
  assert.equal(ui.value(), '8');
  ui.input('4');
  for (const response of [
    { status: 500 },
    { status: 200, error: { error: 'failure' } },
    new Error('offline'),
  ]) {
    ui.response(response);
    await ui.submit();
    assert.equal(ui.hasRole('alert'), true);
    assert.equal(ui.hasRole('status'), false);
    assert.match(ui.text(), /8 regular videos/);
  }
  ui.response({ status: 200 });
  ui.input('');
  await ui.submit();
  assert.equal(ui.calls.at(-1)[2], null);
  assert.equal(ui.hasRole('status'), true);
  ui.input('7');
  await ui.submit();
  await ui.reset();
  assert.equal(ui.calls.at(-1)[2], null);
  assert.equal(ui.value(), '');
  assert.match(ui.text(), /Disabled/);
});

test('pending save disables controls and ignores another submit', async () => {
  const ui = mount();
  let finish;
  ui.response(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  ui.input('5');
  const pending = ui.submit();
  assert.equal(ui.disabled(), true);
  await ui.submit();
  assert.equal(ui.calls.length, 1);
  finish({ status: 200 });
  await pending;
  assert.equal(ui.disabled(), false);
  assert.equal(ui.hasRole('status'), true);
});
