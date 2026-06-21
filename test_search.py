import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(__file__))

import realtime_search

# 1. No GEMINI_API_KEY set -> search() returns None, never raises
os.environ.pop("GEMINI_API_KEY", None)
realtime_search._client = None
assert realtime_search.search("weather in seoul today") is None
print("PASS: no key configured -> returns None safely")

# 2. With a key + mocked grounded response -> returns the cleaned text
os.environ["GEMINI_API_KEY"] = "fake-key-for-test"
realtime_search._client = None
fake_response = MagicMock()
fake_response.text = "It's sunny and 24C in Seoul today, with light winds in the evening."

with patch("realtime_search.genai.Client") as mock_client_cls:
    mock_client_cls.return_value.models.generate_content.return_value = fake_response
    result = realtime_search.search("weather in seoul today")

assert result == "It's sunny and 24C in Seoul today, with light winds in the evening."
print("PASS: grounded response passed through ->", result)

# 3. Unsafe marker gets filtered to empty -> search() returns None
os.environ["GEMINI_API_KEY"] = "fake-key-for-test"
realtime_search._client = None
fake_unsafe = MagicMock()
fake_unsafe.text = "this contains nsfw content"
with patch("realtime_search.genai.Client") as mock_client_cls:
    mock_client_cls.return_value.models.generate_content.return_value = fake_unsafe
    result = realtime_search.search("some query")
assert result is None
print("PASS: unsafe content filtered out ->", result)

# 4. Provider exception never propagates
realtime_search._client = None
with patch("realtime_search.genai.Client") as mock_client_cls:
    mock_client_cls.return_value.models.generate_content.side_effect = Exception("network error")
    result = realtime_search.search("some query")
assert result is None
print("PASS: provider exception swallowed ->", result)

os.environ.pop("GEMINI_API_KEY", None)
print("\nALL CHECKS PASSED")
