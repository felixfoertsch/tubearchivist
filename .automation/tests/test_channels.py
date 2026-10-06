import unittest
from unittest.mock import patch

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import channels


class ChannelTests(unittest.TestCase):
    def test_aliases_are_channel_isolated(self):
        self.assertEqual(channels.aliases("stable", "0.5.12"), ["latest", "stable", "0.5.12"])
        self.assertEqual(channels.aliases("nightly", "nightly"), ["nightly", "edge", "develop"])

    @patch("channels.urllib.request.urlopen")
    def test_stable_uses_published_latest_release(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        with patch("channels.json.load", return_value={"draft": False, "prerelease": False, "tag_name": "v0.5.12"}):
            self.assertEqual(channels.resolve("stable"), {"ref": "refs/tags/v0.5.12", "tag": "v0.5.12", "version": "0.5.12"})


if __name__ == "__main__":
    unittest.main()
