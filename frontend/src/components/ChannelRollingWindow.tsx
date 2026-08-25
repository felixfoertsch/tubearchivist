import { useState } from 'react';
import updateChannelOverwrites from '../api/actions/updateChannelOverwrite';

type Props = {
  channelId: string;
  initialValue?: number | null;
};

const ChannelRollingWindow = ({ channelId, initialValue }: Props) => {
  const [value, setValue] = useState(initialValue?.toString() ?? '');
  const [savedValue, setSavedValue] = useState(initialValue ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async (input: string) => {
    if (saving) return;
    setSaved(false);
    setError('');
    const trimmed = input.trim();
    const size = trimmed === '' ? null : Number(trimmed);
    if (size !== null && (!/^\d+$/.test(trimmed) || size < 1 || size > 2147483647)) {
      setError('Enter a whole number from 1–2147483647, or leave blank to disable.');
      return;
    }

    setSaving(true);
    try {
      const result = await updateChannelOverwrites(channelId, 'rolling_window_size', size);
      if (result.status !== 200 || result.error) {
        throw new Error('Save failed');
      }
      setValue(size?.toString() ?? '');
      setSavedValue(size);
      setSaved(true);
    } catch {
      setError('Could not save rolling window. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="info-box">
      <div className="info-box-item">
        <h2>Channel Rolling Window</h2>
        <p id="rolling-window-warning">
          <strong className="danger-zone">Warning: permanent deletion.</strong> Keeps only the
          latest N regular videos by upload date, deleting older videos whether watched or
          unwatched. This includes all existing, manually downloaded, and playlist videos from this
          channel. Shorts and stream recordings are not affected.
        </p>
        <p id="rolling-window-help">
          Leave blank or reset to disable. Uses existing title ignore filters, subscription
          scheduling, and download auto-start settings. Replacement downloads must finish
          successfully before cleanup; failures postpone deletion. Saving does not start downloads
          or delete videos immediately. Channel scans may be slow for large channels. Confirmed
          unavailable or members-only videos are skipped; uncertain metadata or incomplete scans
          postpone rolling downloads and cleanup.
        </p>
        <p>Saved limit: {savedValue === null ? 'Disabled' : `${savedValue} regular videos`}</p>
        <form
          className="settings-box-wrapper"
          noValidate
          onSubmit={async event => {
            event.preventDefault();
            await save(value);
          }}
        >
          <div>
            <label htmlFor="rolling_window_size">Regular videos to keep</label>
          </div>
          <div>
            <input
              id="rolling_window_size"
              name="rolling_window_size"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={value}
              disabled={saving}
              aria-describedby={`rolling-window-warning rolling-window-help${error ? ' rolling-window-error' : ''}`}
              aria-invalid={!!error}
              onChange={event => {
                setValue(event.target.value);
                setSaved(false);
                setError('');
              }}
            />
            <div className="button-box">
              <button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" disabled={saving} onClick={() => save('')}>
                Reset (disable)
              </button>
              {saved && <span role="status">Saved</span>}
            </div>
            {error && (
              <p id="rolling-window-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChannelRollingWindow;
