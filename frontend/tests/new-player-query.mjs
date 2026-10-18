import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { previewData } from './fixtures/preview-data.mjs';

const require = createRequire(import.meta.url);
const compile = path =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
const player = {};
runInNewContext(compile('../src/new/lib/player.ts'), { exports: player, URL });

test('same-video subtitle query changes seek without remounting media or resetting progress queue', () => {
  const state = [],
    effects = [];
  let cursor = 0,
    pending = [],
    query = new URLSearchParams('videoId=local-video&t=00:00:01.250');
  const media = {
    duration: 120,
    currentTime: 0,
    textTracks: { addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
    play: async () => {},
    paused: true,
  };
  const jsx = (type, props, key) => {
    if (props?.ref) props.ref.current = type === 'video' ? media : { scrollIntoView() {} };
    return { type, props, key };
  };
  const exports = {};
  runInNewContext(compile('../src/new/components/VideoPlayer.tsx'), {
    exports,
    URL,
    document: {},
    localStorage: { getItem: () => null },
    navigator: {},
    window: { addEventListener() {}, removeEventListener() {} },
    require: path => {
      if (path === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (path === 'react')
        return {
          useRef: initial => {
            const i = cursor++;
            return (state[i] ??= { current: initial });
          },
          useState: initial => {
            const i = cursor++;
            if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
            return [
              state[i],
              value => {
                state[i] = typeof value === 'function' ? value(state[i]) : value;
              },
            ];
          },
          useCallback: (fn, deps) => {
            const i = cursor++;
            if (!state[i] || deps.some((v, n) => v !== state[i].deps[n])) state[i] = { fn, deps };
            return state[i].fn;
          },
          useEffect: (fn, deps) => {
            const i = cursor++;
            if (!effects[i] || deps.some((v, n) => v !== effects[i][n])) {
              effects[i] = deps;
              pending.push(fn);
            }
          },
        };
      if (path === 'react-router-dom') return { useSearchParams: () => [query] };
      if (path.endsWith('/lib/player')) return player;
      if (path.endsWith('/getApiUrl')) return () => 'http://localhost';
      return new Proxy({}, { get: () => () => null });
    },
  });
  const props = { video: previewData().videos[0] };
  const shell = exports.default(props);
  const render = () => {
    cursor = 0;
    pending = [];
    shell.type(props);
    pending.forEach(fn => fn());
  };
  render();
  const queueRef = state.find(value => value?.current && typeof value.current === 'function');
  const queue = queueRef?.current;
  const search = {};
  const routes = {};
  runInNewContext(compile('../src/new/routes.ts'), { exports: routes });
  query.set('query', 'full:test');
  query.set('page', '2');
  let searchState = 0;
  const hits = ['00:00:03.125', '00:00:03.875'].map((subtitle_start, i) => ({
    subtitle_fragment_id: `hit-${i}`,
    youtube_id: 'local-video',
    title: 'Subtitle hit',
    subtitle_start,
    subtitle_end: '00:00:04.000',
    subtitle_line: 'Test',
    subtitle_channel: 'Fixture',
    subtitle_channel_id: 'channel',
    _score: 1,
  }));
  runInNewContext(compile('../src/new/pages/Search.tsx'), {
    exports: search,
    URLSearchParams,
    require: path => {
      if (path === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (path === 'react')
        return {
          useState: () => [
            searchState++ === 0
              ? 0
              : {
                  key: JSON.stringify(['full:test', 0, 'local-video']),
                  data: { queryType: 'full', results: { fulltext_results: hits } },
                },
            () => {},
          ],
          useEffect() {},
        };
      if (path === 'react-router-dom')
        return {
          useSearchParams: () => [
            query,
            update => {
              query = update(query);
            },
          ],
        };
      if (path === '../routes') return routes;
      return new Proxy({}, { get: () => () => null });
    },
  });
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    nodes.push(node);
    walk(node.props?.children);
  };
  walk(search.default());
  const buttons = nodes.filter(node => node.props?.children === 'Play excerpt');
  assert.equal(buttons.length, 2);
  for (const [i, position] of [3.125, 3.875].entries()) {
    assert.ok(
      nodes.some(
        node =>
          typeof node.props?.to === 'string' &&
          new URL(node.props.to, 'http://localhost').searchParams.get('t') ===
            hits[i].subtitle_start,
      ),
    );
    buttons[i].props.onClick();
    assert.equal(query.get('t'), hits[i].subtitle_start);
    assert.equal(query.get('query'), 'full:test');
    assert.equal(query.get('page'), '2');
    render();
    assert.equal(media.currentTime, position);
  }
  assert.equal(exports.default(props).key, shell.key);
  assert.equal(queueRef.current, queue);
  query = new URLSearchParams('videoId=local-video');
  render();
  render();
  assert.equal(media.currentTime, 3.875);
});
