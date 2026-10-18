import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import humanFileSize from '../../functions/humanFileSize';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import SettingsFrame from '../components/SettingsFrame';
import NewRoutes from '../routes';
import { requestJson, settingsError } from '../lib/settings';
import {
  validateStats,
  statsProgress,
  type StatRecord,
  type StatValue,
} from '../lib/settingsStats';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

const sources = [
  ['Videos and media', '/api/stats/video/'],
  ['Channels', '/api/stats/channel/'],
  ['Playlists', '/api/stats/playlist/'],
  ['Download queue', '/api/stats/download/'],
  ['Watch progress', '/api/stats/watch/'],
  ['Download history', '/api/stats/downloadhist/'],
  ['Biggest channels by videos', '/api/stats/biggestchannels/?order=doc_count'],
  ['Biggest channels by duration', '/api/stats/biggestchannels/?order=duration'],
  ['Biggest channels by media size', '/api/stats/biggestchannels/?order=media_size'],
] as const;
const labels: Record<string, string> = {
  doc_count: 'Videos',
  media_size: 'Media size',
  duration: 'Duration (seconds)',
  duration_str: 'Duration',
  type_videos: 'Videos',
  type_shorts: 'Shorts',
  type_streams: 'Live streams',
  active_true: 'Active',
  active_false: 'Inactive',
  subscribed_true: 'Subscribed',
  pending: 'Pending',
  ignore: 'Ignored',
  subscribed_false: 'Not subscribed',
  pending_videos: 'Pending videos',
  pending_shorts: 'Pending shorts',
  pending_streams: 'Pending streams',
  total: 'Total',
  watched: 'Watched',
  unwatched: 'Unwatched',
  progress: 'Progress',
  items: 'Items',
  date: 'Date',
  count: 'Downloads',
  name: 'Channel',
  id: 'Channel ID',
};
function Metrics({ data, metric }: { data: StatRecord | StatValue[]; metric: boolean }) {
  const format = (key: string, value: string | number) =>
    key === 'progress' && typeof value === 'number'
      ? statsProgress(value)
      : key === 'media_size' && typeof value === 'number'
        ? humanFileSize(value, metric)
        : typeof value === 'number'
          ? value.toLocaleString()
          : value;
  if (Array.isArray(data)) {
    if (!data.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
    const records = data.filter(
      (row): row is StatRecord => !!row && typeof row === 'object' && !Array.isArray(row),
    );
    const keys = [...new Set(records.flatMap(row => Object.keys(row)))].filter(key => key !== 'id');
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {keys.map(key => (
                <th key={key} className="whitespace-nowrap p-2">
                  {labels[key] || key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={typeof record.id === 'string' ? record.id : index} className="border-t">
                {keys.map(key => (
                  <td key={key} className="p-2">
                    {key === 'name' && typeof record.id === 'string' ? (
                      <Link
                        className="underline underline-offset-4"
                        to={NewRoutes.Channel(record.id)}
                      >
                        {String(record[key])}
                      </Link>
                    ) : typeof record[key] === 'number' || typeof record[key] === 'string' ? (
                      format(key, record[key] as string | number)
                    ) : (
                      '—'
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <dl className="space-y-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="border-t pt-2 first:border-0 first:pt-0">
          {value !== null && typeof value === 'object' ? (
            <>
              <dt className="mb-2 font-medium">{labels[key] || key}</dt>
              <dd className="pl-3">
                <Metrics data={value} metric={metric} />
              </dd>
            </>
          ) : (
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">{labels[key] || key}</dt>
              <dd className="font-medium tabular-nums">
                {value === null ? 'No data' : format(key, value)}
              </dd>
            </div>
          )}
        </div>
      ))}
    </dl>
  );
}
function StatsPanel({
  title,
  endpoint,
  metric,
  revision,
}: {
  title: string;
  endpoint: string;
  metric: boolean;
  revision: number;
}) {
  const [data, setData] = useState<StatRecord | StatValue[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const required = endpoint.includes('/video/')
      ? [
          'doc_count',
          'media_size',
          'duration',
          'type_videos',
          'type_shorts',
          'type_streams',
          'active_true',
          'active_false',
        ]
      : endpoint.includes('/watch/')
        ? ['total', 'watched', 'unwatched']
        : endpoint.includes('/channel/') || endpoint.includes('/playlist/')
          ? ['doc_count', 'active_true', 'subscribed_true']
          : endpoint.includes('/download/')
            ? ['pending', 'pending_videos', 'pending_shorts', 'pending_streams']
            : [];
    requestJson(endpoint, { signal: controller.signal })
      .then(value => validateStats(value, required))
      .then(result => {
        if (!controller.signal.aborted) {
          setData(result);
          setError('');
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(settingsError(error));
      });
    return () => controller.abort();
  }, [endpoint, revision]);
  return (
    <Card className="min-w-0 gap-3 p-4">
      <h2 className="font-semibold">{title}</h2>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      {data ? (
        <Metrics data={data} metric={metric} />
      ) : (
        !error && <p role="status">Loading statistics…</p>
      )}
    </Card>
  );
}
export default function SettingsDashboard() {
  const metric = useUserConfigStore(state => state.userConfig.file_size_unit === 'metric');
  const [revision, setRevision] = useState(0);
  return (
    <SettingsFrame title="Your archive" admin={false}>
      <Button variant="outline" onClick={() => setRevision(value => value + 1)}>
        Refresh statistics
      </Button>
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sources.map(([title, endpoint]) => (
          <StatsPanel
            key={endpoint}
            title={title}
            endpoint={endpoint}
            metric={metric}
            revision={revision}
          />
        ))}
      </div>
    </SettingsFrame>
  );
}
