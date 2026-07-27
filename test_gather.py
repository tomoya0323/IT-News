import pytest
from gather import parse_json_safely, extract_text_from_gemini_response

def test_parse_json_safely_pure_json():
    text = '[{"id": 1, "title": "Test"}]'
    res = parse_json_safely(text)
    assert isinstance(res, list)
    assert res[0]["title"] == "Test"

def test_parse_json_safely_with_markdown():
    text = "```json\n[{\"id\": 1}]\n```"
    res = parse_json_safely(text)
    assert res == [{"id": 1}]

def test_parse_json_safely_with_prefix_suffix():
    text = "以下が要求されたJSONです：\n```json\n[{\"id\": 2}]\n```\nよろしくお願いします。"
    res = parse_json_safely(text)
    assert res == [{"id": 2}]

def test_parse_json_safely_object():
    text = "```json\n{\"error\": \"failed\"}\n```"
    res = parse_json_safely(text)
    assert res == {"error": "failed"}

def test_parse_json_safely_invalid_json():
    text = "これはJSONではありません"
    res = parse_json_safely(text)
    assert res is None

def test_extract_text_from_gemini_response_valid():
    data = {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {
                    "parts": [{"text": "Hello world"}]
                }
            }
        ]
    }
    assert extract_text_from_gemini_response(data) == "Hello world"

def test_extract_text_from_gemini_response_invalid_finish_reason():
    data = {
        "candidates": [
            {
                "finishReason": "SAFETY",
                "content": {
                    "parts": [{"text": "Blocked"}]
                }
            }
        ]
    }
    assert extract_text_from_gemini_response(data) is None

def test_extract_text_from_gemini_response_malformed():
    data = {"unexpected": "format"}
    assert extract_text_from_gemini_response(data) is None
