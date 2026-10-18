import { useEffect, useState } from 'react';
import NewRoutes from '../routes';
import { Link, useSearchParams } from 'react-router-dom';
import loadSearch, { SearchResultsType } from '../../api/loader/loadSearch';
import VideoCollection from '../components/VideoCollection';
import SearchHighlight from '../components/SearchHighlight';
import EmbeddableVideoPlayer from '../components/EmbeddableVideoPlayer';
import PlaylistList from '../components/PlaylistList';
import { ChannelsList } from '../components/ChannelsList';
import { errorMessage, assertResponse } from '../videoMetadata';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

type SubtitleResult = {
  subtitle_fragment_id: string;
  youtube_id: string;
  title: string;
  subtitle_start: string;
  subtitle_end: string;
  subtitle_line: string;
  subtitle_channel: string;
  subtitle_channel_id: string;
  _score: number;
};
const examples = [
  'music video',
  'video: active:no',
  'video:learn javascript channel:corey schafer active:yes',
  'channel:linux subscribed:yes',
  'playlist:backend engineering active:yes subscribed:yes',
  'full:javascript lang:en source:user',
];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get('query') ?? '';
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: SearchResultsType; error?: string }>();
  const key = JSON.stringify([query, revision, params.get('videoId')]);
  const current = result?.key === key ? result : undefined;
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timeout = setTimeout(() => {
      void loadSearch(encodeURIComponent(query))
        .then(response => {
          assertResponse(response);
          if (
            !response.data?.results ||
            !['video_results', 'channel_results', 'playlist_results', 'fulltext_results'].every(
              field =>
                Array.isArray(response.data?.results[field as keyof SearchResultsType['results']]),
            )
          )
            throw new Error('Invalid search response');
          if (active) setResult({ key, data: response.data });
        })
        .catch(caught => {
          if (active) setResult({ key, error: errorMessage(caught, 'Search failed') });
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, key]);
  const data = current?.data;
  const refresh = () => setRevision(value => value + 1);
  const changeQuery = (value: string) =>
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        if (value) next.set('query', value);
        else next.delete('query');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Search your archive</h1>
      <EmbeddableVideoPlayer videoId={params.get('videoId')} />
      <form
        onSubmit={event => {
          event.preventDefault();
          refresh();
        }}
        className="flex gap-2"
      >
        <Input
          aria-label="Search archive"
          type="search"
          autoComplete="off"
          value={query}
          onChange={event => changeQuery(event.target.value)}
          placeholder="Search titles, channels, playlists or subtitles"
        />
        <Button variant="outline" type="submit">
          Search
        </Button>
      </form>
      <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Search filters and examples</summary>
        <p className="my-2">
          Use video:, channel:, playlist: or full: to choose result type. Filter with active:yes/no,
          subscribed:yes/no, channel:name, lang:en or source:auto/user.
        </p>
        <div className="flex flex-wrap gap-2">
          {examples.map(example => (
            <Button
              key={example}
              variant="secondary"
              size="sm"
              onClick={() => changeQuery(example)}
            >
              {example}
            </Button>
          ))}
        </div>
        <a
          className="mt-2 block underline"
          href="https://docs.tubearchivist.com/search/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Search documentation
        </a>
      </details>
      {query.trim() && !current && <p role="status">Searching…</p>}
      {current?.error && (
        <p role="alert" className="text-foreground">
          {current.error}
        </p>
      )}
      {data && (
        <>
          {['simple', 'video'].includes(data.queryType) && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Video results</h2>
              <VideoCollection videos={data.results.video_results} refresh={refresh} />
            </section>
          )}
          {['simple', 'channel'].includes(data.queryType) && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Channel results</h2>
              {!data.results.channel_results.length && <p>No channels found.</p>}
              <ChannelsList channels={data.results.channel_results} refresh={refresh} />
            </section>
          )}
          {['simple', 'playlist'].includes(data.queryType) && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Playlist results</h2>
              {!data.results.playlist_results.length && <p>No playlists found.</p>}
              <PlaylistList playlists={data.results.playlist_results} refresh={refresh} />
            </section>
          )}
          {['simple', 'full'].includes(data.queryType) && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Fulltext results</h2>
              {!data.results.fulltext_results.length && <p>No fulltext results found.</p>}
              {(data.results.fulltext_results as SubtitleResult[]).map(subtitle => (
                <Card key={subtitle.subtitle_fragment_id} className="gap-2 p-3">
                  <Link
                    className="font-semibold hover:underline"
                    to={NewRoutes.VideoAtTimestamp(subtitle.youtube_id, subtitle.subtitle_start)}
                  >
                    {subtitle.title}
                  </Link>
                  <Link className="text-sm" to={NewRoutes.Channel(subtitle.subtitle_channel_id)}>
                    {subtitle.subtitle_channel}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {subtitle.subtitle_start.split('.')[0]}–{subtitle.subtitle_end.split('.')[0]} ·
                    Score: {subtitle._score.toLocaleString()}
                  </p>
                  <SearchHighlight value={subtitle.subtitle_line} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setParams(previous => {
                        const next = new URLSearchParams(previous);
                        next.set('videoId', subtitle.youtube_id);
                        next.set('t', subtitle.subtitle_start);
                        return next;
                      })
                    }
                  >
                    Play excerpt
                  </Button>
                </Card>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
