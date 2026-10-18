import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewData, ids } from './fixtures/preview-data.mjs';

const defaultDist = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.vtt': 'text/vtt',
};
const routes = [
  ['ping', /^\/api\/ping\/$/, ['GET']],
  ['login', /^\/api\/user\/login\/$/, ['POST']],
  ['logout', /^\/api\/user\/logout\/$/, ['POST']],
  ['account', /^\/api\/user\/account\/$/, ['GET']],
  ['user', /^\/api\/user\/me\/$/, ['GET', 'POST']],
  ['config', /^\/api\/appsettings\/config\/$/, ['GET', 'POST']],
  ['video-list', /^\/api\/video\/$/, ['GET']],
  ['video', /^\/api\/video\/([\w-]+)\/$/, ['GET', 'DELETE']],
  [
    'video-extra',
    /^\/api\/video\/([\w-]+)\/(progress|nav|comment|similar)\/$/,
    ['GET', 'POST', 'DELETE'],
  ],
  ['channel-list', /^\/api\/channel\/$/, ['GET', 'POST']],
  ['channel', /^\/api\/channel\/([\w-]+)\/$/, ['GET', 'POST', 'DELETE']],
  ['channel-extra', /^\/api\/channel\/([\w-]+)\/(nav|aggs)\/$/, ['GET']],
  ['playlist-list', /^\/api\/playlist\/$/, ['GET', 'POST']],
  ['custom-create', /^\/api\/playlist\/custom\/$/, ['POST']],
  ['custom', /^\/api\/playlist\/custom\/([\w-]+)\/$/, ['POST']],
  ['playlist', /^\/api\/playlist\/([\w-]+)\/$/, ['GET', 'POST', 'DELETE']],
  ['queue', /^\/api\/download\/$/, ['GET', 'POST', 'PATCH', 'DELETE']],
  ['queue-aggs', /^\/api\/download\/aggs\/$/, ['GET']],
  ['queue-item', /^\/api\/download\/([\w-]+)\/$/, ['GET', 'POST', 'DELETE']],
  ['search', /^\/api\/search\/$/, ['GET']],
  ['watched', /^\/api\/watched\/$/, ['POST']],
  ['notification', /^\/api\/notification\/$/, ['GET']],
  ['refresh', /^\/api\/refresh\/$/, ['GET', 'POST']],
  [
    'stats',
    /^\/api\/stats\/(video|channel|playlist|download|watch|downloadhist|biggestchannels)\/$/,
    ['GET'],
  ],
  ['schedule', /^\/api\/task\/schedule\/$/, ['GET']],
  ['schedule-item', /^\/api\/task\/schedule\/([\w-]+)\/$/, ['POST', 'DELETE']],
  ['apprise', /^\/api\/task\/notification\/$/, ['GET', 'POST', 'DELETE']],
  ['apprise-test', /^\/api\/task\/notification\/test\/$/, ['POST']],
  ['task', /^\/api\/task\/(by-name|by-id)\/([\w-]+)\/$/, ['GET', 'POST']],
  ['cookie', /^\/api\/appsettings\/cookie\/$/, ['GET', 'POST', 'PUT', 'DELETE']],
  ['token', /^\/api\/appsettings\/token\/$/, ['GET', 'DELETE']],
  ['snapshot', /^\/api\/appsettings\/snapshot\/$/, ['GET', 'POST']],
  ['snapshot-item', /^\/api\/appsettings\/snapshot\/([\w-]+)\/$/, ['POST']],
  ['backup', /^\/api\/appsettings\/backup\/$/, ['GET', 'POST']],
  ['backup-item', /^\/api\/appsettings\/backup\/([\w.-]+)\/$/, ['POST']],
  ['maintenance', /^\/api\/appsettings\/(manual-import|rescan-filesystem)\/$/, ['POST']],
  [
    'membership',
    /^\/api\/appsettings\/membership\/(token|profile|sync)\/$/,
    ['GET', 'POST', 'DELETE'],
  ],
];

async function bodyOf(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 65536) throw new Error('Body too large');
  }
  const body = text ? JSON.parse(text) : {};
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Expected object');
  return body;
}
const copy = value => structuredClone(value);
const safeFields = new Set([
  'id',
  'is_watched',
  'position',
  'status',
  'action',
  'video_id',
  'channel_id',
  'channel_subscribed',
  'playlist_id',
  'playlist_subscribed',
  'playlist_name',
  'playlist_sort_order',
  'schedule',
  'task_name',
  'command',
  'ignore_error',
  'prefer_local',
  'days',
  'rotate',
  'auto_ignore_filter',
  'rolling_window_size',
  'download_format',
  'autodelete_days',
  'index_playlists',
  'integrate_sponsorblock',
  'subscriptions_channel_size',
  'subscriptions_live_channel_size',
  'subscriptions_shorts_channel_size',
  ...Object.keys(previewData().user),
  ...Object.keys(previewData().config.subscriptions),
  ...Object.keys(previewData().config.downloads),
  ...Object.keys(previewData().config.application),
]);
// Keep only named noncredential fields; strings bounded to avoid accidental diagnostic dumps.
function safePayload(body) {
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    if (
      [
        'data',
        'channel_overwrites',
        'subscriptions',
        'downloads',
        'application',
        'config',
      ].includes(key)
    ) {
      if (Array.isArray(value)) result[key] = value.slice(0, 20).map(safePayload);
      else if (value && typeof value === 'object') result[key] = safePayload(value);
    } else if (
      safeFields.has(key) &&
      !['pot_provider_url'].includes(key) &&
      (value === null || ['string', 'boolean', 'number'].includes(typeof value))
    )
      result[key] = typeof value === 'string' ? value.slice(0, 256) : value;
  }
  return result;
}
const merge = (target, patch) => {
  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(patch, key)) continue;
    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]))
        merge(target[key], patch[key]);
    } else target[key] = patch[key];
  }
  return target;
};

/** Local fixtures only. Never fetches/proxies any request or loads application credentials. */
export function createPreviewServer({ dist = defaultDist, fixtureMedia } = {}) {
  if (fixtureMedia && resolve(fixtureMedia) !== '/private/tmp/opencode/ta-flower.mp4')
    throw new Error('Only approved local CC0 fixture media path allowed');
  let data, state, actions, apiReads;
  const reset = () => {
    data = previewData();
    if (fixtureMedia)
      for (const video of data.videos) {
        video.media_url = '/media/fixture.mp4';
        video.player.duration = 5.055;
        video.player.duration_str = '00:00:05';
        video.player.position = 1;
      }
    state = {
      account: 'admin',
      mode: 'success',
      delay: 0,
      mutationStatus: 200,
      failurePath: '',
      delayPath: '',
      taskMode: 'idle',
    };
    actions = [];
    apiReads = [];
  };
  reset();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Preview-Data', 'LOCAL FIXTURES ONLY');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'",
    );
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    try {
      const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
      if (!localHost.test(request.headers.host || ''))
        return send(403, { error: 'Local host only' });
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
        return send(403, { error: 'Local same-origin only' });
      const rawPath = (request.url || '/').split('?')[0];
      const decoded = decodeURIComponent(rawPath);
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded.split('/').some(part => part === '..' || part === '.')
      )
        return send(403, { error: 'Unsafe path' });
      const url = new URL(request.url, 'http://127.0.0.1');
      const path = url.pathname;
      if (path === '/media/fixture.mp4' && ['GET', 'HEAD'].includes(request.method)) {
        if (!fixtureMedia)
          return send(404, { error: 'Approved local fixture media not configured' });
        const media = await readFile(fixtureMedia);
        if (
          media.length !== 1128375 ||
          createHash('sha256').update(media).digest('hex') !==
            '0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451' ||
          media.toString('ascii', 4, 8) !== 'ftyp'
        )
          return send(500, { error: 'Approved local fixture media verification failed' });
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (request.headers.range && !range) {
          response.writeHead(416, { 'Content-Range': `bytes */${media.length}` });
          return response.end();
        }
        const start = range ? Number(range[1]) : 0,
          end = range && range[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= media.length
        ) {
          response.writeHead(416, { 'Content-Range': `bytes */${media.length}` });
          return response.end();
        }
        response.writeHead(range ? 206 : 200, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
        });
        return response.end(request.method === 'HEAD' ? undefined : media.subarray(start, end + 1));
      }
      if (path.startsWith('/__preview__/')) {
        if (path === '/__preview__/frame' && request.method === 'GET') {
          const width = Number(url.searchParams.get('width') || 320);
          if (![320, 390, 1280].includes(width))
            return send(400, { error: 'Unsupported frame width' });
          response.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'self'",
          );
          response.writeHead(200, { 'Content-Type': mime['.html'] });
          return response.end(
            `<!doctype html><title>LOCAL FIXTURES ONLY</title><p>LOCAL FIXTURES ONLY · ${width}px</p><iframe title="Local modern UI" src="/new/" style="width:${width}px;height:850px;border:1px solid"></iframe>`,
          );
        }
        if (path === '/__preview__/reset' && request.method === 'POST') {
          reset();
          return send(200, state);
        }
        if (path === '/__preview__/state' && request.method === 'GET')
          return send(200, { ...state, actions, apiReads });
        if (path === '/__preview__/state' && request.method === 'POST') {
          const body = await bodyOf(request);
          if (
            body.account !== undefined &&
            !['admin', 'ordinary', 'anonymous'].includes(body.account)
          )
            return send(400, { error: 'Invalid account' });
          if (body.mode !== undefined && !['success', 'empty', 'error'].includes(body.mode))
            return send(400, { error: 'Invalid mode' });
          if (body.taskMode !== undefined && !['idle', 'running', 'error'].includes(body.taskMode))
            return send(400, { error: 'Invalid task mode' });
          if (
            body.delay !== undefined &&
            (!Number.isInteger(body.delay) || body.delay < 0 || body.delay > 5000)
          )
            return send(400, { error: 'Invalid delay' });
          if (
            body.mutationStatus !== undefined &&
            ![200, 400, 401, 403, 500].includes(body.mutationStatus)
          )
            return send(400, { error: 'Invalid mutation status' });
          if (
            body.failurePath !== undefined &&
            (typeof body.failurePath !== 'string' ||
              (body.failurePath !== '' && !routes.some(([, re]) => re.test(body.failurePath))))
          )
            return send(400, { error: 'Invalid failure path' });
          if (
            body.delayPath !== undefined &&
            (typeof body.delayPath !== 'string' ||
              (body.delayPath !== '' && !routes.some(([, re]) => re.test(body.delayPath))))
          )
            return send(400, { error: 'Invalid delay path' });
          merge(state, body);
          return send(200, state);
        }
        if (path === '/__preview__/image.svg' && request.method === 'GET') {
          response.writeHead(200, { 'Content-Type': mime['.svg'] });
          return response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#153f48"/><text x="40" y="180" fill="white" font-size="32">LOCAL FIXTURE ONLY</text></svg>',
          );
        }
        // Generated silent PCM WAV: seek/resume/end test seam, not visual video/codec coverage.
        if (path === '/__preview__/sample.wav' && ['GET', 'HEAD'].includes(request.method)) {
          const sampleRate = 8000,
            seconds = 12,
            bytes = sampleRate * seconds * 2;
          const wav = Buffer.alloc(44 + bytes);
          wav.write('RIFF', 0);
          wav.writeUInt32LE(36 + bytes, 4);
          wav.write('WAVEfmt ', 8);
          wav.writeUInt32LE(16, 16);
          wav.writeUInt16LE(1, 20);
          wav.writeUInt16LE(1, 22);
          wav.writeUInt32LE(sampleRate, 24);
          wav.writeUInt32LE(sampleRate * 2, 28);
          wav.writeUInt16LE(2, 32);
          wav.writeUInt16LE(16, 34);
          wav.write('data', 36);
          wav.writeUInt32LE(bytes, 40);
          const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
          const start = range ? Number(range[1]) : 0,
            end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
          if (start > end || start >= wav.length) {
            response.writeHead(416, { 'Content-Range': `bytes */${wav.length}` });
            return response.end();
          }
          response.writeHead(range ? 206 : 200, {
            'Content-Type': 'audio/wav',
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}),
          });
          return response.end(request.method === 'HEAD' ? undefined : wav.subarray(start, end + 1));
        }
        if (path === '/__preview__/subtitle.vtt' && request.method === 'GET') {
          response.writeHead(200, { 'Content-Type': mime['.vtt'] });
          return response.end('WEBVTT\n\n00:00.000 --> 00:05.000\nLocal fixture subtitle.\n');
        }
        return send(404, { error: 'No fixture media: playback not covered' });
      }
      if (path.startsWith('/api/')) {
        const route = routes.find(
          ([, re, methods]) => methods.includes(request.method) && re.test(path),
        );
        if (!route) return send(501, { error: 'Unhandled local API fixture' });
        const [name, pattern] = route;
        const match = path.match(pattern);
        const write = request.method !== 'GET';
        if (!write) {
          const query = new URLSearchParams();
          const enums = {
            filter: [
              'pending',
              'ignore',
              'subscribed',
              'unsubscribed',
              'download',
              'settings',
              'channel',
              'all',
            ],
            type: ['videos', 'shorts', 'streams', 'regular', 'custom'],
            vid_type: ['videos', 'shorts', 'streams'],
            watch: ['watched', 'unwatched', 'continue'],
            order: ['asc', 'desc', 'doc_count', 'duration', 'media_size'],
            sort: [
              'published',
              'downloaded',
              'views',
              'likes',
              'duration',
              'mediasize',
              'width',
              'height',
            ],
            subscribed: ['true', 'false'],
            error: ['true', 'false'],
          };
          for (const [key, values] of Object.entries(enums))
            if (values.includes(url.searchParams.get(key)))
              query.set(key, url.searchParams.get(key));
          for (const key of ['page', 'height'])
            if (/^\d{1,5}$/.test(url.searchParams.get(key) || ''))
              query.set(key, url.searchParams.get(key));
          for (const key of ['channel', 'playlist'])
            if ([ids.channel, ids.playlist, ids.custom].includes(url.searchParams.get(key)))
              query.set(key, url.searchParams.get(key));
          const safePath = path.replace(/[\w.-]+(?=\/)/g, segment =>
            [
              'api',
              'user',
              'appsettings',
              'video',
              'channel',
              'playlist',
              'download',
              'stats',
              'task',
              'membership',
              'ping',
              'account',
              'me',
              'config',
              'aggs',
              'nav',
              'progress',
              'comment',
              'similar',
              'search',
              'notification',
              'refresh',
              'schedule',
              'token',
              'cookie',
              'snapshot',
              'backup',
              'by-name',
              'by-id',
              'profile',
              'sync',
              'watch',
              'downloadhist',
              'biggestchannels',
              ids.channel,
              ids.video,
              ids.playlist,
              ids.custom,
              'local-second',
              'local-pending',
              'local-error',
              'local-ignored',
            ].includes(segment)
              ? segment
              : ':fixture-id',
          );
          apiReads.push({ route: name, method: 'GET', path: safePath, query: query.toString() });
          if (apiReads.length > 500) apiReads.shift();
        }
        if (state.delay && (!state.delayPath || path === state.delayPath))
          await new Promise(resolveDelay => setTimeout(resolveDelay, state.delay));
        if (name !== 'login' && state.account === 'anonymous')
          return send(401, { error: 'Synthetic unauthenticated account' });
        const adminRead = [
          'queue',
          'queue-aggs',
          'queue-item',
          'schedule',
          'schedule-item',
          'apprise',
          'apprise-test',
          'task',
          'refresh',
          'cookie',
          'token',
          'snapshot',
          'snapshot-item',
          'backup',
          'backup-item',
          'maintenance',
          'membership',
        ];
        const ordinaryWrite = ['login', 'logout', 'user', 'watched', 'video-extra'];
        if (
          state.account === 'ordinary' &&
          (adminRead.includes(name) || (write && !ordinaryWrite.includes(name)))
        )
          return send(403, { error: 'Synthetic admin permission required' });
        if (
          (state.mode === 'error' && (!state.failurePath || path === state.failurePath)) ||
          (write && state.mutationStatus !== 200)
        )
          return send(write ? (state.mutationStatus === 200 ? 500 : state.mutationStatus) : 500, {
            error: 'Synthetic local fixture failure',
          });
        const body = write ? await bodyOf(request) : {};
        // Never log headers, login body, cookies, tokens or notification URLs.
        if (write) {
          const query = new URLSearchParams();
          for (const key of [
            'filter',
            'channel',
            'vid_type',
            'error',
            'delete_videos',
            'extract_videos',
            'autostart',
            'flat',
            'force',
          ])
            if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key).slice(0, 256));
          actions.push({
            route: name,
            method: request.method,
            path,
            query: query.toString(),
            payload: ['login', 'cookie', 'token', 'membership', 'apprise', 'apprise-test'].includes(
              name,
            )
              ? {}
              : safePayload(body),
          });
        }
        const empty = state.mode === 'empty';
        const list = rows => {
          const page = Number(url.searchParams.get('page') || 0),
            size = 1;
          const from = page > 1 ? (page - 1) * size : 0;
          if (!Number.isInteger(page) || page < 0 || from >= 10000)
            throw new Error('Invalid fixture page');
          const count = empty ? 0 : rows.length,
            last = Math.ceil(Math.min(count, 10000) / size);
          const params = new URLSearchParams(url.searchParams);
          params.delete('page');
          return {
            data: empty ? [] : rows.slice(from, from + size),
            config: { ...data.config.application, downloads: data.config.downloads },
            paginate: {
              current_page: page,
              page_size: size,
              page_from: from,
              total_hits: count,
              last_page: page < last && last > 1 ? last : false,
              prev_pages:
                page <= 1
                  ? null
                  : Array.from({ length: 5 }, (_, i) => page - 1 - i)
                      .filter(i => i > 1)
                      .reverse(),
              next_pages: Array.from({ length: 5 }, (_, i) => page + 1 + i).filter(
                i => i > 1 && i < last,
              ),
              max_hits: count >= 10000,
              params: params.toString(),
            },
          };
        };
        const ok = () =>
          send(200, {
            success: true,
            message: 'Local fixture mutation only',
            task_id: 'local-task',
          });
        switch (name) {
          case 'ping':
            return send(200, {
              response: 'pong',
              user: 1,
              version: 'LOCAL FIXTURE',
              ta_update: false,
            });
          case 'login':
            if (
              !['admin', 'ordinary'].includes(body.username) ||
              body.password !== 'LOCAL_FIXTURE_PASSWORD'
            )
              return send(400, { error: 'Invalid credentials' });
            state.account = body.username;
            response.writeHead(204);
            return response.end();
          case 'logout':
            state.account = 'anonymous';
            response.writeHead(204);
            return response.end();
          case 'account':
            return send(200, {
              id: 1,
              name: state.account === 'admin' ? 'Local admin' : 'Local ordinary user',
              is_staff: state.account === 'admin',
              is_superuser: false,
              groups: [],
              user_permissions: [],
              last_login: '2026-01-12T10:00:00Z',
            });
          case 'user':
            return send(200, write ? merge(data.user, body) : data.user);
          case 'config':
            return send(200, write ? merge(data.config, body) : data.config);
          case 'video-list':
            return send(
              200,
              list(
                data.videos.filter(
                  v =>
                    (!url.searchParams.has('type') ||
                      v.vid_type === url.searchParams.get('type')) &&
                    (!url.searchParams.has('watch') ||
                      (url.searchParams.get('watch') === 'watched'
                        ? v.player.watched
                        : url.searchParams.get('watch') === 'unwatched'
                          ? !v.player.watched
                          : v.player.position > 0)),
                ),
              ),
            );
          case 'video': {
            const video = data.videos.find(v => v.youtube_id === match[1]);
            if (!video) return send(404, { error: 'No fixture video' });
            if (write) {
              data.videos = data.videos.filter(v => v !== video);
              return ok();
            }
            return send(200, video);
          }
          case 'video-extra': {
            const video = data.videos.find(v => v.youtube_id === match[1]);
            if (!video) return send(404, { error: 'No fixture video' });
            if (match[2] === 'progress') {
              if (request.method === 'POST') {
                if (!Number.isFinite(body.position) || body.position < 0)
                  return send(400, { error: 'Invalid position' });
                video.player.position = body.position;
              }
              if (request.method === 'DELETE') video.player.position = 0;
              return send(200, { ...video.player, youtube_id: video.youtube_id, watched_date: 0 });
            }
            if (write) return send(501, { error: 'Unhandled local API method' });
            if (match[2] === 'similar')
              return send(200, empty ? [] : data.videos.filter(v => v.youtube_id !== match[1]));
            if (match[2] === 'comment') return send(200, empty ? [] : data.comments);
            return send(
              200,
              empty
                ? []
                : [
                    {
                      playlist_meta: {
                        current_idx: 0,
                        playlist_id: ids.playlist,
                        playlist_name: data.playlists[0]?.playlist_name,
                        playlist_channel: data.channel.channel_name,
                      },
                      playlist_previous:
                        match[1] === 'local-second' ? data.playlists[0].playlist_entries[0] : null,
                      playlist_next:
                        match[1] === ids.video ? data.playlists[0].playlist_entries[1] : null,
                    },
                  ],
            );
          }
          case 'channel-list':
            if (write) {
              if (!Array.isArray(body.data)) return send(400, { error: 'Channel data required' });
              for (const item of body.data) {
                if (item.channel_id !== ids.channel)
                  return send(501, { error: 'Only fixture channel subscription supported' });
                data.channel.channel_subscribed = Boolean(item.channel_subscribed);
              }
              return ok();
            }
            return send(
              200,
              list(
                data.channel &&
                  (!url.searchParams.has('filter') ||
                    data.channel.channel_subscribed ===
                      (url.searchParams.get('filter') === 'subscribed'))
                  ? [data.channel]
                  : [],
              ),
            );
          case 'channel':
            if (!data.channel || match[1] !== ids.channel)
              return send(404, { error: 'No fixture channel' });
            if (request.method === 'DELETE') {
              data.channel = null;
              return ok();
            }
            return send(200, write ? merge(data.channel, body) : data.channel);
          case 'channel-extra':
            return send(
              200,
              match[2] === 'nav'
                ? {
                    has_streams: true,
                    has_shorts: true,
                    has_playlists: true,
                    has_pending: true,
                    has_ignored: true,
                  }
                : {
                    total_items: { value: data.videos.length },
                    total_size: { value: 4096 },
                    total_duration: { value: 120, value_str: '00:02:00' },
                  },
            );
          case 'playlist-list':
            if (write) {
              if (!Array.isArray(body.data)) return send(400, { error: 'Playlist data required' });
              for (const item of body.data) {
                const p = data.playlists.find(p => p.playlist_id === item.playlist_id);
                if (!p) return send(501, { error: 'Only fixture playlist subscription supported' });
                p.playlist_subscribed = Boolean(item.playlist_subscribed);
              }
              return ok();
            }
            return send(
              200,
              list(
                data.playlists.filter(
                  p =>
                    (!url.searchParams.has('type') ||
                      p.playlist_type === url.searchParams.get('type')) &&
                    (!url.searchParams.has('subscribed') ||
                      p.playlist_subscribed === (url.searchParams.get('subscribed') === 'true')),
                ),
              ),
            );
          case 'playlist': {
            const p = data.playlists.find(p => p.playlist_id === match[1]);
            if (!p) return send(404, { error: 'No fixture playlist' });
            if (request.method === 'DELETE') {
              data.playlists = data.playlists.filter(item => item !== p);
              return ok();
            }
            return send(200, write ? merge(p, body) : p);
          }
          case 'custom-create': {
            if (typeof body.playlist_name !== 'string' || !body.playlist_name.trim())
              return send(400, { error: 'Name required' });
            const p = {
              ...copy(previewData().playlists[1]),
              playlist_id: `local-custom-${data.playlists.length}`,
              playlist_name: body.playlist_name,
              playlist_entries: [],
            };
            data.playlists.push(p);
            return send(200, p);
          }
          case 'custom': {
            const p = data.playlists.find(p => p.playlist_id === match[1]);
            if (!p) return send(404, { error: 'No fixture playlist' });
            if (body.action === 'remove')
              p.playlist_entries = p.playlist_entries.filter(v => v.youtube_id !== body.video_id);
            else if (body.action === 'create')
              p.playlist_entries.push({
                ...previewData().playlists[0].playlist_entries[0],
                youtube_id: body.video_id,
              });
            else if (!['up', 'down', 'top', 'bottom'].includes(body.action))
              return send(400, { error: 'Invalid playlist action' });
            else {
              const index = p.playlist_entries.findIndex(v => v.youtube_id === body.video_id);
              if (index < 0) return send(404, { error: 'No fixture playlist entry' });
              const target =
                body.action === 'top'
                  ? 0
                  : body.action === 'bottom'
                    ? p.playlist_entries.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          p.playlist_entries.length - 1,
                          index + (body.action === 'up' ? -1 : 1),
                        ),
                      );
              const [entry] = p.playlist_entries.splice(index, 1);
              p.playlist_entries.splice(target, 0, entry);
            }
            p.playlist_entries.forEach((entry, index) => {
              entry.idx = index;
            });
            return send(200, p);
          }
          case 'queue': {
            const selected = data.queue.filter(
              v =>
                (!url.searchParams.has('filter') || v.status === url.searchParams.get('filter')) &&
                (!url.searchParams.has('channel') ||
                  v.channel_id === url.searchParams.get('channel')) &&
                (!url.searchParams.has('vid_type') ||
                  v.vid_type === url.searchParams.get('vid_type')) &&
                (!url.searchParams.has('error') ||
                  Boolean(v.message) === (url.searchParams.get('error') === 'true')) &&
                (!url.searchParams.has('q') ||
                  v.title.toLowerCase().includes(url.searchParams.get('q').toLowerCase())),
            );
            if (!write) return send(200, list(selected));
            if (request.method === 'DELETE')
              data.queue = data.queue.filter(v => !selected.includes(v));
            else if (request.method === 'PATCH')
              for (const v of selected) {
                if (body.status === 'clear_error') delete v.message;
                else v.status = body.status;
              }
            else if (Array.isArray(body.data))
              for (const item of body.data) {
                if (typeof item.youtube_id !== 'string')
                  return send(400, { error: 'Invalid fixture ID' });
                data.queue.push({
                  ...copy(previewData().queue[0]),
                  youtube_id: item.youtube_id,
                  title: 'Locally added queue item',
                });
              }
            else return send(400, { error: 'Queue data required' });
            return ok();
          }
          case 'queue-item': {
            const v = data.queue.find(v => v.youtube_id === match[1]);
            if (!v) return send(404, { error: 'No fixture queue item' });
            if (request.method === 'DELETE') data.queue = data.queue.filter(item => item !== v);
            else if (write) v.status = body.status;
            return send(200, v);
          }
          case 'queue-aggs':
            return send(200, {
              doc_count_error_upper_bound: 0,
              sum_other_doc_count: 0,
              buckets: empty
                ? []
                : [
                    {
                      key: ['Local fixture channel', ids.channel],
                      key_as_string: 'Local fixture channel',
                      doc_count: data.queue.length,
                    },
                  ],
            });
          case 'search':
            return send(200, {
              queryType: 'simple',
              results: {
                video_results: empty ? [] : data.videos,
                channel_results: empty || !data.channel ? [] : [data.channel],
                playlist_results: empty ? [] : data.playlists,
                fulltext_results: empty
                  ? []
                  : [
                      {
                        subtitle_index: 0,
                        subtitle_line:
                          '<span class="settings-current">Synthetic</span> subtitle fragment',
                        subtitle_start: '00:00:05.000',
                        subtitle_fragment_id: 'local-fragment',
                        subtitle_end: '00:00:08.000',
                        youtube_id: ids.video,
                        title: 'Local fixture video',
                        subtitle_channel: 'Local fixture channel',
                        subtitle_channel_id: ids.channel,
                        subtitle_last_refresh: 1768212000,
                        subtitle_lang: 'en',
                        subtitle_source: 'user',
                        vid_thumb_url: '/__preview__/image.svg',
                        _index: 'ta_subtitle',
                        _score: 1,
                      },
                    ],
              },
            });
          case 'watched':
            for (const v of data.videos)
              if ([v.youtube_id, ids.channel, ids.playlist, ids.custom].includes(body.id))
                v.player.watched = Boolean(body.is_watched);
            return ok();
          case 'stats':
            return send(200, data.stats[match[1]]);
          case 'notification':
            return send(
              200,
              state.taskMode === 'idle'
                ? []
                : [
                    {
                      id: 'local-task',
                      title: 'Local fixture task',
                      group: 'download',
                      progress: 0.5,
                      messages: [
                        state.taskMode === 'error'
                          ? 'Synthetic task error'
                          : 'Synthetic task running',
                      ],
                      api_stop: true,
                      level: state.taskMode === 'error' ? 'error' : 'info',
                      command: false,
                    },
                  ],
            );
          case 'refresh':
            return write ? ok() : send(200, { state: 'idle' });
          case 'schedule':
            return send(200, empty ? [] : data.schedules);
          case 'schedule-item':
            data.schedules = data.schedules.filter(s => s.name !== match[1]);
            if (request.method === 'POST')
              data.schedules.push({
                name: match[1],
                schedule: body.schedule,
                schedule_human: body.schedule,
                config: body.config || {},
                last_run_at: '',
              });
            return ok();
          case 'apprise':
            if (write) {
              const name = body.task_name;
              if (
                ![
                  'check_reindex',
                  'download_pending',
                  'extract_download',
                  'update_subscribed',
                ].includes(name)
              )
                return send(400, { error: 'Invalid task' });
              const task = (data.notifications[name] ||= { title: name, urls: [] });
              if (request.method === 'DELETE') task.urls = task.urls.filter(u => u !== body.url);
              else task.urls.push(body.url);
            }
            return send(200, data.notifications);
          case 'apprise-test':
            return ok();
          case 'task':
            if (write && match[1] === 'by-id') {
              if (match[2] !== 'local-task') return send(404, { error: 'No fixture task' });
              if (!['stop', 'kill'].includes(body.command))
                return send(400, { error: 'Invalid task command' });
              state.taskMode = 'idle';
              response.writeHead(204);
              return response.end();
            }
            return write ? ok() : send(200, []);
          case 'cookie':
            if (request.method === 'PUT')
              data.cookie = {
                cookie_enabled: true,
                status: true,
                validated: 1768212000,
                validated_str: '2026-01-12 10:00',
              };
            if (request.method === 'DELETE') data.cookie = { cookie_enabled: false, status: false };
            return send(200, data.cookie);
          case 'token':
            if (write) data.token = 'LOCAL_FIXTURE_TOKEN_REVOKED';
            return send(200, { token: data.token });
          case 'snapshot':
            return write ? ok() : send(200, data.snapshots);
          case 'backup':
            return write ? ok() : send(200, empty ? [] : data.backups);
          case 'membership':
            if (match[1] === 'token') {
              if (request.method === 'POST')
                data.membershipToken = 'LOCAL_FIXTURE_MEMBERSHIP_SAVED';
              if (request.method === 'DELETE') data.membershipToken = '';
              return send(200, { token: data.membershipToken });
            }
            if (match[1] === 'profile' && !write)
              return send(200, {
                id: 1,
                user: { id: 1, username: 'local-member' },
                sponsor_tier: {
                  tier_id: 1,
                  name: 'Local fixture',
                  description: 'Not real membership',
                  max_subs: 10,
                },
                subscription_count: 1,
                subscription_is_max: false,
                is_connected: false,
              });
            if (match[1] === 'sync' && request.method === 'POST') return ok();
            return send(501, { error: 'Unhandled local API method' });
          case 'snapshot-item':
          case 'backup-item':
          case 'maintenance':
            return ok();
          default:
            return send(501, { error: 'Unhandled local API fixture' });
        }
      }
      if (!['GET', 'HEAD'].includes(request.method))
        return send(405, { error: 'Static GET/HEAD only' });
      const root = await realpath(dist);
      let relative = decoded.replace(/^\//, '');
      if (decoded === '/new' || decoded.startsWith('/new/')) relative = 'new/index.html';
      else if (!extname(relative) && !decoded.startsWith('/assets/')) relative = 'index.html';
      const candidate = await realpath(resolve(root, relative));
      if (!candidate.startsWith(root + sep)) return send(403, { error: 'Unsafe asset path' });
      if (!(await stat(candidate)).isFile()) return send(404, { error: 'Asset missing' });
      response.writeHead(200, {
        'Content-Type': mime[extname(candidate)] || 'application/octet-stream',
      });
      let content = request.method === 'HEAD' ? undefined : await readFile(candidate);
      if (content && extname(candidate) === '.html')
        content = Buffer.from(
          content
            .toString()
            .replace(
              '</body>',
              '<aside aria-label="Local fixture mode" style="position:fixed;bottom:0;right:0;z-index:2147483647;background:#fff;color:#111;border:2px solid #111;padding:4px;font:12px sans-serif;pointer-events:none">LOCAL FIXTURES ONLY · NO PRODUCTION DATA</aside></body>',
            ),
        );
      response.end(content);
    } catch (error) {
      if (!response.headersSent)
        send(error.code === 'ENOENT' ? 404 : 400, {
          error:
            error.code === 'ENOENT'
              ? 'Build frontend dist first; asset missing'
              : 'Invalid local fixture request',
        });
      else response.end();
    }
  });
  return {
    server,
    listen: (port = 4174) =>
      new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolveListen(server.address());
        });
      }),
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close(error => (error ? reject(error) : resolveClose()));
        server.closeIdleConnections();
      }),
  };
}

if (
  !process.env.NODE_TEST_CONTEXT &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PREVIEW_PORT || 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid PREVIEW_PORT');
  const preview = createPreviewServer({
    dist: process.env.PREVIEW_DIST || defaultDist,
    fixtureMedia: process.env.PREVIEW_MEDIA,
  });
  await preview.listen(port);
  console.log(
    `LOCAL FIXTURES ONLY: http://127.0.0.1:${port}/new/ PID ${process.pid}; dist ${process.env.PREVIEW_DIST || defaultDist}`,
  );
}
