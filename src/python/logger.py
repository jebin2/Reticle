"""Shared JSON-line output helper for all Nab Python scripts."""

import json


def emit(obj: dict) -> None:
    """Write obj as a JSON line to stdout, flushing immediately."""
    print(json.dumps(obj), flush=True)
