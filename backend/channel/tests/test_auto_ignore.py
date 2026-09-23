"""validation and persistence of channel title filters"""

import pytest
from channel.serializers import ChannelOverwriteSerializer
from channel.src.index import YoutubeChannel
from rest_framework.serializers import ValidationError


@pytest.mark.parametrize(
    "pattern",
    [None, "", "PODCAST: The Joy of Why", "(?i)podcast", " podcast "],
)
def test_valid_filters_are_preserved(pattern):
    serializer = ChannelOverwriteSerializer()
    assert serializer.validate_auto_ignore_filter(pattern) == pattern
    field = serializer.fields["auto_ignore_filter"]
    assert field.run_validation(pattern) == pattern


@pytest.mark.parametrize("pattern", ["[", "(", "*", "(?invalid)"])
def test_invalid_filters_are_rejected(pattern):
    with pytest.raises(ValidationError, match="Invalid regular expression"):
        ChannelOverwriteSerializer().validate_auto_ignore_filter(pattern)


def test_setting_and_reset_preserve_other_overwrites():
    channel = object.__new__(YoutubeChannel)
    channel.json_data = {"channel_overwrites": {"download_format": "best"}}
    channel.set_overwrites({"auto_ignore_filter": "podcast"})
    assert channel.get_overwrites() == {
        "download_format": "best",
        "auto_ignore_filter": "podcast",
    }
    channel.set_overwrites({"auto_ignore_filter": None})
    assert channel.get_overwrites() == {"download_format": "best"}
