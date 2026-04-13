"""
Nab training script — YOLO26 via Ultralytics.

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
import subprocess
import sys
import yaml
from pathlib import Path
from logger import emit

# Canonical sub-paths for YOLO weight files.
# Ultralytics writes these when project=output_path and name="weights".
WEIGHTS_SUBDIR  = Path("weights") / "weights"
CHECKPOINT_FILE = WEIGHTS_SUBDIR / "last.pt"
MODEL_FILE      = WEIGHTS_SUBDIR / "best.pt"


def load_model(base_model: str, checkpoint: Path, resuming: bool):
    from ultralytics import YOLO
    if resuming:
        emit({"type": "stderr", "text": f"[train] Resuming from checkpoint: {checkpoint}"})
        return YOLO(str(checkpoint))
    return YOLO(f"{base_model}.pt")


def is_cuda_unavailable_error(err: Exception) -> bool:
    text = str(err).lower()
    return (
        "cuda-capable device(s) is/are busy or unavailable" in text or
        "cudaerrordevicesunavailable" in text or
        ("cuda error" in text and "busy or unavailable" in text)
    )


def train_once(model, data_yaml: Path, epochs: int, batch_size: int, imgsz: int, device, output_path: Path, resuming: bool):
    return model.train(
        data      = str(data_yaml),
        epochs    = epochs,
        batch     = batch_size,
        imgsz     = imgsz,
        device    = device,
        project   = str(output_path),
        name      = "weights",
        exist_ok  = True,
        resume    = resuming,
        verbose   = False,
    )


def retry_on_cpu(config: dict):
    cpu_config = dict(config)
    cpu_config["device"] = "cpu"
    cpu_config["resumeFromCheckpoint"] = False

    env = dict(os.environ)
    env["CUDA_VISIBLE_DEVICES"] = "-1"
    env["RETICLE_CPU_FALLBACK"] = "1"

    proc = subprocess.Popen(
        [sys.executable, __file__],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    proc.stdin.write(json.dumps(cpu_config))
    proc.stdin.close()

    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()

    stderr_output = proc.stderr.read()
    proc.wait()

    if stderr_output:
        for line in stderr_output.splitlines():
            emit({"type": "stderr", "text": f"[train] {line}"})

    if proc.returncode != 0:
        raise RuntimeError((stderr_output or "CPU fallback failed").strip())


def task_for_model(base_model: str) -> str:
    """Return 'segment' for *-seg models, 'detect' for plain detection models."""
    return "segment" if base_model.endswith("-seg") else "detect"


def build_dataset(images: list[dict], class_map: list[str], output_dir: Path, task: str) -> Path:
    """
    Copy a locked set of image/label pairs into a merged dataset directory
    and write a data.yaml for Ultralytics.

    images: list of {"img": "/abs/path/image.jpg", "lbl": "/abs/path/label.txt"}
    Each pair was snapshot-locked at training start; missing or modified files
    are already pruned by the Bun backend before this is called.

    Output layout:
        <output_dir>/dataset/
            images/train/
            labels/train/
            data.yaml
    """
    dataset_dir = output_dir / "dataset"
    img_dir     = dataset_dir / "images" / "train"
    lbl_dir     = dataset_dir / "labels" / "train"

    # Always wipe the train directories before rebuilding so stale files from a
    # previous run don't silently pollute the dataset (e.g. old labels for images
    # that were modified or removed from the snapshot).
    if img_dir.exists():
        shutil.rmtree(img_dir)
    if lbl_dir.exists():
        shutil.rmtree(lbl_dir)

    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    for entry in images:
        img_file = Path(entry["img"])
        lbl_file = Path(entry["lbl"])
        if not img_file.exists() or not lbl_file.exists():
            continue

        dest_name = img_file.name
        # Avoid collisions across assets by prefixing with the asset folder name.
        if dest_name in seen:
            dest_name = f"{img_file.parent.parent.name}__{img_file.name}"
        seen.add(dest_name)

        shutil.copy2(img_file, img_dir / dest_name)
        shutil.copy2(lbl_file, lbl_dir / (Path(dest_name).stem + ".txt"))

    # Write data.yaml.
    data_yaml = dataset_dir / "data.yaml"
    yaml_content = {
        "path":  str(dataset_dir),
        "train": "images/train",
        "val":   "images/train",
        "nc":    len(class_map),
        "names": class_map,
        "task":  task,
    }
    with open(data_yaml, "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False)

    image_count = len(list(img_dir.iterdir()))
    return data_yaml, image_count


# ── memory helpers ─────────────────────────────────────────────────────────────

def get_ram_mb() -> int | None:
    """RSS memory of this process in MB — reads /proc/self/status, no extra deps."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024   # kB → MB
    except Exception:
        pass
    return None


def get_gpu_mb() -> int | None:
    """GPU memory currently allocated by PyTorch in MB, or None if not on GPU."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated() // (1024 * 1024)
    except Exception:
        pass
    return None


# ── training callback ──────────────────────────────────────────────────────────

def make_on_train_epoch_end(total_epochs: int, task: str):
    # Metric key suffix differs by task: "(M)" = mask (seg), "(B)" = box (det).
    suffix = "(M)" if task == "segment" else "(B)"

    def on_train_epoch_end(trainer):
        metrics = trainer.metrics or {}

        # Epoch-averaged losses from tloss tensor.
        # Seg: [box, seg, cls, dfl] — Det: [box, cls, dfl]
        loss_box = loss_cls = loss_dfl = None
        try:
            tl = trainer.tloss
            if tl is not None and hasattr(tl, '__len__') and len(tl) >= 3:
                loss_box = round(float(tl[0]), 6)
                loss_cls = round(float(tl[-2]), 6)
                loss_dfl = round(float(tl[-1]), 6)
        except Exception:
            pass

        precision = recall = None
        try:
            p = metrics.get(f"metrics/precision{suffix}")
            r = metrics.get(f"metrics/recall{suffix}")
            if p is not None: precision = round(float(p), 4)
            if r is not None: recall    = round(float(r), 4)
        except Exception:
            pass

        early_stop = bool(getattr(trainer, "stop", False))

        emit({
            "type":        "progress",
            "epoch":       trainer.epoch + 1,
            "epochs":      total_epochs,
            "loss":        round(float(trainer.loss), 6) if trainer.loss is not None else None,
            "lossBox":     loss_box,
            "lossCls":     loss_cls,
            "lossDfl":     loss_dfl,
            "mAP":         round(float(metrics.get(f"metrics/mAP50{suffix}", 0)), 4) if metrics else None,
            "precision":   precision,
            "recall":      recall,
            "ramMB":       get_ram_mb(),
            "gpuMB":       get_gpu_mb(),
            "earlyStop":   early_stop,
        })
    return on_train_epoch_end


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        emit({"type": "error", "message": f"Invalid config JSON: {e}"})
        sys.exit(1)

    images       = config["images"]             # locked snapshot: [{img, lbl, mtime}, ...]
    class_map    = config["classMap"]
    base_model   = config["baseModel"]          # e.g. "yolo26n" or "yolo26n-seg"
    epochs       = int(config["epochs"])
    batch_size   = int(config["batchSize"])     # -1 = auto
    imgsz        = int(config["imgsz"])
    device       = config["device"]             # "auto" | "cpu" | "cuda:0" | "mps"
    output_path  = Path(config["outputPath"]).expanduser()
    task         = task_for_model(base_model)   # "segment" | "detect"

    output_path.mkdir(parents=True, exist_ok=True)

    # Build merged dataset from the locked image list.
    try:
        data_yaml, dataset_size = build_dataset(images, class_map, output_path, task)
        emit({"type": "dataset", "imageCount": dataset_size})
    except Exception as e:
        emit({"type": "error", "message": f"Failed to build dataset: {e}"})
        sys.exit(1)

    # Check for a checkpoint from a previous paused run — resume if found.
    checkpoint = output_path / CHECKPOINT_FILE
    resuming   = bool(config.get("resumeFromCheckpoint", checkpoint.exists()))

    try:
        model = load_model(base_model, checkpoint, resuming)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load model: {e}"})
        sys.exit(1)

    # Register epoch callback.
    model.add_callback("on_train_epoch_end", make_on_train_epoch_end(epochs, task))

    # Train (or resume).
    try:
        results = train_once(
            model, data_yaml, epochs, batch_size, imgsz,
            device if device != "auto" else None,
            output_path, resuming,
        )
    except Exception as e:
        if (
            device == "auto" and
            os.environ.get("RETICLE_CPU_FALLBACK") != "1" and
            is_cuda_unavailable_error(e)
        ):
            emit({"type": "stderr", "text": "[train] CUDA unavailable for auto device; retrying on CPU..."})
            try:
                if resuming:
                    emit({"type": "stderr", "text": "[train] CPU fallback disables checkpoint resume and restarts from base model."})
                retry_on_cpu(config)
                return
            except Exception as cpu_err:
                emit({"type": "error", "message": f"Training failed after CPU fallback: {cpu_err}"})
                sys.exit(1)
        else:
            emit({"type": "error", "message": f"Training failed: {e}"})
            sys.exit(1)

    # Extract final metrics (key suffix depends on task).
    suffix = "(M)" if task == "segment" else "(B)"
    try:
        metrics      = results.results_dict
        mAP50        = round(float(metrics.get(f"metrics/mAP50{suffix}",    0)), 4)
        mAP50_95     = round(float(metrics.get(f"metrics/mAP50-95{suffix}", 0)), 4)
        weights_path = str(output_path / MODEL_FILE)
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
