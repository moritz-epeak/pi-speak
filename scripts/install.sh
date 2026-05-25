#!/bin/bash
set -e

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$PACKAGE_DIR/.venv"

echo "voice_output: setting up Python environment..."

# pocket-tts requires Python >= 3.10. Find the best available Python.
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" &>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    # Fall back to python3, but check its version
    PYTHON="python3"
    if command -v "$PYTHON" &>/dev/null; then
        VER=$("$PYTHON" --version 2>&1 | grep -oP '(?<= )[0-9]+\.[0-9]+')
        MAJOR="${VER%.*}"
        if [ "$MAJOR" -lt 10 ] 2>/dev/null; then
            echo "Error: Python 3.10+ required but found $VER."
            echo "Install Python 3.10+ from https://python.org or via your package manager."
            exit 1
        fi
    else
        echo "Error: python3 is required but not found."
        echo "Install Python 3.10+ from https://python.org or via your package manager."
        exit 1
    fi
fi

echo "  Using $PYTHON ($($PYTHON --version 2>&1))"

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
