import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDownloadResponse, assertTaskNotifications } from '../src/new/lib/download.ts';

test('download contract accepts backend empty-queue pagination sentinel', () => {
  assert.deepEqual(
    assertDownloadResponse({
      status: 200,
      data: {
        data: [],
        paginate: {
          current_page: 0,
          last_page: 0,
          max_hits: false,
          next_pages: [],
          page_from: 0,
          page_size: 50,
          params: 'filter=pending',
          prev_pages: null,
          total_hits: 0,
        },
      },
    }).paginate.last_page,
    0,
  );
});

test('notification contract accepts null command emitted by backend', () => {
  const task = {
    api_start: true,
    api_stop: false,
    command: null,
    group: 'download',
    id: 'task-id',
    level: 'info',
    messages: [],
    progress: 0,
    title: 'Task',
  };
  assert.deepEqual(assertTaskNotifications([task]), [task]);
});

test('download contract accepts fields omitted by backend serializer', () => {
  const response = assertDownloadResponse({
    status: 200,
    data: {
      data: [
        {
          youtube_id: 'id',
          title: 'title',
          channel_id: 'c',
          channel_indexed: true,
          channel_name: 'channel',
          duration: '1:00',
          published: null,
          timestamp: null,
          vid_thumb_url: null,
          vid_type: 'videos',
        },
      ],
      paginate: {
        page_size: 12,
        page_from: 0,
        current_page: 0,
        last_page: false,
        next_pages: [],
        prev_pages: null,
        total_hits: 1,
        max_hits: false,
        params: '',
      },
    },
  });
  assert.equal(response.data[0].youtube_id, 'id');
});
