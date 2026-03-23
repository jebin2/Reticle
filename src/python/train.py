"""
YOLOStudio training script — YOLO26 via Ultralytics.

Called by the Bun process with a JSON config on stdin:
{
  "runId":      "<uuid>",
  "name":       "vehicles-yolo26n-v1",
  "assetPaths": ["/abs/path/to/asset1", ...],
  "classMap":   ["car", "truck", "bus"],
  "baseModel":  "yolo26n",
  "epochs":     100,
  "batchSize":  16,
  "imgsz":      640,
  "device":     "auto",
  "outputPath": "/abs/path/to/output"
}

Progress and results are written to stdout as newline-delimited JSON:
  {"type": "progress", "epoch": 5, "epochs": 100, "loss": 0.432, "mAP": null}
  {"type": "done",     "mAP50": 0.912, "mAP50_95": 0.741, "weightsPath": "..."}
  {"type": "error",    "message": "..."}
"""

import json
import os
import shutil
import sys
import yaml
from pathlib import Path


# ── helpers ────────────────────────────────────────────────────────────────────

def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def build_dataset(asset_paths: list[str], class_map: list[str], output_dir: Path) -> Path:
    """
    Merge multiple asset folders (each with images/ and labels/) into a single
    dataset directory and write a data.yaml for Ultralytics.

    Asset folder layout (written by YOLOStudio):
        <asset>/images/   ← image files
        <asset>/labels/   ← YOLO .txt files (class_id cx cy w h)
        <asset>/classes.txt

    Output layout:
        <output_dir>/dataset/
            images/train/   ← all images merged
            labels/train/   ← all labels merged
            data.yaml
    """
    dataset_dir = output_dir / "dataset"
    img_dir     = dataset_dir / "images" / "train"
    lbl_dir     = dataset_dir / "labels" / "train"
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    for asset_path in asset_paths:
        asset = Path(asset_path)
        src_images = asset / "images"
        src_labels = asset / "labels"

        if not src_images.exists():
            continue

        for img_file in src_images.iterdir():
            if not img_file.is_file():
                continue

            dest_img = img_dir / img_file.name
            # Avoid filename collisions across assets by prefixing with asset name.
            if dest_img.exists():
                dest_img = img_dir / f"{asset.name}__{img_file.name}"
            shutil.copy2(img_file, dest_img)

            # Copy corresponding label file.
            lbl_file = src_labels / (img_file.stem + ".txt")
            if lbl_file.exists():
                dest_lbl = lbl_dir / dest_img.with_suffix(".txt").name
                shutil.copy2(lbl_file, dest_lbl)

    # Write data.yaml.
    data_yaml = dataset_dir / "data.yaml"
    yaml_content = {
        "path":  str(dataset_dir),
        "train": "images/train",
        "val":   "images/train",   # use same split for now; proper split can be added later
        "nc":    len(class_map),
        "names": class_map,
    }
    with open(data_yaml, "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False)

    return data_yaml


# ── training callback ──────────────────────────────────────────────────────────

def make_on_train_epoch_end(total_epochs: int):
    def on_train_epoch_end(trainer):
        metrics = trainer.metrics or {}
        emit({
            "type":   "progress",
            "epoch":  trainer.epoch + 1,
            "epochs": total_epochs,
            "loss":   round(float(trainer.loss), 6) if trainer.loss is not None else None,
            "mAP":    round(float(metrics.get("metrics/mAP50(B)", 0)), 4) if metrics else None,
        })
    return on_train_epoch_end


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        emit({"type": "error", "message": f"Invalid config JSON: {e}"})
        sys.exit(1)

    asset_paths  = config["assetPaths"]
    class_map    = config["classMap"]
    base_model   = config["baseModel"]          # e.g. "yolo26n"
    epochs       = int(config["epochs"])
    batch_size   = int(config["batchSize"])     # -1 = auto
    imgsz        = int(config["imgsz"])
    device       = config["device"]             # "auto" | "cpu" | "cuda:0" | "mps"
    output_path  = Path(config["outputPath"]).expanduser()

    output_path.mkdir(parents=True, exist_ok=True)

    # Build merged dataset.
    try:
        data_yaml = build_dataset(asset_paths, class_map, output_path)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to build dataset: {e}"})
        sys.exit(1)

    # Check for a checkpoint from a previous paused run — resume if found.
    checkpoint = output_path / "weights" / "weights" / "last.pt"
    resuming   = checkpoint.exists()

    try:
        from ultralytics import YOLO
        if resuming:
            emit({"type": "stderr", "text": f"[train] Resuming from checkpoint: {checkpoint}"})
            model = YOLO(str(checkpoint))
        else:
            model = YOLO(f"{base_model}.pt")
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load model: {e}"})
        sys.exit(1)

    # Register epoch callback.
    model.add_callback("on_train_epoch_end", make_on_train_epoch_end(epochs))

    # Train (or resume).
    try:
        results = model.train(
            data      = str(data_yaml),
            epochs    = epochs,
            batch     = batch_size,
            imgsz     = imgsz,
            device    = device if device != "auto" else None,
            project   = str(output_path),
            name      = "weights",
            exist_ok  = True,
            resume    = resuming,
            verbose   = False,
        )
    except Exception as e:
        emit({"type": "error", "message": f"Training failed: {e}"})
        sys.exit(1)

    # Extract final metrics.
    try:
        metrics      = results.results_dict
        mAP50        = round(float(metrics.get("metrics/mAP50(B)",    0)), 4)
        mAP50_95     = round(float(metrics.get("metrics/mAP50-95(B)", 0)), 4)
        weights_path = str(output_path / "weights" / "weights" / "best.pt")
    except Exception:
        mAP50 = mAP50_95 = 0.0
        weights_path = ""

    emit({
        "type":        "done",
        "mAP50":       mAP50,
        "mAP50_95":    mAP50_95,
        "weightsPath": weights_path,
    })


if __name__ == "__main__":
    main()
