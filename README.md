# Voice Output Extension

A self-contained Pi package for text-to-speech using **speakturbo** (pocket-tts engine).  
~90ms to first sound, 8 built-in voices, synchronous playback — no mute on rapid calls.

## Install

```bash
pi install ~/.pi/agent/extensions/voice_output
```

The install script creates a Python virtual environment, installs dependencies (pocket-tts, fastapi, uvicorn), and pre-downloads model weights so the first speak call is fast.

## Usage

### Tool: `speak`

| Parameter | Type   | Description | Default |
|-----------|--------|-------------|---------|
| `text`    | string | Text to speak aloud | required |
| `voice`   | string | Voice to use | `alba` |

**Voices:** alba (female), marius (male), javert (male), jean (male), fantine (female), cosette (female), eponine (female), azelma (female)

Legacy Kokoro voice names (`af_heart`, `am_adam`, etc.) are automatically mapped.

### Agent guidelines

- **Speak at most once per turn.** Use for the narrative headline or key takeaway. Provide complementary detail (code, tables, data) in text.
- **Call speak at the very start** of your response — audio begins immediately.
- **After speaking, do not echo verbatim.** Complementary text is welcome.
- Voice for conversation, text for code/tables/syntax.

## Architecture

```
extensions/index.ts
  │  GET /health → ensure daemon is alive
  │  curl GET /tts?text=...&voice=... → temp.wav
  │  afplay temp.wav (synchronous)
  ▼
daemon/daemon_streaming.py (port 7125, FastAPI + pocket-tts)
  │  streaming WAV, ~90ms first audio
```

## Files

| File | Description |
|------|-------------|
| `package.json` | Pi package manifest |
| `extensions/index.ts` | Extension source (registers `speak` tool) |
| `daemon/daemon_streaming.py` | SpeakTurbo TTS daemon |
| `daemon/requirements.txt` | Python dependencies |
| `scripts/install.sh` | Setup script (creates venv, installs deps) |
