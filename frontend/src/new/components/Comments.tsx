import { Fragment, useState } from 'react';
import type { CommentsResponseType } from '../../api/loader/loadCommentsbyVideoId';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { isoDate } from '../videoMetadata';

export function PlayerText({
  children,
  onSeek,
}: {
  children: string;
  onSeek?: (seconds: number) => void;
}) {
  const parts = children.split(/(https?:\/\/[^\s]+|(?:\d+:)?\d{1,2}:\d{2})/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          const url = part.match(/^(.*?)([.,!?;:]*)$/);
          const href = url?.[1] ?? part;
          return (
            <Fragment key={index}>
              <a
                className="text-foreground underline"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {href}
              </a>
              {url?.[2]}
            </Fragment>
          );
        }
        if (/^(?:\d+:)?\d{1,2}:\d{2}$/.test(part) && onSeek) {
          const time = part.split(':').map(Number);
          const seconds =
            time.length === 3 ? time[0] * 3600 + time[1] * 60 + time[2] : time[0] * 60 + time[1];
          return (
            <button
              key={index}
              type="button"
              className="text-foreground underline"
              onClick={() => onSeek(seconds)}
            >
              {part}
            </button>
          );
        }
        return part;
      })}
    </span>
  );
}

function Comment({
  comment,
  onSeek,
}: {
  comment: CommentsResponseType[number];
  onSeek: (seconds: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const replies = comment.comment_replies ?? [];
  return (
    <Card className="gap-3 py-4">
      <CardContent className="space-y-2">
        <p
          className={
            comment.comment_author_is_uploader ? 'font-semibold text-foreground' : 'font-semibold'
          }
        >
          {comment.comment_author}
          {comment.comment_author_is_uploader ? ' · Uploader' : ''}
        </p>
        <p>
          <PlayerText onSeek={onSeek}>{comment.comment_text}</PlayerText>
        </p>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <time dateTime={isoDate(comment.comment_timestamp)}>
            {isoDate(comment.comment_timestamp)}
          </time>
          {comment.comment_likecount > 0 && (
            <span>
              ♥{' '}
              {new Intl.NumberFormat(undefined, { notation: 'compact' }).format(
                comment.comment_likecount,
              )}
            </span>
          )}
          {comment.comment_is_favorited && <span>Favorited</span>}
        </div>
        {replies.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide' : 'Show'} {replies.length.toLocaleString()} replies
          </Button>
        )}
        {expanded && (
          <div className="space-y-3 border-l pl-4">
            {replies.map(reply => (
              <Comment key={reply.comment_id} comment={reply} onSeek={onSeek} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Comments({
  comments,
  onSeek,
}: {
  comments: CommentsResponseType;
  onSeek: (seconds: number) => void;
}) {
  if (!comments.length) return null;
  return (
    <section className="space-y-3">
      {comments.map(comment => (
        <Comment key={comment.comment_id} comment={comment} onSeek={onSeek} />
      ))}
    </section>
  );
}
