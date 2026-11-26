"""The screening chunk size must be larger than the 300-character overlap between chunks.

A size of 300 or less would make the screening loop skip every chunk and allow all text
unscreened, so the setting is rejected when settings load.
"""
import pytest
from pydantic import ValidationError

from settings import AISettings


@pytest.mark.parametrize("size", ["200", "299", "300"])
def test_chunk_size_not_larger_than_the_overlap_is_rejected(monkeypatch, size):
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", size)

    with pytest.raises(ValidationError):
        AISettings()


@pytest.mark.parametrize("size", ["301", "2000", "6000"])
def test_chunk_size_larger_than_the_overlap_is_accepted(monkeypatch, size):
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", size)

    assert AISettings().user_text_screen_chunk_size == int(size)
