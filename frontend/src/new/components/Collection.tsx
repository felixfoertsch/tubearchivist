import type { ReactNode } from 'react';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { Card } from '../ui/card';
import { collectionBody, collectionCard, collectionGrid } from './collectionLayout';

export function Collection({ grid, children }: { grid: boolean; children: ReactNode }) {
  const columns = useUserConfigStore(state => state.userConfig.grid_items);
  return grid ? (
    <div
      className={collectionGrid}
      style={{ ['--home-columns' as string]: Math.min(7, Math.max(3, columns)) }}
    >
      {children}
    </div>
  ) : (
    <ul className="divide-y rounded-xl border">{children}</ul>
  );
}

export function CollectionImage({
  src,
  compact = false,
  avatar = false,
}: {
  src: string | undefined;
  compact?: boolean;
  avatar?: boolean;
}) {
  return (
    <span className={compact ? 'flex h-10 w-16 items-center justify-center' : 'block'}>
      <img
        className={
          compact
            ? avatar
              ? 'size-10 rounded-full object-cover'
              : 'h-10 w-16 rounded object-cover'
            : 'aspect-video w-full object-cover'
        }
        src={src}
        alt=""
        loading="lazy"
      />
    </span>
  );
}

export function CollectionItem({
  compact = false,
  media,
  title,
  metadata,
  actions,
  children,
}: {
  compact?: boolean;
  media: ReactNode;
  title: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const identity = (
    <>
      <div className="shrink-0">{media}</div>
      <div className={compact ? 'min-w-0 flex-1 space-y-1' : collectionBody}>
        <div
          className={`${compact ? 'line-clamp-1' : 'line-clamp-2'} break-words text-sm font-semibold [&_a]:hover:underline`}
        >
          {title}
        </div>
        {metadata && (
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {metadata}
          </div>
        )}
        {children}
        {!compact && actions}
      </div>
    </>
  );
  return compact ? (
    <li className="flex min-w-0 flex-wrap items-center gap-3 p-2 sm:flex-nowrap">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">{identity}</div>
      {actions && (
        <div className="w-full sm:w-auto sm:max-w-1/2 [&_button]:min-h-10">{actions}</div>
      )}
    </li>
  ) : (
    <Card className={collectionCard}>{identity}</Card>
  );
}
