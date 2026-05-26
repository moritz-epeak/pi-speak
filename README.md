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

See [docs/install-explained.md](docs/install-explained.md) for what the install script does step by step.

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

See [docs/architecture.md](docs/architecture.md) for a detailed technical walkthrough.

## Features

- **~90ms latency** — first audio arrives before generation finishes. Feels instant.
- **Streaming playback** — starts playing mid-generation instead of waiting for the full file.
- **Synchronous playback** — `afplay` blocks until done. No overlapping processes, no mute on rapid calls.
- **Self-contained** — single `pi install`, no manual path config, no external repo clone.
- **8 voices** — male and female options.
- **Auto-shutdown** — daemon frees ~100MB after 1hr idle. No manual process management.
- **Health checks** — verifies the daemon is alive before every speak call, auto-restarts if crashed.
- **CPU only** — runs on Apple Silicon CPU. Fast enough for ~90ms.

## Pros

- **No mute on rapid calls** — synchronous playback means no overlapping audio processes.
- **No cold start** — model is pre-downloaded during install. First speak call is ~90ms, not 2-5s.
- **No external dependencies** — everything is bundled in the package.
- **Resistant to crashes** — health checks restart the daemon automatically if it dies.

## Limitations

| Limitation | Notes |
|---|---|
| **macOS only** (`afplay`) | Linux `aplay` not yet supported |
| **No voice cloning** | Custom `.wav` voices not yet supported |
| **No emotion tags** | No `[laugh]`, `[sigh]` support |
| **No non-blocking mode** | No fire-and-forget playback option |
| **Single daemon port (7125)** | No auto-fallback if port is in use |

## Files

| File | Description |
|------|-------------|
| `package.json` | Pi package manifest (`name: "speak"`) |
| `extensions/index.ts` | Pi extension — registers the `speak` tool |
| `daemon/daemon_streaming.py` | SpeakTurbo TTS daemon (FastAPI + pocket-tts) |
| `daemon/requirements.txt` | Python dependencies |
| `scripts/install.sh` | Setup script |
| `docs/architecture.md` | Technical architecture documentation |
| `docs/install-explained.md` | Install script step-by-step explanation |

## Credits

- **TTS model:** [pocket-tts](https://github.com/kyutai-labs/pocket-tts) by Kyutai Labs
- **Daemon & CLI:** [Speak-Turbo](https://github.com/EmZod/Speak-Turbo) by EmZod
- **Pi integration:** [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension API
