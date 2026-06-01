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

- **Pi** (provides Node.js runtime for the extension)
- **Python 3.10+** (macOS system `python3` is 3.9 — won't work)
- **macOS** (for `afplay` audio playback)
- **~100MB disk** for model weights

## Architecture

```
extensions/index.ts (Pi extension)
  │  GET /health → ensure daemon is alive
  │  http.get /tts?text=...&voice=... → temp.wav
  │  afplay temp.wav (synchronous)
  ▼
daemon/daemon_streaming.py (FastAPI + pocket-tts, port 7125)
  │  streaming WAV, ~90ms first audio
```

The daemon auto-shuts down after 1 hour idle (~100MB freed).

See [docs/architecture.md](docs/architecture.md) for a detailed technical walkthrough.

## Usage

### Tool: `speak`

| Parameter | Type   | Description | Default |
|-----------|--------|-------------|---------|
| `text`    | string | Text to speak aloud | required |
| `voice`   | string | Voice to use | `alba` |

**Voices:** alba (female, default), marius (male), javert (male), jean (male), fantine (female), cosette (female), eponine (female), azelma (female)

## Features

### From pocket-tts / Speak-Turbo

These capabilities come from the integrated TTS engine and daemon:

- **~90ms latency** — first audio arrives before generation finishes. Feels instant.
- **Streaming playback** — starts playing mid-generation instead of waiting for the full file.
- **8 built-in voices** — male and female options (alba, marius, javert, jean, fantine, cosette, eponine, azelma).
- **Auto-shutdown** — daemon frees ~100MB after 1hr idle. No manual process management.
- **CPU only** — runs on Apple Silicon CPU. Fast enough for ~90ms.

### From the Pi extension

These capabilities are provided by the extension's TypeScript integration:

- **Synchronous playback** — `afplay` blocks until done. No overlapping processes, no mute on rapid calls.
- **Self-contained** — single `pi install`, no manual path config, no external repo clone.
- **Health checks** — verifies the daemon is alive before every speak call, auto-restarts if crashed.
- **No cold start** — model weights are pre-downloaded during install. First speak call is ~90ms, not 2-5s.
- **Resistant to crashes** — health checks restart the daemon automatically if it dies.

## Token Cost

Every speak call consumes context tokens. Understanding the cost helps you decide when to speak vs. write.

| Component | Approximate tokens |
|-----------|-------------------:|
| Tool call (function name + JSON wrapper) | ~25–35 tokens |
| Spoken text (appears once in tool call params) | length of text in tokens |
| Tool result (`"✓ spoken"`) | ~2 tokens |
| **Total per speak call** | **spoken text tokens + ~30 overhead** |

Speaking costs roughly the same as writing — the text appears once in the tool call parameters and is never echoed in the result. The spoken delivery is effectively free bandwidth on top of the same token budget.

## Agent guidelines

The extension injects voice behavior rules into the system prompt every turn. These govern when and how the agent uses the speak tool:

- **Use speak as your primary voice channel.** Call it when the user asks you to read, explain, or converse. Don't just say you will speak — actually call the tool.
- **Call speak at most once per turn.** Use it for the narrative headline or key takeaway. Provide complementary detail — code, tables, data — in your text response.
- **Call speak at the very start of your response.** Audio begins immediately, in parallel with your written text.
- **After speaking, do not echo verbatim.** Complementary text (code blocks, tables, additional detail) is welcome. The spoken delivery handles narration; your text handles structure.
- **When speaking, use natural spoken language.** Avoid markdown formatting, bullet points, numbered lists, emojis, bold markers, and any visual-only text conventions.
- **Use text for code, tables, syntax, and structured information.** Use voice for natural conversation, explanations, and spoken feedback.
- **Keep chain-of-thought concise.** Don't pad with long internal monologue.
- **Text and voice are complementary channels.** Use text for visual structure (tables, code) and voice for the narrative explaining it.

## Limitations

| Limitation | Notes |
|---|---|
| **macOS only** (`afplay`) | Linux `aplay` not yet supported |
| **No voice cloning** | Custom `.wav` voices not yet supported |
| **No emotion tags** | No `[laugh]`, `[sigh]` support |
| **Single daemon port (7125)** | No auto-fallback if port is in use |

## Testing

See [docs/testing.md](docs/testing.md) for the full test suite details (41 tests, 59 assertions).

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
| `docs/testing.md` | Test suite documentation |

## Credits

- **TTS model:** [pocket-tts](https://github.com/kyutai-labs/pocket-tts) by Kyutai Labs
- **Daemon & CLI:** [Speak-Turbo](https://github.com/EmZod/Speak-Turbo) by EmZod
- **Pi integration:** [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension API
