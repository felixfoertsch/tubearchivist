import { useEffect, useState } from 'react';
import iconSort from '/img/icon-sort.svg';
import iconAdd from '/img/icon-add.svg';
import iconSubstract from '/img/icon-substract.svg';
import iconGridView from '/img/icon-gridview.svg';
import iconListView from '/img/icon-listview.svg';
import iconTableView from '/img/icon-tableview.svg';
import iconFilter from '/img/icon-filter.svg';
import iconMultiSelect from '/img/icon-multi-select.svg';
import { useUserConfigStore } from '../stores/UserConfigStore';
import { ViewStyleNamesType, ViewStylesEnum } from '../configuration/constants/ViewStyle';
import updateUserConfig, { UserConfigType } from '../api/actions/updateUserConfig';
import {
  SortByEnum,
  SortByType,
  SortOrderEnum,
  SortOrderType,
  VideoTypes,
} from '../api/loader/loadVideoListByPage';
import { useFilterBarTempConf } from '../stores/FilterbarTempConf';
import { useVideoSelectionStore } from '../stores/VideoSelectionStore';
import Button from './Button';
import updateDownloadQueue from '../api/actions/updateDownloadQueue';
import { HideWatchedType } from '../configuration/constants/HideWatched';
import queueReindex from '../api/actions/queueReindex';
import { useOutletContext } from 'react-router-dom';
import { ChannelBaseOutletContextType } from '../pages/ChannelAbout';

type FilterbarProps = {
  viewStyle: ViewStyleNamesType;
  hideWatched: HideWatchedType;
  showSort?: boolean;
  showTypeFilter?: boolean;
};

const Filterbar = ({
  viewStyle,
  hideWatched,
  showSort = true,
  showTypeFilter = false,
}: FilterbarProps) => {
  const { userConfig, setUserConfig } = useUserConfigStore();
  const {
    selectedVideoIds,
    clearSelected,
    showSelection,
    setShowSelection,
    selectedAction,
    setSelectedAction,
  } = useVideoSelectionStore();

  const [showHidden, setShowHidden] = useState(false);
  const { filterHeight, setFilterHeight, showFilterItems, setShowFilterItems } =
    useFilterBarTempConf();
  const { setStartNotification } = useOutletContext() as ChannelBaseOutletContextType;

  const currentViewStyle = userConfig[viewStyle];
  const currentHideWatched = userConfig[hideWatched];
  const isGridView = currentViewStyle === ViewStylesEnum.Grid;

  useEffect(() => {
    if (!showSort) {
      return;
    }

    if (currentViewStyle === ViewStylesEnum.Table) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowHidden(true);
    } else {
      setShowHidden(false);
    }
  }, [currentViewStyle, showSort]);

  const handleUserConfigUpdate = async (config: Partial<UserConfigType>) => {
    const updatedUserConfig = await updateUserConfig(config);
    const { data: updatedUserConfigData } = updatedUserConfig;

    if (updatedUserConfigData) {
      setUserConfig(updatedUserConfigData);
    }
  };

  const redownloadSelected = async (ids: string[]) => {
    updateDownloadQueue({
      youtubeIdStrings: ids.join(' '),
      autostart: true,
      force: true,
    });
  };

  const reindexSelected = async (ids: string[]) => {
    queueReindex(ids, 'video');
    if (setStartNotification !== undefined) setStartNotification(true);
  };

  const actionList = [
    {
      label: 'Redownload',
      handler: redownloadSelected,
    },
    {
      label: 'Reindex',
      handler: reindexSelected,
    },
  ];

  const handleActionSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === '') {
      setSelectedAction(null);
    } else {
      setSelectedAction(actionList[Number(value)].handler);
    }
  };

  const handleSelectedActionRun = async () => {
    if (selectedAction) {
      selectedAction(selectedVideoIds);
      setSelectedAction(null);
      clearSelected();
      setShowSelection(false);
    }
  };

  return (
    <>
      <div className="view-controls">
        <div className="view-icons">
          <button
            type="button"
            className="classic-icon-button"
            aria-label="Select videos"
            aria-pressed={showSelection}
            onClick={() => setShowSelection(!showSelection)}
          >
            <img
              alt=""
              src={iconMultiSelect}
              title={showSelection ? 'Hide multi select boxes' : 'Show multi select boxes'}
            />
          </button>
          {showFilterItems && (
            <div>
              <span>Filter:</span>
              <select
                value={currentHideWatched === null ? '' : currentHideWatched.toString()}
                onChange={event => {
                  handleUserConfigUpdate({
                    [hideWatched]: event.target.value === '' ? null : event.target.value === 'true',
                  });
                }}
              >
                <option value="">All watched state</option>
                <option value="true">Watched only</option>
                <option value="false">Unwatched only</option>
              </select>
              {showTypeFilter && (
                <select
                  value={userConfig.vid_type_filter === null ? '' : userConfig.vid_type_filter}
                  onChange={event => {
                    handleUserConfigUpdate({
                      vid_type_filter:
                        event.target.value === '' ? null : (event.target.value as VideoTypes),
                    });
                  }}
                >
                  <option value="">All Types</option>
                  <option value="videos">Videos</option>
                  <option value="streams">Streams</option>
                  <option value="shorts">Shorts</option>
                </select>
              )}
              <input
                placeholder="height in px"
                value={filterHeight}
                onChange={e => setFilterHeight(e.target.value)}
              />
            </div>
          )}
          <button
            type="button"
            className="classic-icon-button"
            aria-label="Filters"
            aria-expanded={showFilterItems}
            onClick={() => setShowFilterItems(!showFilterItems)}
          >
            <img src={iconFilter} alt="" />
          </button>
          {showHidden && (
            <div className="sort">
              <span>Sort:</span>
              <select
                name="sort_by"
                id="sort"
                value={userConfig.sort_by}
                onChange={event => {
                  handleUserConfigUpdate({ sort_by: event.target.value as SortByType });
                }}
              >
                {Object.entries(SortByEnum).map(([key, value], idx) => {
                  return (
                    <option key={idx} value={value}>
                      {key}
                    </option>
                  );
                })}
              </select>
              <select
                name="sort_order"
                id="sort-order"
                value={userConfig.sort_order}
                onChange={event => {
                  handleUserConfigUpdate({ sort_order: event.target.value as SortOrderType });
                }}
              >
                {Object.entries(SortOrderEnum).map(([key, value], idx) => {
                  return (
                    <option key={idx} value={value}>
                      {key}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          {showSort && (
            <button
              type="button"
              className="classic-icon-button"
              aria-label="Sort options"
              aria-expanded={showHidden}
              onClick={() => {
                setShowHidden(!showHidden);
              }}
            >
              <img src={iconSort} alt="" id="animate-icon" />
            </button>
          )}
          {userConfig.grid_items !== undefined && isGridView && (
            <div className="grid-count">
              {userConfig.grid_items < 7 && (
                <button
                  type="button"
                  className="classic-icon-button"
                  aria-label="Increase grid columns"
                  onClick={() => {
                    handleUserConfigUpdate({ grid_items: userConfig.grid_items + 1 });
                  }}
                >
                  <img src={iconAdd} alt="" />
                </button>
              )}
              {userConfig.grid_items > 3 && (
                <button
                  type="button"
                  className="classic-icon-button"
                  aria-label="Decrease grid columns"
                  onClick={() => {
                    handleUserConfigUpdate({ grid_items: userConfig.grid_items - 1 });
                  }}
                >
                  <img src={iconSubstract} alt="" />
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="classic-icon-button"
            aria-label="Grid view"
            aria-pressed={isGridView}
            onClick={() => {
              handleUserConfigUpdate({ [viewStyle]: ViewStylesEnum.Grid });
            }}
          >
            <img src={iconGridView} alt="" />
          </button>
          <button
            type="button"
            className="classic-icon-button"
            aria-label="List view"
            aria-pressed={currentViewStyle === ViewStylesEnum.List}
            onClick={() => {
              handleUserConfigUpdate({ [viewStyle]: ViewStylesEnum.List });
            }}
          >
            <img src={iconListView} alt="" />
          </button>
          <button
            type="button"
            className="classic-icon-button"
            aria-label="Table view"
            aria-pressed={currentViewStyle === ViewStylesEnum.Table}
            onClick={() => {
              handleUserConfigUpdate({ [viewStyle]: ViewStylesEnum.Table });
            }}
          >
            <img src={iconTableView} alt="" />
          </button>
        </div>
      </div>
      {showSelection && (
        <div className="info-box-item">
          <p>
            Selected Videos: {selectedVideoIds.length} -{' '}
            <Button onClick={clearSelected}>Clear</Button>
          </p>
          <p>Apply action:</p>
          <select onChange={handleActionSelectChange}>
            <option value="">---</option>
            {actionList.map((actionItem, idx) => (
              <option key={idx} value={idx}>
                {actionItem.label}
              </option>
            ))}
          </select>
          {selectedAction !== null && <Button onClick={handleSelectedActionRun}>Apply</Button>}
        </div>
      )}
    </>
  );
};

export default Filterbar;
