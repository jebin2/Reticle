#!/usr/bin/env python3
"""
Nab Standalone CLI — run YOLO inference from your terminal.

Usage:
  ./run.sh <image_path> [options]
  python cli.py <image_path> [options]

Options:
  --model PATH    Path to model weights (default: model.pt next to this script)
  --conf  FLOAT   Confidence threshold   (default: 0.5)
  --output DIR    Directory to save annotated images (default: ./output)

Example:
  ./run.sh photo.jpg
  ./run.sh photo.jpg --conf 0.7 --output results/
"""

import argparse
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def main():
    parser = argparse.ArgumentParser(
        description="Nab YOLO Inference CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("image",   help="Path to input image")
    parser.add_argument("--model", default=os.path.join(SCRIPT_DIR, "model.pt"),
                        help="Path to model weights (default: model.pt beside this script)")
    parser.add_argument("--conf",  type=float, default=0.5,
                        help="Confidence threshold 0–1 (default: 0.5)")
    parser.add_argument("--output", default="output",
                        help="Output directory for annotated image (default: ./output)")
    args = parser.parse_args()

    if not os.path.isfile(args.image):
        print(f"Error: image not found: {args.image}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(args.model):
        print(f"Error: model not found: {args.model}", file=sys.stderr)
        sys.exit(1)

    from ultralytics import YOLO
    model   = YOLO(args.model)
    results = model.predict(
        source   = args.image,
        conf     = args.conf,
        save     = True,
        project  = os.path.abspath(args.output),
        name     = "detect",
        exist_ok = True,
    )

    detections = []
    for r in results:
        if r.boxes is None:
            continue
        H, W = r.orig_shape[:2]
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "label":      r.names[int(box.cls[0])],
                "confidence": round(float(box.conf[0]), 4),
                "x1": round(x1 / W, 4), "y1": round(y1 / H, 4),
                "x2": round(x2 / W, 4), "y2": round(y2 / H, 4),
            })

    save_dir = str(results[0].save_dir) if results else args.output
    print(f"\n✓  Detected {len(detections)} object(s)  |  conf ≥ {args.conf}")
    print(f"✓  Annotated image → {save_dir}\n")
    print(json.dumps(detections, indent=2))


if __name__ == "__main__":
    main()
