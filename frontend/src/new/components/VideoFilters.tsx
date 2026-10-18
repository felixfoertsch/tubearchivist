import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import updateUserConfig, { UserConfigType } from '../../api/actions/updateUserConfig';
import { SortByEnum, SortOrderEnum } from '../../api/loader/loadVideoListByPage';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { useFilterBarTempConf } from '../../stores/FilterbarTempConf';
import { assertResponse, errorMessage } from '../videoMetadata';
import { NativeSelect } from '../ui/native-select';
import { Input } from '../ui/input';

export default function VideoFilters({
  hideWatched,
  showSort = true,
  showType = false,
}: {
  hideWatched: 'hide_watched_channel' | 'hide_watched_playlist';
  showSort?: boolean;
  showType?: boolean;
}) {
  const { userConfig, setUserConfig } = useUserConfigStore();
  const { filterHeight, setFilterHeight } = useFilterBarTempConf();
  const [, setParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const resetPage = () =>
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('page');
      return next;
    });
  const save = async (config: Partial<UserConfigType>) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      const response = await updateUserConfig(config);
      assertResponse(response);
      if (!response.data) throw new Error('Configuration response missing');
      setUserConfig(response.data);
      resetPage();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save filters'));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <div className="space-y-2">
      <fieldset disabled={pending} className="flex flex-wrap items-end gap-2 text-xs">
        <label>
          Watched
          <NativeSelect
            value={userConfig[hideWatched] == null ? '' : String(userConfig[hideWatched])}
            onChange={e =>
              void save({ [hideWatched]: e.target.value === '' ? null : e.target.value === 'true' })
            }
          >
            <option value="">All</option>
            <option value="true">Watched</option>
            <option value="false">Unwatched</option>
          </NativeSelect>
        </label>
        {showType && (
          <label>
            Type
            <NativeSelect
              value={userConfig.vid_type_filter ?? ''}
              onChange={e =>
                void save({
                  vid_type_filter: (e.target.value || null) as UserConfigType['vid_type_filter'],
                })
              }
            >
              <option value="">All types</option>
              <option value="videos">Videos</option>
              <option value="streams">Streams</option>
              <option value="shorts">Shorts</option>
            </NativeSelect>
          </label>
        )}
        <label>
          Height (px)
          <Input
            className="h-9 w-24"
            type="number"
            min="1"
            step="1"
            value={filterHeight}
            onChange={e => {
              if (/^\d*$/.test(e.target.value)) {
                setFilterHeight(e.target.value);
                resetPage();
              }
            }}
          />
        </label>
        {showSort && (
          <>
            <label>
              Sort
              <NativeSelect
                value={userConfig.sort_by}
                onChange={e => void save({ sort_by: e.target.value as UserConfigType['sort_by'] })}
              >
                {Object.entries(SortByEnum).map(([label, value]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              Order
              <NativeSelect
                value={userConfig.sort_order}
                onChange={e =>
                  void save({ sort_order: e.target.value as UserConfigType['sort_order'] })
                }
              >
                {Object.entries(SortOrderEnum).map(([label, value]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </>
        )}
        <label>
          View
          <NativeSelect
            value={userConfig.view_style_home}
            onChange={e =>
              void save({ view_style_home: e.target.value as UserConfigType['view_style_home'] })
            }
          >
            <option value="grid">Grid</option>
            <option value="list">List</option>
            <option value="table">Table</option>
          </NativeSelect>
        </label>
        {userConfig.view_style_home === 'grid' && (
          <label>
            Columns
            <Input
              className="h-9 w-20"
              type="number"
              min="3"
              max="7"
              value={userConfig.grid_items}
              onChange={e => {
                const count = Number(e.target.value);
                if (Number.isInteger(count) && count >= 3 && count <= 7)
                  void save({ grid_items: count });
              }}
            />
          </label>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
