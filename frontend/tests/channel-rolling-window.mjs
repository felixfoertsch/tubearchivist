// Run with: node --test tests/channel-rolling-window.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise real component handlers without adding a DOM or test-framework dependency.
const source = readFileSync(new URL('../src/new/pages/Channel.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source + '\nexport { About };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

const metadata = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL('../src/new/videoMetadata.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText,
  { exports: metadata },
);

// Run actual parent mutation handler: failures must reach About's alert, not only return false.
const channelAst = ts.createSourceFile('Channel.tsx', source, ts.ScriptTarget.Latest, true);
const channel = channelAst.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'Channel',
);
const mutate = channel.body.statements.find(
  node =>
    ts.isVariableStatement(node) && node.declarationList.declarations[0].name.text === 'mutate',
);
const parentHandler = ts.transpileModule(
  mutate.getText(channelAst) + '\nexports.mutate = mutate;',
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  },
).outputText;

function mount(initialValue) {
  const state = [];
  const calls = [];
  let cursor = 0;
  let response = { status: 200 };
  let error = '';
  const parent = {};
  runInNewContext(parentHandler, {
    exports: parent,
    pending: false,
    setPending() {},
    setError: value => {
      error = value;
    },
    refresh() {},
    assertResponse: metadata.assertResponse,
    errorMessage: metadata.errorMessage,
  });
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
      if (name === '../videoMetadata') return metadata;
      if (name === '../components/useConfirm')
        return { useConfirm: () => ({ confirm: async () => true }) };
      return {};
    },
  });
  function render() {
    cursor = 0;
    return exports.About({
      channel: {
        channel_id: 'channel-id',
        channel_overwrites: { rolling_window_size: initialValue },
      },
      admin: true,
      pending: false,
      error,
      overwrite: (...args) =>
        parent.mutate(async () => {
          calls.push(['channel-id', ...args]);
          const result = await response;
          if (result instanceof Error) throw result;
          return result;
        }),
    });
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
        .find(node => node.props?.inputMode === 'numeric')
        .props.onChange({ target: { value } });
    },
    submit() {
      return nodes(render())
        .find(node => node.props?.children === 'Save rolling window')
        .props.onClick();
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
      return nodes(render()).find(node => node.props?.inputMode === 'numeric').props.value;
    },
    disabled() {
      return nodes(render()).find(node => node.props?.children === 'Save rolling window').props
        .disabled;
    },
    text() {
      return JSON.stringify(render());
    },
  };
}

test('validates positive whole numbers without sending invalid requests', async () => {
  const ui = mount();
  assert.equal(ui.value(), '');
  assert.match(ui.text(), /not a full-channel scan/);
  assert.match(ui.text(), /Pending downloads and failed or empty/);
  assert.match(ui.text(), /Deleted videos stay ignored until/);
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
  assert.match(ui.text(), /Persisted policy:.*12/);
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
    assert.match(ui.text(), /Request failed \(500\)|failure|offline/);
    assert.equal(ui.hasRole('status'), false);
    assert.match(ui.text(), /Persisted policy:.*8/);
  }
  ui.response({ status: 200 });
  ui.input('');
  await ui.submit();
  assert.equal(ui.calls.at(-1)[2], null);
  assert.equal(ui.hasRole('status'), true);
  ui.input('7');
  await ui.submit();
  ui.reset();
  await new Promise(resolve => setImmediate(resolve));
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
