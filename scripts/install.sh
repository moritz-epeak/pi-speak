#!/bin/bash
set -e

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$PACKAGE_DIR/.venv"

echo "voice_output: setting up Python environment..."

# Find Python 3.10+ (pocket-tts requires >=3.10)
PYTHON=""
for cmd in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
        major="${ver%%.*}"
        minor="${ver#*.}"
        if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
            PYTHON="$cmd"
            echo "  Found Python $ver ($cmd)"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "Error: Python 3.10+ is required but not found."
    echo "  Detected: $(python3 --version 2>&1)"
    echo "  Install Python 3.10+ from https://python.org or via your package manager."
    exit 1
fi

# Create venv if missing
if [ ! -d "$VENV_DIR" ]; then
    echo "  Creating virtual environment..."
    "$PYTHON" -m venv "$VENV_DIR"
fi

# Install Python dependencies
echo "  Installing Python dependencies (pocket-tts, fastapi, uvicorn)..."
"$VENV_DIR/bin/pip" install -q -r "$PACKAGE_DIR/daemon/requirements.txt" 2>&1

# Pre-download model weights so first speak call is fast (~90ms)
echo "  Pre-downloading TTS model weights (~100MB)..."
"$VENV_DIR/bin/python3" -c "
from pocket_tts import TTSModel
TTSModel.load_model()
print('  Model weights downloaded.')
" 2>&1 || echo "  (Model download deferred to first use)"

echo "voice_output: Python environment ready."
echo ""
echo "  Run 'pi' to start using the speak tool."
