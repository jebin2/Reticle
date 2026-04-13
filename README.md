# Reticle

Train custom object detection models without writing a single line of code or opening a terminal.

Reticle is a desktop application that brings the full YOLO training pipeline — annotation, training, inference, and export — into a single point-and-click interface. Whether you're building a quality control system, a wildlife monitor, or a custom detector for any domain, Reticle handles the complexity so you can focus on your data and results.

---

## What You Can Do

### Annotate Images
Draw bounding boxes directly on your images using a canvas-based annotation tool. Assign classes, navigate between images with keyboard shortcuts, and save labels in standard YOLO format — all without leaving the app.

- Add and manage custom object classes
- Draw bounding boxes and polygon masks
- Keyboard-driven navigation (previous, next, skip)
- Per-class image counts at a glance

### Manage Datasets (Assets)
Organize your images into named datasets called Assets. Drag and drop images in, see a thumbnail grid, track how many images are annotated, and control your train/validation split before training.

### Train Models
Kick off a training run with a few clicks. Pick a base YOLO model size, set your epochs and batch size, choose which datasets to train on, and watch live loss curves and streamed logs as training runs. Reticle handles the environment setup automatically.

- Choose model size: nano, small, medium, large, or extra-large
- Configure epochs, batch size, image resolution, and compute device
- Combine multiple datasets in a single training run
- Pause, resume, or restart runs at any time
- Automatic ONNX export when training completes

### Run Live Inference
Test your trained model immediately. Upload an image or point a webcam at your subject, adjust the confidence threshold, and see bounding box predictions rendered in real time with WebGPU acceleration.

- Toggle visibility per class
- Adjust confidence threshold with a slider
- Webcam and image upload support

### Export Models
Export trained weights in the format your deployment target needs.

| Format | Best For |
|--------|----------|
| PyTorch (`.pt`) | Fine-tuning, Python pipelines |
| ONNX (`.onnx`) | Cross-platform CPU/GPU inference |
| TFLite (`.tflite`) | Mobile and edge devices |
| CoreML | Apple Neural Engine (macOS / iOS) |
| OpenVINO | Intel hardware acceleration |

### Push to Hugging Face Hub
Share your trained model publicly or store it privately by pushing directly to a Hugging Face repository. Authenticate once with your token and push with a click.

---

## How to Use

### 1. Create an Asset
Open the **Assets** page and create a new dataset. Give it a name, then drag your images into the thumbnail grid.

### 2. Annotate
Click into an asset to open the **Annotate** view. Add your object classes in the panel on the right, then draw bounding boxes around objects in each image. Use `A` / `D` to move between images and `B` to switch to the box tool.

| Key | Action |
|-----|--------|
| `H` | Hand (pan) tool |
| `B` | Bounding box tool |
| `P` | Polygon tool |
| `F` | Fit image to canvas |
| `A` | Previous image |
| `D` | Next image |
| `Delete` | Remove selected annotation |

### 3. Create a Training Run
Go to the **Train** page and create a new run. Select one or more assets, choose a YOLO base model, and set your training parameters. Hit **Start** — Reticle installs any missing dependencies on the first run, then begins training.

### 4. Monitor Progress
Watch live loss curves and log output stream in as training proceeds. Runs can be paused and resumed. When training finishes, a trained model is ready immediately.

### 5. Test with Inference
Switch to the **Inference** page, select your completed run, and upload an image or enable your webcam. Adjust the confidence slider to filter weak predictions. Toggle classes on or off to focus on what matters.

### 6. Export or Share
Go to **Export** to download your model in any supported format. Or go to **Hub** to push it to Hugging Face with your repository ID and access token.

---

## Overview Dashboard

The **Overview** page gives you a quick summary of your workspace — total assets, training runs, images, and unique classes — alongside a log of recent activity across all your work.

---

## Data and Privacy

Everything stays local. Reticle stores your images, annotations, training weights, and run history on your own machine. Nothing is uploaded unless you explicitly push to Hugging Face Hub.
