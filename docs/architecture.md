# Architecture — `extensions/index.ts`

This document explains how the Speak extension works, from the moment Pi loads it to the moment audio comes out of your speakers.

## Overview

The extension has three layers:

```
Pi agent
    ↓  registers tool, injects guidelines
extensions/index.ts   (TypeScript, runs in Pi's runtime)
    ↓  ensures daemon is alive, sends HTTP requests
daemon/daemon_streaming.py   (Python, FastAPI server on port 7125)
    ↓  generates audio with pocket-tts, streams WAV
afplay (macOS CLI)   plays the WAV file
```

## Layer 1: Pi Extension (`index.ts`)

### Extension lifecycle

Pi loads the extension once when it starts. The extension:

1. **Registers a `speak` tool** — the agent can call this tool to speak text.
2. **Injects system prompt guidelines** — every turn, `before_agent_start` adds voice behavior rules to the agent's system prompt.
3. **Re-registers on session start** — `session_start` handler ensures the tool survives `/new`, `/resume`, `/fork`.
4. **Stops the daemon on unload** — `unload` handler kills the Python daemon process.

### Daemon management

The extension runs a persistent Python daemon in the background. Management happens at three levels:

**On load:** `ensureDaemonRunning()` is called to warm-start the daemon. It checks `GET /health` — if the daemon is already running (from a previous session), it skips startup. If not, it kills any stale processes, spawns a fresh daemon, and waits for it to respond.

**On every speak call:** `speakText()` calls `ensureDaemonRunning()` again before sending the TTS request. This handles the case where the daemon crashed between calls (e.g. idle timeout, port conflict).

**On crash:** The `close` event handler detects when the daemon process exits unexpectedly. It clears the `daemonReady` flag so the next speak call will restart the daemon.

Path resolution is done at runtime using `__dirname` (or `import.meta.url` in ESM mode), so the extension works regardless of where Pi installs the package.

### The speak tool

When the agent calls `speak(text, voice)`:

1. The `execute()` function fires `speakText()` in the background (no `await`) and immediately returns `"✓ spoken"` as the tool result.
2. `speakText()` ensures the daemon is running, then sends a `curl` request to `GET /tts?text=...&voice=...`.
3. The daemon streams the WAV response. `curl` saves it to a temp file.
4. `afplay` plays the temp file synchronously — the tool blocks until audio finishes.
5. The temp file is deleted after playback.

The tool result deliberately avoids echoing the spoken text. Returning the text verbatim caused the agent to repeat it in written responses. The spoken text is visible in the tool call parameters instead.

### Voice guidelines

Two sets of rules govern how the agent uses voice:

**Tool-level `promptGuidelines`** — short, attached to the tool definition:
- Use speak for reading aloud
- Formulate as natural spoken language
- Do not echo verbatim; complementary text is fine
- Voice for conversation, text for code/tables

**System prompt injection (every turn)** — broader, injected via `before_agent_start`:
- Speak at most once per turn (headline + detail pattern)
- Call speak at the start of the response
- After speaking, complementary text is welcome
- Keep chain-of-thought concise

## Layer 2: TTS Daemon (`daemon/daemon_streaming.py`)

A FastAPI server that loads pocket-tts once and keeps it resident.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Returns `{"status": "ready", "voices": [...]}` |
| `/tts` | GET | Streams a WAV file. Params: `text`, `voice` |

### Key design

- **Single daemon** — model loading is slow (~3s). Loading once and keeping it resident eliminates cold-start latency.
- **Streaming response** — audio starts flowing before generation finishes. First audio arrives at ~90ms.
- **Deep-copied voice state** — each request gets its own copy of the voice model state. No mutation leaks between requests.
- **Auto-shutdown** — after 1 hour idle, the daemon kills itself. Frees ~100MB of memory.

### API flow

```
curl GET /tts?text=Hello&voice=alba
  ↓
FastAPI handler
  ↓  get_model() → TTSModel (cached, loaded once)
  ↓  copy.deepcopy(get_voice_state("alba")) → fresh state per request
  ↓  model.generate_audio_stream(state, "Hello") → yields audio chunks
  ↓  each chunk: clamp(-1,1) * 32767 → short → bytes
  ↓  WAV header + audio chunks + trailing silence → StreamingResponse
  ↓
curl writes to temp file
  ↓
afplay plays temp file
```

## Layer 3: Audio Playback (`afplay`)

macOS's built-in `afplay` CLI plays WAV files. The extension calls it with `execSync`, which blocks until playback finishes. This is the key difference from the old architecture:

- **Old (fire-and-forget):** `Popen` started `afplay` and immediately returned. Two rapid calls meant two `afplay` processes competing for CoreAudio → second call got silence.
- **New (synchronous):** `execSync` blocks until `afplay` exits. Only one process at a time. No mute.

## Data flow (complete)

```
Agent calls speak("Hello world", "alba")
  │
  │ execute() fires speakText() in background
  │ returns "✓ spoken" immediately
  ▼
speakText():
  │  1. ensureDaemonRunning() → GET /health
  │  2. curl GET /tts?text=Hello%20world&voice=alba
  │  3. curl saves streaming WAV to /tmp/speakturbo_XXXXX.wav
  │  4. afplay /tmp/...wav  (synchronous — blocks)
  │  5. rm /tmp/...wav
  ▼
Audio plays. Agent's text response follows.
```
