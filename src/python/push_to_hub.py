"""
Nab HuggingFace Hub push script.

Called by the Bun process with JSON config on stdin:
{
  "modelPath": "/abs/path/best.pt",
  "repoId":    "username/model-name",
  "token":     "hf_..."
}

Progress emitted as newline-delimited JSON to stdout:
  {"type": "progress", "text": "..."}
  {"type": "done",     "url": "https://huggingface.co/..."}
  {"type": "error",    "message": "..."}
"""

import json
import sys
from pathlib import Path
from logger import emit


def main():
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        emit({"type": "error", "message": f"Invalid config: {e}"})
        sys.exit(1)

    model_path = config["modelPath"]
    repo_id    = config["repoId"]
    token      = config["token"]
    file_name  = config.get("fileName", "model.pt")

    if not Path(model_path).exists():
        emit({"type": "error", "message": f"Model file not found: {model_path}"})
        sys.exit(1)

    try:
        from huggingface_hub import HfApi
    except ImportError:
        emit({"type": "error", "message": "huggingface_hub is not installed in the venv."})
        sys.exit(1)

    api = HfApi(token=token)

    emit({"type": "progress", "text": "Verifying token..."})
    try:
        user = api.whoami()
        emit({"type": "progress", "text": f"Authenticated as {user['name']}"})
    except Exception as e:
        emit({"type": "error", "message": f"Authentication failed: {e}"})
        sys.exit(1)

    emit({"type": "progress", "text": f"Creating repository {repo_id}..."})
    try:
        api.create_repo(repo_id=repo_id, repo_type="model", exist_ok=True)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to create repo: {e}"})
        sys.exit(1)

    size_mb = Path(model_path).stat().st_size / (1024 * 1024)
    emit({"type": "progress", "text": f"Uploading {file_name} ({size_mb:.1f} MB)..."})
    try:
        api.upload_file(
            path_or_fileobj=model_path,
            path_in_repo=file_name,
            repo_id=repo_id,
            repo_type="model",
        )
    except Exception as e:
        emit({"type": "error", "message": f"Upload failed: {e}"})
        sys.exit(1)

    emit({"type": "done", "url": f"https://huggingface.co/{repo_id}"})


if __name__ == "__main__":
    main()
