# Nab

Train custom object detection models — no code, no terminal.

## Quickstart

1. **Assets** — Create a dataset, drag in your images
2. **Annotate** — Draw bounding boxes, assign classes
3. **Train** — Pick a YOLO model size, hit Start
4. **Inference** — Upload an image to test
5. **Export** — Download as `.pt`, `.onnx`, TFLite, CoreML, OpenVINO, or a standalone CLI binary
6. **Hub** — Push to Hugging Face with your token

Everything stays local unless you push to Hub.

## CLI Export

Export your model as a single executable binary — model weights included, no setup needed.

```sh
./apple-detect photo.jpg
./apple-detect photo.jpg --conf 0.7
./apple-detect photo.jpg --output results.json
```

Drop the binary on any machine and run it. Dependencies install automatically on first use.

## Annotation Shortcuts

| Key | Action |
|-----|--------|
| `H` | Pan |
| `B` | Bounding box |
| `P` | Polygon |
| `F` | Fit image to canvas |
| `+` / `-` | Zoom in / out |
| `←` / `→` | Previous / Next image |
| `Delete` | Remove annotation |

## Behaviour

### Model type selection

When creating a training run, Nab inspects every selected asset's annotations and picks the right model family automatically.

| Asset annotations | Model family | What happens |
|---|---|---|
| Bounding boxes only | Detection (`yolo*n/s/m/l/x`) | Det model list shown; seg models hidden |
| Polygons only | Segmentation (`yolo*n/s/m/l/x-seg`) | Seg model list shown; det models hidden |
| Mix — some bbox, some polygon | User chooses | Warning shown; toggle to pick det or seg |
| Unknown (annotated before polygon tracking) | User chooses | Same warning and toggle as mixed |

### Start / Resume / Refresh

| Action | When available | What it does |
|---|---|---|
| **Start** | `idle` | Fresh training run; no checkpoint |
| **Start again** | `done` | Resets to epoch 0; discards previous weights |
| **Retry** | `failed` | Same as Start again — clean slate |
| **Resume** | `paused` | Continues from the last saved checkpoint; refreshes the dataset snapshot (adds new images, drops deleted ones) |
| **Pause** | `training` | Sends SIGKILL to the trainer; checkpoint is preserved so Resume works |
| **Stop** | `training` / `paused` | Sends SIGKILL and deletes the checkpoint; run returns to `idle` |

### Dataset snapshot on Resume

Resuming does not re-scan all assets from scratch. Instead it diffs against the snapshot saved at the last Start:

- Images whose label file was **deleted or emptied** are dropped from the run.
- Images whose label file was **modified** are updated in place (new mtime recorded).
- Images **added after the last Start** are appended to the dataset.
- The class map is preserved from the original run (no remapping on resume).
