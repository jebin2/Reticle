# YOLOStudio — High Level Design

> **Tagline:** Just annotate and train. A standalone desktop app to train YOLO models with custom datasets — no code, no terminal, no Python knowledge required.

---

## Stack

| Layer | Technology | Purpose |
|---|---|---|
| Desktop shell | Electrobun v1 | App window, IPC, file system, process management |
| UI | WebView (HTML/CSS/TS) | All user-facing screens |
| GPU rendering | Electrobun WGPU / `<electrobun-wgpu>` | Live inference preview overlay |
| Training engine | Python sidecar (bundled) | Ultralytics YOLO training via `Bun.spawn` |
| Inference engine | onnxruntime-web | WebGPU → WASM fallback, zero custom shaders |
| Model format bridge | ONNX export | `.pt` (training) → `.onnx` (inference in app) |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  Electrobun App                                       │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  BrowserWindow (WebView UI)                      │ │
│  │                                                  │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │ Annotate │  │ Dataset  │  │ Train / Export │  │ │
│  │  │  Screen  │  │ Manager  │  │    Screen      │  │ │
│  │  └──────────┘  └──────────┘  └───────────────┘  │ │
│  │                                                  │ │
│  │  ┌──────────────────────────────────────────┐   │ │
│  │  │  <electrobun-wgpu> Inference Preview      │   │ │
│  │  │  onnxruntime-web (WebGPU → WASM fallback) │   │ │
│  │  └──────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Bun Backend (IPC bridge)                        │ │
│  │  - File I/O (images, annotations, datasets)      │ │
│  │  - Bun.spawn → Python sidecar                    │ │
│  │  - Stream training logs to UI                    │ │
│  │  - Trigger ONNX export after training            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
└──────────────┬───────────────────────────────────────┘
               │ Bun.spawn
┌──────────────▼───────────────────────────────────────┐
│  Python Sidecar (bundled, invisible to user)          │
│  - Ultralytics YOLO (train, val, export)              │
│  - PyTorch → auto-detects CUDA / MPS / CPU            │
│  - Streams progress via stdout                        │
└──────────────────────────────────────────────────────┘
```

---

## Screens / User Flow

```
1. Landing / Home
      ↓
2. New Project
   - Project name
   - Select base model (YOLOv8n / YOLOv8s / YOLOv11n ...)
   - Define classes (add/remove labels)
      ↓
3. Import Images
   - Drag & drop images or folder
   - Thumbnail grid preview
      ↓
4. Annotate
   - Canvas with bounding box drawing tool
   - Class selector sidebar
   - Keyboard shortcuts (next/prev image, delete box)
   - Auto-saves YOLO .txt format per image
      ↓
5. Dataset Review
   - Per-class image count
   - Train / val split slider (default 80/20)
   - Flag unannotated images
      ↓
6. Train
   - Config: epochs, image size, batch size (simple presets)
   - Start button → Bun.spawn Python sidecar
   - Live loss chart (box loss, cls loss, mAP)
   - Streamed stdout log
   - Auto-export to .onnx on completion
      ↓
7. Inference Preview
   - Load any image or webcam feed
   - Run model via onnxruntime-web (WebGPU → WASM)
   - Draw bounding boxes over <electrobun-wgpu> surface
   - Confidence threshold slider
      ↓
8. Export
   - .pt (PyTorch)
   - .onnx (default, used for preview)
   - TFLite / CoreML (via Ultralytics export)
```

---

## Data / File Structure (per project)

```
~/YOLOStudio/projects/<project-name>/
├── project.json            ← metadata (classes, base model, config)
├── images/
│   ├── train/
│   │   ├── img001.jpg
│   │   └── img001.txt      ← YOLO annotation (cx cy w h class)
│   └── val/
│       ├── img020.jpg
│       └── img020.txt
├── dataset.yaml            ← auto-generated for Ultralytics
├── runs/
│   └── train/
│       ├── weights/
│       │   ├── best.pt
│       │   └── best.onnx   ← auto-exported after training
│       └── results.csv
```

---

## Bun ↔ Python Communication

```ts
// Bun side — spawn and stream
const proc = Bun.spawn([
  "python3", "sidecar/train.py",
  "--data", "dataset.yaml",
  "--model", "yolov8n.pt",
  "--epochs", "50",
  "--imgsz", "640"
], { stdout: "pipe", stderr: "pipe" });

for await (const chunk of proc.stdout) {
  const line = new TextDecoder().decode(chunk);
  ipc.send("training-log", line);  // → UI live log
}
```

```python
# Python sidecar/train.py
from ultralytics import YOLO
import sys, json

model = YOLO(sys.argv["model"])
results = model.train(data=sys.argv["data"], epochs=int(sys.argv["epochs"]))
model.export(format="onnx")
print(json.dumps({"status": "done", "best": str(results.save_dir / "weights/best.onnx")}))
```

---

## Inference (onnxruntime-web)

```ts
// Load with GPU → CPU fallback
const session = await ort.InferenceSession.create("best.onnx", {
  executionProviders: ["webgpu", "wasm"]
});

// Run
const input = new ort.Tensor("float32", preprocessedImage, [1, 3, 640, 640]);
const { output0 } = await session.run({ images: input });

// Draw boxes on canvas / wgpu surface
renderDetections(output0, confidenceThreshold);
```

---

## Python Sidecar Bundling Strategy

- **Dev:** use system Python + `pip install ultralytics`
- **Distribution:** bundle Python via `python-build-standalone`
  - Self-contained ~80MB Python binary
  - Packed into Electrobun's zstd self-extractor (differential updates)
  - User sees zero Python — just the app

---

## Phases

### Phase 1 — Core Loop (MVP)
- [ ] Electrobun project scaffold
- [ ] Image import + thumbnail grid
- [ ] Annotation canvas (draw, edit, delete bounding boxes)
- [ ] YOLO `.txt` format save/load
- [ ] `dataset.yaml` auto-generation
- [ ] Python sidecar integration (`Bun.spawn`)
- [ ] Training launch + stdout log streaming
- [ ] Basic inference preview (onnxruntime-web + canvas)

### Phase 2 — Polish
- [ ] Live loss chart during training
- [ ] Train/val split UI
- [ ] Confidence threshold slider
- [ ] WGPU inference surface (`<electrobun-wgpu>`)
- [ ] Webcam inference
- [ ] Export UI (pt / onnx / tflite)

### Phase 3 — Distribution
- [ ] Bundle Python sidecar (python-build-standalone)
- [ ] Electrobun app packaging (Windows / macOS / Linux)
- [ ] Auto-update (Electrobun differential updates)
- [ ] Preset training configs (Fast / Balanced / Accurate)

---

## Key Constraints & Decisions

| Decision | Choice | Reason |
|---|---|---|
| Training engine | Python + Ultralytics | Most capable, least custom code |
| No Python for user | Bundled sidecar | User experience — zero setup |
| Inference in app | onnxruntime-web | No custom WGPU shaders needed |
| GPU fallback | WebGPU → WASM | Works on any machine |
| YOLO version | YOLOv8 / v11 (Ultralytics) | Best ecosystem, single API |
| Annotation format | YOLO `.txt` | Native format, no conversion |
| WGPU training | Not now | 6-12 months to implement — revisit when Electrobun ships tinygrad-like engine |
