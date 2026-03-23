"""
YOLOStudio model export script — YOLO26 via Ultralytics.

Reads JSON from stdin:
  { "modelPath": "/abs/path/best.pt", "format": "onnx" }

Writes a single JSON line to stdout:
  { "exportedPath": "/abs/path/best.onnx", "error": null }
  { "exportedPath": "",                     "error": "message" }

Supported formats: onnx, tflite, coreml, openvino
(PyTorch / .pt is handled directly in the Bun backend — no export needed.)
"""

import json
import sys
from yolo_utils import suppress_fd1


def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"exportedPath": "", "error": f"Invalid config JSON: {e}"}), flush=True)
        sys.exit(1)

    model_path = config["modelPath"]
    fmt        = config["format"]

    try:
        with suppress_fd1():
            from ultralytics import YOLO
            model = YOLO(model_path)
    except Exception as e:
        print(json.dumps({"exportedPath": "", "error": f"Failed to load model: {e}"}), flush=True)
        sys.exit(1)

    try:
        with suppress_fd1():
            exported_path = model.export(format=fmt)
    except Exception as e:
        print(json.dumps({"exportedPath": "", "error": f"Export failed: {e}"}), flush=True)
        sys.exit(1)

    print(json.dumps({"exportedPath": str(exported_path), "error": None}), flush=True)


if __name__ == "__main__":
    main()
