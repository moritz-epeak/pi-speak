# Install Script Explained — `scripts/install.sh`

This file explains what happens when you run `pi install speak` or execute `install.sh` directly.

## Step-by-step

### 1. Find the package root

```bash
PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
```

Resolves `scripts/` to the package root directory. Works regardless of where the package is installed on disk.

### 2. Find Python 3.10+

```bash
for cmd in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
        if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done
```

pocket-tts requires Python ≥ 3.10. macOS ships 3.9 as `python3`, so the script can't just use `python3`. It tries common version-specific commands (`python3.13`, `python3.12`, `python3.11`, `python3.10`) before falling back to plain `python3` (which might be 3.9). Only accepts versions ≥ 3.10.

If no suitable Python is found, the script prints an error and exits.

### 3. Create virtual environment

```bash
if [ ! -d "$VENV_DIR" ]; then
    "$PYTHON" -m venv "$VENV_DIR"
fi
```

Creates `.venv/` inside the package directory if it doesn't exist. This isolates Python dependencies from the system.

### 4. Install Python dependencies

```bash
"$VENV_DIR/bin/pip" install -q -r "$PACKAGE_DIR/daemon/requirements.txt"
```

Installs `pocket-tts`, `fastapi`, and `uvicorn` into the virtual environment. These are the runtime dependencies for the TTS daemon.

### 5. Pre-download model weights

```bash
"$VENV_DIR/bin/python3" -c "
from pocket_tts import TTSModel
TTSModel.load_model()
"
```

Downloads the ~100MB pocket-tts model weights into HuggingFace's cache (`~/.cache/huggingface/`). This happens at install time so the first speak call is ~90ms instead of 2-5s.

If the download fails (e.g. no internet during install), the daemon will download on first use instead.

## Why this approach

- **No system Python dependency** — the `.venv` is self-contained inside the package. Uninstalling the package removes everything.
- **Pre-download avoids cold-start surprise** — the 2-5s model load on first call felt like a bug. Pre-downloading during install makes the first call fast.
- **Version detection prevents cryptic errors** — without it, macOS users get a confusing `pocket-tts` install failure because their system Python is 3.9.
