# Speak — Development Roadmap

> **Last updated:** 2026-05-28 — v2.1.0 shipped with all P0–P2 items completed.

## Current State

### What pi-speak does well

- **~90ms latency** — first audio arrives before generation finishes. Streaming TTS
  is a real differentiator.
- **Synchronous playback** — `afplay` blocks until done. No mute on rapid calls.
- **Self-contained** — single `pi install`, no `uv` dependency, no system Python
  pollution beyond `.venv`.
- **Health checks per call** — verifies daemon alive before every TTS request,
  auto-restarts on crash.
- **8 built-in voices** — good variety, no config needed.
- **Guidelines injection** — comprehensive voice behavior rules injected every turn.
- **Error propagation** — failures return `isError: true` so the model knows audio failed.
- **Config file** — `~/.pi/agent/speak.json` overrides voice, port, and playback mode.
- **Esc stop control** — terminal input listener cuts audio mid-speech.
- **Text sanitization** — `prepareText()` strips markdown before TTS.
- **Playback modes** — synchronous, interrupt, queue, fire-and-forget.
- **Test suite** — 41 Vitest tests with 59 assertions covering all critical paths.

### Known limitations

- **No streaming TTS playback** — downloads full audio, then plays. Streaming would
  reduce per-call latency further.
- **Single daemon port (7125)** — no auto-fallback if port is in use.
- **No macOS speech controller integration** — no system-wide voice override.
- **No volume/rate controls** — `afplay` speed and volume aren't configurable.

---

## Completed Roadmap (v2.1.0)

All items from the original priority roadmap have been implemented.

### P0 — Critical (fix real bugs)

#### ✅ Error propagation

The `execute()` function now `await`s `playbackController.play()` and returns
`isError: true` with a descriptive message on failure. The model can fall back
to text-only output when audio fails.

#### ✅ Temp file cleanup on early abort

An abort handler registered via `signal.addEventListener("abort", ...)` cleans up
the temp file mid-download or mid-playback. Also covered by unit tests.

---

### P1 — High value (address real gaps)

#### ✅ Config file for voice defaults

`~/.pi/agent/speak.json` is read at startup via `loadConfig()`. Supported keys:
`voice`, `port`, `playbackMode`. Merged with hardcoded defaults. No validation
pipeline — simple JSON parse with error fallback to `{}`.

#### ✅ Stop controls — Esc to cut audio

Registered via `ctx.ui.onTerminalInput` in `session_start`. On Esc: kills `afplay`,
removes temp file, clears `currentPlayback` state. Non-Esc input passes through.

#### ✅ Text sanitization as safety net

`prepareText()` strips code fences, inline code, links, headings, bold/italic,
strikethrough, list markers, table pipes, and normalizes whitespace. Regex-based,
12 dedicated unit tests.

---

### P2 — Medium value (power-user features)

#### ✅ Playback modes — interrupt and queue

`PlaybackController` class with four modes:
- **Synchronous** (default) — blocks until done.
- **Interrupt** — kills current audio, starts fresh.
- **Queue** — chains plays in sequence.
- **Fire-and-forget** — non-blocking, allows overlap.

Configurable via `playbackMode` in the config file. 5 unit tests covering all modes.

---

### P3 — Polish items (also completed)

#### ✅ Sync `pkill` + `sleep` in daemon restart

Replaced with async `spawn("pkill", ...)` + `setTimeout(500)` — non-blocking.

#### ✅ Daemon health-poll timeout (30s → 6s)

Reduced from 60 iterations × 100ms to 12 iterations × 500ms (6s max). Daemon
typically starts in ~3s.

#### ✅ `daemonHealth()` connection reuse

Added `http.Agent` with `keepAlive` for health check connections.

#### ✅ Download uses `http.get` with manual fd write

Replaced with `fetch` + `ReadableStream` + `fs.createWriteStream` — simpler code,
built-in backpressure handling.

---

## Next Priorities

### P0 — Critical

#### Streaming playback

Currently downloads the full WAV then plays via `afplay`. Streaming TTS output
directly to `afplay` via pipe would cut per-call latency from ~200ms to ~30ms
and reduce memory pressure for long utterances.

**Approach:** Pipe the HTTP response body directly to `afplay`'s stdin instead of
writing to a temp file. Requires daemon-side streaming support (already streaming
chunks) and pipe-compatible audio format.

---

### P1 — High value

#### Port fallback

If port 7125 is in use, try 7126–7130 before falling back to a random port. Currently
the daemon fails silently if the port is taken.

#### Volume and rate controls

Add optional `volume` and `rate` parameters to the speak tool. `afplay` supports
`--volume N` and `--rate N`. Map to config file defaults.

---

### P2 — Medium value

#### macOS speech controller integration

Optionally use `NSSpeechSynthesizer` via Swift script as a fallback when the
Python daemon isn't available. macOS has decent built-in TTS.

#### `--speak-only` mode

A flag that suppresses text output and only speaks. Useful for hands-free
interaction where the user doesn't want to read.

---

### P3 — Polish

#### `speakText()` retry logic

If the daemon returns a non-200 response or the download fails, retry once after
a 1s delay. Currently fails immediately.

#### Progress callback for long audio

For utterances longer than ~30s, emit an intermediate "speaking" status so the
model doesn't stall waiting for playback to finish.

---

## Inspiration Credit

| Feature | Inspired by | Lesson |
|---------|-------------|--------|
| Error propagation | pi-talk, pi-tts-explainer | Wire failures to the model instead of optimistic results. |
| Config file | pi-talk | Even a simple config file beats hardcoded defaults. |
| Stop controls | pi-tts-explainer | Users need a way to interrupt audio. Esc is universal. |
| Text sanitization | pi-tts-explainer | Code-side safety net in case the agent passes raw markdown. |
| Playback controller | pi-talk | Separating concerns makes testing possible. |
| Operations interfaces | pi-talk | Injectable externals enable unit tests without mocks. |
