"""
Reticle model export script — YOLO26 via Ultralytics.

Reads JSON from stdin:
  { "modelPath": "/abs/path/best.pt", "format": "onnx" }

Writes a single JSON line to stdout:
  { "exportedPath": "/abs/path/best.onnx", "error": null }
  { "exportedPath": "",                     "error": "message" }

Supported formats: onnx, tflite, coreml, openvino
(PyTorch / .pt is handled directly in the Bun backend — no export needed.)
"""

import json
import logging
import subprocess
import sys
from logger import emit

# Extra packages required per export format (beyond ultralytics).
FORMAT_DEPS: dict[str, list[str]] = {
    "onnx":     ["onnx", "onnxruntime", "onnxslim"],
    "openvino": ["openvino"],
    "coreml":   ["coremltools>=7.2", "numpy>=1.23.0,<2.0"],
    "tflite":   ["onnx2tf", "onnx", "onnxruntime", "onnxslim", "sng4onnx", "flatbuffers"],
}


def ensure_deps(fmt: str):
    deps = FORMAT_DEPS.get(fmt, [])
    if not deps:
        return
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--upgrade", *deps],
        check=True,
    )


def silence_ultralytics():
    """Replace all Ultralytics logger handlers with NullHandler so their
    StreamHandlers never touch a closed or redirected stream."""
    try:
        import ultralytics.utils as _uu
        _uu.LOGGER.handlers = [logging.NullHandler()]
        _uu.LOGGER.propagate = False
    except Exception:
        pass


def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        emit({"exportedPath": "", "error": f"Invalid config JSON: {e}"})
        sys.exit(1)

    model_path = config["modelPath"]
    fmt        = config["format"]

    try:
        ensure_deps(fmt)
    except Exception as e:
        emit({"exportedPath": "", "error": f"Failed to install dependencies: {e}"})
        sys.exit(1)

    try:
        from ultralytics import YOLO
        silence_ultralytics()
        model = YOLO(model_path)
    except Exception as e:
        emit({"exportedPath": "", "error": f"Failed to load model: {e}"})
        sys.exit(1)

    try:
        exported_path = model.export(format=fmt)
    except Exception as e:
        emit({"exportedPath": "", "error": f"Export failed: {e}"})
        sys.exit(1)

    emit({"exportedPath": str(exported_path), "error": None})


if __name__ == "__main__":
    main()
