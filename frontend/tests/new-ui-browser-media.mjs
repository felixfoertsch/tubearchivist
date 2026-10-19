import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewServer } from './new-ui-browser-server.mjs';

// Optional local CC0 bytes, never fetched during tests or bundled in application.
test(
  'approved local MP4 serves same-origin HEAD and bounded ranges',
  { skip: !process.env.PREVIEW_MEDIA },
  async () => {
    assert.throws(() => createPreviewServer({ fixtureMedia: '/etc/hosts' }), /approved local/);
    const preview = createPreviewServer({ fixtureMedia: process.env.PREVIEW_MEDIA });
    const { port } = await preview.listen(0);
    const base = `http://127.0.0.1:${port}`;
    try {
      const head = await fetch(base + '/media/fixture.mp4', { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-type'), 'video/mp4');
      assert.equal(head.headers.get('content-length'), '1128375');
      assert.equal(await head.text(), '');
      const range = await fetch(base + '/media/fixture.mp4', { headers: { Range: 'bytes=0-31' } });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-range'), 'bytes 0-31/1128375');
      assert.equal(Buffer.from(await range.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
      for (const value of ['bytes=9999999-', 'bytes=10-2', 'bytes=0-1,4-5'])
        assert.equal(
          (await fetch(base + '/media/fixture.mp4', { headers: { Range: value } })).status,
          416,
        );
      const video = await (await fetch(base + '/api/video/local-video/')).json();
      assert.equal(video.media_url, '/media/fixture.mp4');
      const frame = await fetch(base + '/__preview__/frame?width=320');
      assert.equal(frame.status, 200);
      assert.match(frame.headers.get('content-security-policy'), /frame-src 'self'/);
      assert.match(await frame.text(), /src="\/"/);
    } finally {
      await preview.close();
    }
  },
);
