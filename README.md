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
