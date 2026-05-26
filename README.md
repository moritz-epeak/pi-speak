# Speak — Text-to-Speech for Pi

A self-contained Pi package that gives your coding agent a voice.  
~90ms to first sound, 8 built-in voices, synchronous playback — no mute on rapid calls.

Built on [Speak-Turbo](https://github.com/EmZod/Speak-Turbo) (daemon + pocket-tts integration) and [pocket-tts](https://github.com/kyutai-labs/pocket-tts) (Kyutai Labs).

## Purpose

Pi coding agents communicate through text. That works for code, tables, and structured data — but it's slow and flat for conversation. Speak adds a **voice channel**: the agent speaks naturally while writing complementary text. The spoken delivery handles narration, tone, and key takeaways; the text response handles code, tables, and detail.

This creates a **summary + detail** pattern: the agent speaks the headline, then provides the details in text. No duplication, no echo — two complementary channels.

## Quick Install

```bash
pi install git:github.com/moritz-epeak/pi-speak
```

The install script finds Python 3.10+, creates a `.venv`, installs dependencies (pocket-tts, fastapi, uvicorn), and pre-downloads model weights (~100MB) so the first speak call is fast.

## Requirements

- Python 3.10+ (macOS system `python3` is 3.9 — won't work)
- macOS (for `afplay` audio playback)
- ~100MB disk for model weights

## Usage

### Tool: `speak`

| Parameter | Type   | Description | Default |
|-----------|--------|-------------|---------|
| `text`    | string | Text to speak aloud | required |
| `voice`   | string | Voice to use | `alba` |

**Voices:** alba (female, default), marius (male), javert (male), jean (male), fantine (female), cosette (female), eponine (female), azelma (female)

### Agent guidelines (injected every turn)

- **Speak at most once per turn.** Use for the narrative headline or key takeaway. Provide complementary detail in text.
- **Call speak at the very start** of your response — audio begins immediately.
- **After speaking, do not echo verbatim.** Complementary text is welcome.
- Voice for conversation, text for code/tables/syntax.

## Architecture

```
extensions/index.ts (Pi extension)
  │  GET /health → ensure daemon is alive
  │  curl GET /tts?text=...&voice=... → temp.wav
  │  afplay temp.wav (synchronous)
  ▼
daemon/daemon_streaming.py (FastAPI + pocket-tts, port 7125)
  │  streaming WAV, ~90ms first audio
```

The daemon auto-shuts down after 1 hour idle (~100MB freed).

## Pros & Cons

### Pros
- **~90ms latency** — first audio arrives before generation finishes. Feels instant.
- **No mute on rapid calls** — synchronous `afplay` blocks until done. No overlapping processes.
- **Self-contained** — single `pi install`, no manual path config, no external repo clone.
- **Auto-shutdown** — daemon frees ~100MB after 1hr idle. No manual process management.
- **Streaming** — starts playing mid-generation instead of waiting for the full file.
- **8 voices** — male and female options, decent quality for a ~100MB model.
- **Health checks** — verifies the daemon is alive before every speak call, auto-restarts if crashed.

### Cons
- **macOS only** — uses `afplay` for playback. Linux (`aplay`) would need a PR.
- **Python 3.10+ required** — macOS system Python is 3.9. Needs a manually installed Python.
- **8 voices only** — no voice cloning, no emotion tags, no custom voice uploads.
- **~100MB download** — model weights download on first install. Takes a few seconds.
- **No non-blocking mode** — synchronous playback blocks the tool. Can't fire-and-forget.
- **Single daemon port** — port 7125 is hardcoded (configurable via `SPEAKTURBO_PORT` env var).
- **CPU only** — runs on Apple Silicon CPU (no GPU acceleration). Fast enough for ~90ms but not real-time factor 10x+.

### When to use Speak vs alternatives

| Situation | Recommend |
|-----------|-----------|
| Fast voice responses (~90ms) | **Speak** |
| Voice cloning or custom voices | [Speak-Turbo CLI](https://github.com/EmZod/Speak-Turbo) or Chatterbox |
| Emotion tags (`[laugh]`, `[sigh]`) | Chatterbox |
| Linux or cross-platform | Speak-Turbo CLI (has `aplay` fallback) |
| Non-blocking playback | Fork Speak to add `--background` flag |

## Files

| File | Description |
|------|-------------|
| `package.json` | Pi package manifest (`name: "speak"`, `pi: { extensions: ["./extensions"] }`) |
| `extensions/index.ts` | Pi extension — registers the `speak` tool |
| `daemon/daemon_streaming.py` | SpeakTurbo TTS daemon (FastAPI + pocket-tts) |
| `daemon/requirements.txt` | Python dependencies |
| `scripts/install.sh` | Setup script — creates `.venv`, installs deps, pre-downloads model |

## Credits

- **TTS model:** [pocket-tts](https://github.com/kyutai-labs/pocket-tts) by Kyutai Labs
- **Daemon & CLI:** [Speak-Turbo](https://github.com/EmZod/Speak-Turbo) by EmZod
- **Pi integration:** [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension API
