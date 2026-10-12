import unittest
from unittest.mock import patch

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import channels


class ChannelTests(unittest.TestCase):
    def test_build_tooling_uses_node24_actions(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/downstream.yml").read_text()
        for action in ("actions/setup-node@v6", "actions/setup-python@v6", "actions/upload-artifact@v6", "actions/download-artifact@v7", "docker/build-push-action@v7", "docker/setup-buildx-action@v4", "docker/setup-qemu-action@v4"):
            self.assertIn(action, workflow)
        self.assertIn("node-version: '24.21.0'", workflow)

    def test_aliases_are_channel_isolated(self):
        self.assertEqual(channels.aliases("stable", "0.5.12"), ["latest", "stable"])
        self.assertEqual(channels.aliases("nightly", "nightly"), ["nightly", "edge", "develop"])

    def test_workflow_guards_both_promotions(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/downstream.yml").read_text()
        self.assertIn('refs/heads/main:$EXPECTED_MAIN', workflow)
        self.assertGreaterEqual(workflow.count('git rev-parse FETCH_HEAD^{commit}'), 2)
        self.assertIn('refs/tags/$IDENTITY:', workflow)
        self.assertIn('if [ "$CHANNEL" = nightly ]; then', workflow)
        self.assertEqual(workflow.count('persist-credentials: false'), 2)
        self.assertEqual(workflow.count('ref: ${{ github.sha }}'), 2)
        self.assertIn('needs: build', workflow)
        self.assertIn('outputs: type=oci,dest=', workflow)
        self.assertNotIn('persist-credentials: true', workflow)
        self.assertIn('Independently reconstruct expected source', workflow)
        self.assertIn('--preserve-digests', workflow)
        self.assertIn('actions/download-artifact@v7', workflow)
        build = workflow.split('  publish:', 1)[0]
        self.assertNotIn('contents: write', build)
        self.assertNotIn('packages: write', build)
        self.assertNotIn('docker/login-action', build)
        self.assertIn('platforms: linux/amd64,linux/arm64', workflow)
        self.assertNotIn('tags="latest stable $VERSION', workflow)

    def test_identity_uses_berlin_date_and_collision_suffix(self):
        from datetime import datetime, timezone
        now = datetime(2026, 10, 7, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(channels.identity("stable", "v0.5.12", ["v0.5.12-2026.10.08.2"], now), "v0.5.12-2026.10.08.3")
        self.assertEqual(channels.identity("nightly", "v0.5.12", [], now), "nightly-v0.5.12-2026.10.08.1")

    @patch("channels.urllib.request.urlopen")
    def test_nightly_names_latest_stable_but_builds_develop(self, urlopen):
        with patch("channels.json.load", return_value={"draft": False, "prerelease": False, "tag_name": "v0.5.12"}):
            self.assertEqual(channels.resolve("nightly"), {"ref": "refs/heads/develop", "tag": "v0.5.12", "version": "nightly"})

    @patch("channels.urllib.request.urlopen")
    def test_stable_uses_published_latest_release(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        with patch("channels.json.load", return_value={"draft": False, "prerelease": False, "tag_name": "v0.5.12"}):
            self.assertEqual(channels.resolve("stable"), {"ref": "refs/tags/v0.5.12", "tag": "v0.5.12", "version": "0.5.12"})


if __name__ == "__main__":
    unittest.main()
