import { useState } from 'react';
import updateChannelOverwrites from '../api/actions/updateChannelOverwrite';

type Props = {
  channelId: string;
  initialValue?: string | null;
};

const ChannelAutoIgnoreFilter = ({ channelId, initialValue }: Props) => {
  const [value, setValue] = useState(initialValue ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const result = await updateChannelOverwrites(channelId, 'auto_ignore_filter', value || null);
      if (result.status !== 200 || result.error) {
        throw new Error('Save failed');
      }
      setSaved(true);
    } catch {
      setError('Could not save filter. Check the Python regular expression and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="info-box">
      <div className="info-box-item">
        <h2>Channel Auto-Ignore Filter</h2>
        <p>Matching titles are ignored before download. Use a Python regular expression.</p>
        <p>Leave blank to disable. Already downloaded videos are not affected.</p>
        <form
          onSubmit={event => {
            event.preventDefault();
            save();
          }}
        >
          <label htmlFor="auto_ignore_filter">Title regex</label>
          <input
            id="auto_ignore_filter"
            name="auto_ignore_filter"
            type="text"
            value={value}
            placeholder="PODCAST: The Joy of Why"
            spellCheck={false}
            disabled={saving}
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
            {saved && <span role="status">Saved</span>}
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      </div>
    </div>
  );
};

export default ChannelAutoIgnoreFilter;
