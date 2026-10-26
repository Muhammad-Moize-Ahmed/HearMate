import json
import logging

from app.core.logging import JsonFormatter, RequestIdFilter, request_id_var


def test_json_formatter_includes_request_id_and_extra_fields() -> None:
    record = logging.LogRecord("app.test", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    record.status = 201
    token = request_id_var.set("req-7")
    try:
        RequestIdFilter().filter(record)
        entry = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)

    assert entry["message"] == "hello world"
    assert entry["level"] == "INFO"
    assert entry["request_id"] == "req-7"
    assert entry["status"] == 201
