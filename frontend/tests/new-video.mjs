import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { previewData } from './fixtures/preview-data.mjs';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(
  readFileSync(new URL('../src/new/pages/Video.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

// Exercise page rendering with loaded API state; effects/network stay outside this seam.
function renderVideo(video) {
  const exports = {};
  let state = 0;
  runInNewContext(source, {
    exports,
    localStorage: { getItem: () => null },
    require: path => {
      if (path === 'react/jsx-runtime') return require(path);
      if (path === 'react')
        return {
          useState: initial => [
            state++ === 0 ? video : typeof initial === 'function' ? initial() : initial,
            () => {},
          ],
          useEffect: () => {},
          useRef: current => ({ current }),
        };
      if (path === 'react-router-dom')
        return { useParams: () => ({ videoId: video.youtube_id }), useNavigate: () => {} };
      if (path.endsWith('/AppSettingsStore'))
        return {
          useAppSettingsStore: () => ({
            appSettingsConfig: { application: { enable_cast: false } },
          }),
        };
      return new Proxy({}, { get: () => () => null });
    },
  });
  return renderToStaticMarkup(exports.default());
}

test('video page accepts nullable or absent comment count from VideoSerializer', () => {
  const video = previewData().videos[0];
  for (const comment_count of [null, undefined, 0, 1234]) {
    const html = renderVideo({ ...video, comment_count });
    assert.match(html, /Local fixture video/);
    assert.match(html, /aria-label="Comments"/);
    if (comment_count == null) assert.doesNotMatch(html, /Comments:/);
    if (comment_count === 0) assert.match(html, /Video has no comments/);
    if (comment_count === 1234) assert.match(html, /Comments: 1,234/);
  }
});
