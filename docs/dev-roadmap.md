# Speak — Development Roadmap

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

### What pi-speak is missing

- **No error propagation** — optimistic `✓ spoken` means silence on failure.
- **No config file** — voice defaults, port, and behavior are hardcoded.
- **No stop controls** — no way to interrupt audio mid-speech.
- **No testability** — direct syscalls in a single file make testing impossible.
- **No playback modes** — synchronous only.

---

## Priority Roadmap

Items are ordered by impact vs. complexity. High impact, low complexity first.

### P0 — Critical (fix real bugs)

#### Error propagation

The `execute()` function fires `speakText()` without `await` and immediately returns
`"✓ spoken"`. If the download or playback fails, the user sees a success checkmark but
hears nothing. The model has no way to know the audio didn't play.

**Fix:** catch the promise rejection and return `isError: true` with a descriptive
message so the model can fall back to text-only output.

#### Temp file cleanup on early abort

If the `signal` (AbortSignal from pi) fires mid-download or mid-playback, the temp file
in `/tmp/` isn't cleaned up. Register an abort handler to remove it.

---

### P1 — High value (address real gaps)

#### Config file for voice defaults

Add a JSON config file so users can set default voice, port, and playback behavior
without editing source code. Keep it simple — a single file at `~/.pi/agent/speak.json`
that overrides hardcoded defaults.

**Scope:**
- Read `~/.pi/agent/speak.json` at startup
- Merge with hardcoded defaults (simple shallow merge)
- Supported keys: `voice`, `port`, `playbackMode`
- No validation pipeline, no source tracking

#### Stop controls — Esc to cut audio

Register a terminal input listener that stops playback on Esc. Currently there's no
way to interrupt audio mid-speech.

**Scope:**
- `pi.on("session_start")` registers `ctx.ui.onTerminalInput` for Esc
- `speakText()` stores the child process reference
- On Esc: kill `afplay`, remove temp file, clear state
- Keep it simple — no Ctrl+Space, no process group kill, just `child.kill()`

#### Text sanitization as safety net

Add a `prepareText()` function that strips markdown formatting before sending text
 to the TTS daemon. The agent guidelines already tell the model to speak naturally,
 but a code-side sanitizer catches cases where the agent passes raw markdown.

**Scope:**
- Add a `prepareText()` function in `index.ts`
- Strip: code fences, inline code, links, headings, list markers, tables
- Normalize whitespace and truncate to configurable max length
- Regex-based, no LLM naturalization

---

### P2 — Medium value (power-user features)

#### Playback modes — interrupt and queue

Let users choose between:
- **Synchronous** (default, current behavior) — `afplay` blocks until done. No mute.
- **Interrupt** — new speak call kills current audio and starts fresh.
- **Queue** — multiple speak calls queue up and play in sequence.
- **Fire-and-forget** — non-blocking, allows overlap (risks mute).

**Scope:**
- Extract playback into a `PlaybackController` class
- Each mode maps to a strategy: synchronous (execSync), interrupt (spawn + kill),
  queue (spawn + chain), fire-and-forget (spawn + unref)
- Configurable via the config file (P1)
- Default remains synchronous

---

### P3 — Polish items

#### Sync `pkill` + `sleep` in daemon restart

Replace the synchronous `pkill` + `sleep` with async `spawn` or `child_process.exec`.
Blocks ~1s during daemon restart (rare — first use or after crash).

#### Daemon health-poll timeout (30s)

`ensureDaemonRunning()` polls at 500ms intervals for up to 30s. Daemon typically
starts in ~3s. Shorten timeout or add a progress callback.

#### `daemonHealth()` connection reuse

Each health check creates a new HTTP connection. Add `http.Agent` with `keepAlive`.
Micro-optimization — negligible real-world impact.

#### Download uses `http.get` with manual fd write

Replace with `fetch` + `fs.createWriteStream` for simpler code and built-in retry
logic. Current implementation works fine.

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
