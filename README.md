# Voice Output Extension

A self-contained Pi package for text-to-speech using **speakturbo** — a FastAPI TTS daemon powered by [pocket-tts](https://github.com/kyutai-labs/pocket-tts) (Kyutai Labs).  
~90ms to first sound, 8 built-in voices, synchronous playback — no mute on rapid calls.

Built on the [Speak-Turbo](https://github.com/EmZod/Speak-Turbo) CLI by EmZod, which provides the daemon and pocket-tts integration.

## Requirements

- Python 3.10+ (macOS 3.9 won't work)
- macOS (for `afplay` audio playback)
- ~100MB disk for the pocket-tts model weights

## Install

```bash
pi install ~/.pi/agent/extensions/voice_output
```

The install script finds Python 3.10+, creates a `.venv`, installs dependencies (pocket-tts, fastapi, uvicorn), and pre-downloads model weights so the first speak call is fast.

## Usage

### Tool: `speak`

| Parameter | Type   | Description | Default |
|-----------|--------|-------------|---------|
| `text`    | string | Text to speak aloud | required |
| `voice`   | string | Voice to use | `alba` |

**Voices:** alba (female, default), marius (male), javert (male), jean (male), fantine (female), cosette (female), eponine (female), azelma (female)

### Agent guidelines

- **Speak at most once per turn.** Use for the narrative headline or key takeaway. Provide complementary detail (code, tables, data) in text.
- **Call speak at the very start** of your response — audio begins immediately.
- **After speaking, do not echo verbatim.** Complementary text is welcome.
- Voice for conversation, text for code/tables/syntax.

## Architecture

```
extensions/index.ts (Pi extension)
  │  GET /health → ensure daemon is alive
  │  curl GET /tts?text=...&voice=... → temp.wav
  │  afplay temp.wav (synchronous, blocks until done)
  ▼
daemon/daemon_streaming.py (FastAPI + pocket-tts, port 7125)
  │  streaming WAV response, deep-copied voice state
  ▼
Audio plays — no overlap, no mute
```

The daemon auto-shuts down after 1 hour idle (~100MB freed). Restarts on next use.

## Files

| File | Description |
|------|-------------|
| `package.json` | Pi package manifest (`pi: { extensions: ["./extensions"] }`) |
| `extensions/index.ts` | Pi extension (registers `speak` tool) |
| `daemon/daemon_streaming.py` | SpeakTurbo TTS daemon |
| `daemon/requirements.txt` | Python dependencies |
| `scripts/install.sh` | Setup script (creates venv, installs deps, pre-downloads model) |

## Credits

- **TTS engine:** [pocket-tts](https://github.com/kyutai-labs/pocket-tts) by Kyutai Labs — fast local TTS on Apple Silicon
- **Daemon & CLI:** [Speak-Turbo](https://github.com/EmZod/Speak-Turbo) by EmZod — the speakturbo daemon this package bundles
- **Pi integration:** Built on [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension API
