import { useState } from 'react';
import useIsAdmin from '../../functions/useIsAdmin';
import { ColourConstant, FileSizeUnits } from '../../api/actions/updateUserConfig';
import type { ColourVariants, UserConfigType } from '../../api/actions/updateUserConfig';
import { useUserConfigStore } from '../../stores/UserConfigStore';
import { SettingsUserSection } from '../components/SettingsUserSections';
import { pageSizePayload, saveUserSettings } from '../lib/settingsUser';
import { settingsError } from '../lib/settings';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NativeSelect } from '../ui/native-select';
import { Checkbox } from '../ui/checkbox';

export default function SettingsUser() {
  const { userConfig, setUserConfig } = useUserConfigStore();
  const admin = useIsAdmin();
  const [pageSize, setPageSize] = useState({
    source: userConfig.page_size,
    value: String(userConfig.page_size),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  async function save(values: Partial<UserConfigType>): Promise<boolean> {
    setPending(true);
    setError('');
    setSaved('');
    try {
      const config = await saveUserSettings(values);
      setUserConfig(config);
      setSaved('Preferences saved.');
      return true;
    } catch (caught) {
      setError(settingsError(caught));
      return false;
    } finally {
      setPending(false);
    }
  }
  const currentPageSize =
    pageSize.source === userConfig.page_size ? pageSize.value : String(userConfig.page_size);
  let parsedPageSize = Number.NaN;
  try {
    parsedPageSize = pageSizePayload(currentPageSize).page_size;
  } catch {
    /* Invalid draft stays local. */
  }
  const validPageSize =
    Number.isSafeInteger(parsedPageSize) &&
    parsedPageSize >= 1 &&
    parsedPageSize <= Number.MAX_SAFE_INTEGER;
  const dirty = currentPageSize !== String(userConfig.page_size);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Personal interface preferences. Save each choice to apply it to your account.
      </p>
      <SettingsUserSection title="Interface">
        <label className="grid gap-1 text-sm" htmlFor="stylesheet">
          Classic UI color scheme
          <NativeSelect
            id="stylesheet"
            value={userConfig.stylesheet}
            disabled={pending}
            onChange={event => {
              const value = event.target.value as ColourVariants;
              void save({ stylesheet: value }).then(success => {
                if (success) {
                  try {
                    localStorage.setItem('stylesheet', value);
                  } catch {
                    setError('Preference saved, but local theme storage is unavailable.');
                  }
                }
              });
            }}
          >
            {Object.entries(ColourConstant).map(([label, value]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <span className="text-xs text-muted-foreground">
            Applies to classic UI only. Header Theme control changes new UI appearance.
          </span>
        </label>
        <label className="grid gap-1 text-sm" htmlFor="page-size">
          Archive view page size
          <Input
            id="page-size"
            type="number"
            min="1"
            max={Number.MAX_SAFE_INTEGER}
            step="1"
            value={currentPageSize}
            disabled={pending}
            onChange={event =>
              setPageSize({ source: userConfig.page_size, value: event.target.value })
            }
          />
        </label>
        {dirty && !validPageSize && (
          <p role="alert" className="text-sm text-foreground">
            Enter a positive whole number no greater than {Number.MAX_SAFE_INTEGER}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || pending || !validPageSize}
            onClick={() => {
              try {
                void save(pageSizePayload(currentPageSize));
              } catch (caught) {
                setError(settingsError(caught));
              }
            }}
          >
            {pending ? 'Saving…' : 'Save page size'}
          </Button>
          {dirty && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                setPageSize({ source: userConfig.page_size, value: String(userConfig.page_size) })
              }
            >
              Cancel
            </Button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={userConfig.show_help_text}
            disabled={pending}
            onCheckedChange={checked => void save({ show_help_text: checked === true })}
          />
          Show help text
        </label>
        <label className="grid gap-1 text-sm" htmlFor="file-size-unit">
          File size units
          <NativeSelect
            id="file-size-unit"
            value={userConfig.file_size_unit}
            disabled={pending}
            onChange={event =>
              void save({ file_size_unit: event.target.value as 'binary' | 'metric' })
            }
          >
            <option value={FileSizeUnits.Metric}>SI units</option>
            <option value={FileSizeUnits.Binary}>Binary units</option>
          </NativeSelect>
        </label>
      </SettingsUserSection>
      {error && (
        <p role="alert" className="text-sm text-foreground">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          {saved}
        </p>
      )}
      {admin && (
        <SettingsUserSection title="User management">
          <p className="text-sm text-muted-foreground">
            Manage users, permissions, and passwords in the administrator interface.
          </p>
          <Button variant="outline" asChild>
            <a href="/admin/">Admin interface</a>
          </Button>
        </SettingsUserSection>
      )}
    </>
  );
}
