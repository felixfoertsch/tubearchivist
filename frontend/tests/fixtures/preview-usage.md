# Local browser fixture runner

No production API/proxy/fetch/credential access. `127.0.0.1` binding only, same-origin mutations, restrictive CSP, every response `X-Preview-Data: LOCAL FIXTURES ONLY`. Test files stay outside Vite dist.

Run from repository root after normal frontend build:

```sh
node --test frontend/tests/*.mjs
node scripts/test-workflow.mjs
node frontend/tests/new-ui-browser-server.mjs
```

Default port 4174, default dist `frontend/dist` relative to runner file. Override only through `PREVIEW_PORT` / `PREVIEW_DIST`. Import `createPreviewServer({ dist })`, then `await preview.listen(0)` for isolated HTTP tests; `await preview.close()` afterwards. `.listen` always binds loopback. No new test dependencies.

Use actual mounted React bundle at `/new/`; deep `/new/*` paths always serve modern entry, other extensionless paths classic entry. This does NOT prove client router recognizes those paths. Missing assets fail 404, unknown API/method fails 501. Inspect browser network failures rather than interpreting absent results as parity.

Local control requests (browser same-origin `fetch`):

```js
await fetch('/__preview__/reset', { method: 'POST' });
await fetch('/__preview__/state', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    account: 'ordinary',
    mode: 'success',
    delay: 0,
    delayPath: '',
    mutationStatus: 200,
    failurePath: '',
  }),
});
const state = await (await fetch('/__preview__/state')).json();
```

- Accounts: `admin` (staff), `ordinary`, `anonymous`. Changing account then refresh exercises loader. Login requires exact synthetic username `admin` or `ordinary` with password `LOCAL_FIXTURE_PASSWORD`; invalid credentials return 400. Success and logout return 204 with empty body, matching backend contract. Injected 403 does not change session. Never enter real credentials.
- Modes: `success`, `empty`, `error`. Empty applies collection/search/comment results. `error` yields 500 on all API paths or only `failurePath` when supplied; reset mode to retry.
- `delay`: integer 0–5000 ms; optional `delayPath` scopes delay to one API path. Set delay, trigger first request, remove delay and trigger next request for stale-response tests. Request-local delay duration is captured before timer starts.
- `mutationStatus`: 200 / 400 / 401 / 403 / 500, independent of read responses. Does not modify memory on injected failure. State action log holds successful request attempts with route/method/path, allowlisted query/payload fields; login/cookie/token/membership/notification secrets/URLs never logged. Failed permission/injected-failure writes are not in action log.
- `/__preview__/reset` resets all in-memory data/account/modes/action log. No disk mutations.

IDs: channel `UC_LOCAL_FIXTURE`, video `local-video`, playlist `PL_LOCAL_FIXTURE`, custom playlist `local-custom`; queue `local-pending`, `local-error`, `local-ignored`. Statistics, config, scheduling, snapshots, backups, cookie state, synthetic token, membership profile, playlist/video navigation, comments/replies, subtitles are local data. Pending/ignored/type/channel/title/error filters have sample queue records.

Media: generated 12-second silent mono PCM WAV at `/__preview__/sample.wav`, supports byte ranges; local VTT at `/__preview__/subtitle.vtt`. Useful for metadata/seek/resume/end/progress events if browser accepts audio in video element. Optional real video: `PREVIEW_MEDIA=/private/tmp/opencode/ta-flower.mp4 node frontend/tests/new-ui-browser-server.mjs`. This exact approved local file only is served at `/media/fixture.mp4` after size 1128375, MP4 `ftyp`, SHA-256 `0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451` checks. Source: CC0 `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4`, downloaded explicitly during verification, never by runner or tests. Binary stays outside repository/dist. Run optional HTTP media test with same `PREVIEW_MEDIA` env. Same-origin frame route `/__preview__/frame?width=320` supports widths 320/390/1280 only. No codec matrix, real Google Cast or autoplay-policy guarantee.

## Coverage ceilings

HTTP self-check proves fixture modes, permissions, mutation failures, in-memory state, reset, safe log, MIME/static traversal/symlink guard, range media. It is explicitly NOT a DOM test. Parent must run mounted browser checks on integrated dist.

Some operational writes intentionally return local task acknowledgements (reindex/import/rescan/backup/snapshot/Apprise test), without real job scheduling, external notification, credential validation or filesystem changes. Bulk subscriptions support existing fixture IDs only; new unknown IDs fail 501. Custom reorder fixture has two entries; similar/next/previous results positive; list pagination uses one record per page with bounded page number 1–10000; filtering/sorting not complete backend simulation. Native media, polling progress, multi-item reorder, race cancellation, keyboard/focus/mobile/light-dark, route completeness and CSS isolation require mounted checks and/or fixture extension. Do not claim full parity from this runner.
