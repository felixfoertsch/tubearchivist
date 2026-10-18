"""Snapshot restore must validate its source before deleting live indices."""

import pytest
from appsettings.src.snapshot import ElasticSnapshot


def metadata(
    state="SUCCESS", name="backup", indices=("ta_video_v2", "ta_config")
):
    return {
        "snapshots": [
            {"snapshot": name, "state": state, "indices": list(indices)}
        ]
    }


@pytest.fixture
def restore(monkeypatch):
    calls = []
    replies = {"_snapshot/ta_snapshot/backup": (metadata(), 200)}

    class ES:
        def __init__(self, path):
            self.path = path

        def get(self):
            calls.append(("GET", self.path))
            return replies.get(self.path, ({self.path: {}}, 200))

        def delete(self):
            calls.append(("DELETE", self.path))
            return replies.get(
                "DELETE " + self.path, ({"acknowledged": True}, 200)
            )

        def post(self, data):
            calls.append(("POST", self.path, data))
            return {"accepted": True}, 200

    monkeypatch.setattr("appsettings.src.snapshot.ElasticWrap", ES)
    snapshot = ElasticSnapshot.__new__(ElasticSnapshot)
    snapshot.all_indices = ["ta_video", "ta_config"]
    return snapshot, replies, calls


@pytest.mark.parametrize(
    "response,status",
    [
        ({}, 404),
        ({"snapshots": []}, 200),
        (None, 200),
        ({"snapshots": None}, 200),
        ({"snapshots": {}}, 200),
        ({"snapshots": [None]}, 200),
        ({"snapshots": [{}, {}]}, 200),
        (metadata(state="FAILED"), 200),
        (metadata(state="IN_PROGRESS"), 200),
        (metadata(state="PARTIAL"), 200),
        (metadata(name="other"), 200),
        ({"snapshots": [{"snapshot": "backup", "state": "SUCCESS"}]}, 200),
        (
            {
                "snapshots": [
                    {"snapshot": "backup", "state": "SUCCESS", "indices": None}
                ]
            },
            200,
        ),
        (metadata(indices=()), 200),
        (metadata(indices=("ta_video",)), 200),
        (metadata(indices=("ta_video_old", "ta_config")), 200),
        (metadata(indices=(None,)), 200),
        (metadata(), 503),
    ],
)
def test_invalid_snapshot_does_not_mutate(restore, response, status):
    snapshot, replies, calls = restore
    replies["_snapshot/ta_snapshot/backup"] = response, status
    assert snapshot.restore_all("backup") is False
    assert calls == [("GET", "_snapshot/ta_snapshot/backup")]


def test_success_preflights_before_existing_restore_sequence(restore):
    snapshot, _, calls = restore
    assert snapshot.restore_all("backup") == {"accepted": True}
    assert calls == [
        ("GET", "_snapshot/ta_snapshot/backup"),
        ("GET", "ta_video"),
        ("GET", "ta_config"),
        ("DELETE", "ta_video"),
        ("DELETE", "ta_config"),
        (
            "POST",
            "_snapshot/ta_snapshot/backup/_restore",
            {"indices": "*,-.*"},
        ),
    ]


@pytest.mark.parametrize(
    "response,status",
    [({}, 503), ({}, 200), (None, 200), ({"unrelated": {}}, 200)],
)
def test_failed_live_lookup_does_not_mutate(restore, response, status):
    snapshot, replies, calls = restore
    replies["ta_config"] = response, status
    assert snapshot.restore_all("backup") is False
    assert not any(c[0] in {"DELETE", "POST"} for c in calls)


@pytest.mark.parametrize(
    "response,status", [({}, 503), ({}, 200), ({"acknowledged": False}, 200)]
)
def test_failed_delete_stops_restore(restore, response, status):
    snapshot, replies, calls = restore
    replies["DELETE ta_video"] = response, status
    assert snapshot.restore_all("backup") is False
    assert not any(c[0] == "POST" for c in calls)
    assert ("DELETE", "ta_config") not in calls


def test_versioned_live_index_and_missing_index(restore):
    snapshot, replies, calls = restore
    replies["ta_video"] = {"ta_video_v2": {}}, 200
    replies["ta_config"] = {}, 404
    assert snapshot.restore_all("backup") == {"accepted": True}
    assert ("DELETE", "ta_video_v2") in calls
    assert ("DELETE", "ta_config") not in calls
