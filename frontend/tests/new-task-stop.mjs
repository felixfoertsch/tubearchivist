import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../src/new/components/TaskNotifications.tsx', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: false,
    },
  },
).outputText;
const nodes = node =>
  !node || typeof node !== 'object'
    ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
test('task controls expose cooperative Stop only, preserve pending and surface failure', async () => {
  const state = [],
    calls = [],
    exports = {};
  let cursor = 0,
    response = { status: 204 };
  const task = {
    id: 'task/id',
    title: 'Database backup',
    api_stop: true,
    messages: [],
    level: 'info',
  };
  const jsx = (type, props) => ({ type, props });
  runInNewContext(source, {
    exports,
    Error,
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useState: initial => {
            const i = cursor++;
            if (!(i in state)) state[i] = initial;
            return [
              state[i],
              value => {
                state[i] = value;
              },
            ];
          },
        };
      if (name.endsWith('/tasks')) return { useTaskStore: () => ({ tasks: [task] }) };
      if (name.endsWith('/APIClient'))
        return {
          default: async (...args) => {
            calls.push(args);
            return response;
          },
        };
      return {};
    },
  });
  function render() {
    cursor = 0;
    return exports.default();
  }
  const stop = () =>
    nodes(render()).find(node => node.props?.['aria-label'] === 'Stop Database backup');
  assert.ok(stop());
  assert.match(JSON.stringify(render()), /Force termination is unsupported/);
  assert.ok(!nodes(render()).some(node => /kill/i.test(node.props?.['aria-label'] || '')));
  let finish;
  response = new Promise(resolve => {
    finish = resolve;
  });
  stop().props.onClick();
  assert.equal(stop().props.disabled, true);
  assert.equal(stop().props.children, 'Stopping…');
  stop().props.onClick();
  assert.equal(calls.length, 1);
  finish({ status: 503, error: { error: 'Stop request failed' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(JSON.stringify(render()), /Stop request failed/);
  assert.equal(stop().props.disabled, false);
  assert.equal(calls[0][0], '/api/task/by-id/task%2Fid/');
  assert.equal(calls[0][1].body.command, 'stop');
  response = { status: 204 };
  stop().props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(JSON.stringify(render()), /Stop request failed/);
  for (const command of ['STOP', 'KILL']) {
    task.command = command;
    assert.equal(stop(), undefined);
  }
  task.command = undefined;
  task.api_stop = false;
  assert.equal(stop(), undefined);
});
