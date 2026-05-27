# Speak — Development Roadmap

## Honest Assessment

Pi-speak is a focused, minimal package — a single `index.ts` with direct syscalls, no
testability layer, no config system, and no error propagation. It gets the job done:
~90ms latency, no mute on rapid calls, self-contained install.

The other Pi speech extensions (pi-tts-explainer, pi-talk) are built with more
engineering infrastructure: dependency injection, operations interfaces, comprehensive
tests, ADRs with tradeoff analysis. They solve different problems at a different scale.

This roadmap is not about copying them. It's about learning what they do well and
applying those lessons where they genuinely improve pi-speak without sacrificing its
core philosophy: **minimal, self-contained, low latency, reliable.**

---

## Current State

### What pi-speak does well (keep these)

- **~90ms latency** — first audio arrives before generation finishes. Unique among
  competitors. Streaming TTS is a real differentiator.
- **Synchronous playback** — `afplay` blocks until done. No mute on rapid calls.
  Simpler and more reliable than pi-talk's interrupt/queue management.
- **Self-contained** — single `pi install`, no `uv` dependency, no system Python
  pollution beyond `.venv`. Competitors require `uv` or system `say`.
- **Health checks per call** — verifies daemon alive before every TTS request,
  auto-restarts on crash. More resilient than pi-talk's one-time `ensureReady`.
- **8 built-in voices** — good variety, no config needed.
- **Guidelines injection** — comprehensive voice behavior rules injected every turn.

### What pi-speak is missing (learn from competitors)

- **No error propagation** — optimistic `✓ spoken` means silence on failure. Both
  competitors handle errors gracefully.
- **No config file** — voice defaults, port, and behavior are hardcoded. Both
  competitors have config systems.
- **No stop controls** — no way to interrupt audio mid-speech. pi-tts-explainer has
  Esc/Ctrl+Space, pi-talk has `/quiet` and keybindings.
- **No testability** — direct syscalls in a single file make testing impossible.
  pi-talk's DI/operations interface pattern enables thorough testing.
- **No playback modes** — synchronous only. pi-talk offers interrupt/queue.
- **No text sanitization** — markdown, tables, and code are spoken as-is.
  pi-tts-explainer strips formatting before speaking.

---

## Priority Roadmap

Items are ordered by impact vs. complexity. High impact, low complexity first.

### P0 — Critical (fix real bugs)

#### Error propagation

The `execute()` function fires `speakText()` without `await` and immediately returns
`"✓ spoken"`. If the download or playback fails, the user sees a success checkmark but
hears nothing. The model has no way to know the audio didn't play.

**Fix:** catch the promise rejection and return `isError: true` with a descriptive
message so the model can fall back to text-only output. No architectural change needed
— just wire the promise chain into the tool result.

**Inspiration:** both competitors handle errors. pi-talk returns synthesis errors
as thrown exceptions. pi-tts-explainer returns `false` from `speakText()`.

#### Temp file cleanup on early abort

If the `signal` (AbortSignal from pi) fires mid-download or mid-playback, the temp file
in `/tmp/` isn't cleaned up. Register an abort handler to remove it.

---

### P1 — High value (address real gaps)

#### Config file for voice defaults

Add a JSON config file so users can set default voice, port, and playback behavior
without editing source code. Keep it simple — no deep merge, no validation pipeline.
A single file at `~/.pi/agent/speak.json` that overrides hardcoded defaults.

**Inspiration:** pi-talk's config system is sophisticated (global + project merge,
deep merge, validation, source tracking). We don't need all of that — just a single
config file that overrides `DEFAULT_VOICE`, `DAEMON_PORT`, and maybe playback mode.

**Scope:**
- Read `~/.pi/agent/speak.json` at startup
- Merge with hardcoded defaults (simple shallow merge)
- Supported keys: `voice`, `port`, `playbackMode`
- No validation pipeline, no source tracking

#### Stop controls — Esc to cut audio

Register a terminal input listener that stops playback on Esc. Currently there's no
way to interrupt audio mid-speech.

**Inspiration:** pi-tts-explainer registers `onTerminalInput` to detect Esc (`\u001b`)
and Ctrl+Space (NUL `\u0000`). It kills the child process and cleans temp files.
pi-talk uses keybindings (`alt+q`) and a `/quiet` command.

**Scope:**
- `pi.on("session_start")` registers `ctx.ui.onTerminalInput` for Esc
- `speakText()` stores the child process reference
- On Esc: kill `afplay`, remove temp file, clear state
- Keep it simple — no Ctrl+Space, no process group kill, just `child.kill()`

#### Text sanitization before speaking

Strip markdown formatting, code blocks, and table syntax before sending text to the
TTS daemon. Currently the raw assistant text is spoken as-is, which means markdown
syntax and code are read aloud.

**Inspiration:** pi-tts-explainer's `sanitizeForSpeech()` drops fenced code blocks,
replaces inline code markers, collapses markdown heading/list/table punctuation, and
truncates to `maxSpeechChars`.

**Scope:**
- Add a `prepareText()` function in `index.ts` (or a separate module)
- Strip markdown: code fences, inline code, links, headings, list markers, tables
- Normalize whitespace and truncate to a configurable max length
- Keep it simple — regex-based, no LLM naturalization

---

### P2 — Medium value (power-user features)

#### Playback modes — interrupt and queue

Let users choose between:
- **Synchronous** (default, current behavior) — `afplay` blocks until done. No mute.
- **Interrupt** — new speak call kills current audio and starts fresh.
- **Queue** — multiple speak calls queue up and play in sequence.
- **Fire-and-forget** — non-blocking, allows overlap (risks mute).

**Inspiration:** pi-talk's `playback-controller.ts` manages active process and queue
with configurable `onOverlap: "interrupt" | "queue"`. Its DI pattern makes the
controller testable.

**Scope:**
- Extract playback into a `PlaybackController` class
- Each mode maps to a strategy: synchronous (execSync), interrupt (spawn + kill),
  queue (spawn + chain), fire-and-forget (spawn + unref)
- Configurable via the config file (P1)
- Default remains synchronous — that's pi-speak's strength

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

### P4 — Deferred (not a fit for pi-speak)

These features add complexity without clear benefit for pi-speak's philosophy:

#### Auto-speech mode
Both competitors have this. pi-speak deliberately doesn't — speech should be
intentional, not automatic. The agent decides when to speak via the `speak` tool.

#### Guided explanation sessions
pi-tts-explainer's signature feature. Niche workflow that adds significant complexity
(new sessions, notes, return-to-parent). Not a fit for a minimal TTS tool.

#### TUI overlay
pi-talk's control panel adds TUI dependency and a large surface area. pi-speak
doesn't need a UI — it has one tool and one job.

#### Cross-platform playback detection
pi-talk auto-detects `afplay`, `ffplay`, `mpv`, `pw-play`, `paplay`, `aplay`. Useful
for Linux support but adds complexity. Defer until Linux is a target.

#### LLM text naturalization
pi-tts-explainer uses pi-ai to convert markdown into spoken prose. Adds token cost
and latency. The simpler regex-based sanitization (P1) covers most cases.

---

## Inspiration Credit

| Feature | Inspired by | Lesson |
|---------|-------------|--------|
| Error propagation | Both competitors | Optimistic results are fragile. Wire failures to the model. |
| Config file | pi-talk | Even a simple config file beats hardcoded defaults. |
| Stop controls | pi-tts-explainer | Users need a way to interrupt audio. Esc is universal. |
| Text sanitization | pi-tts-explainer | Raw markdown sounds terrible when spoken. Strip it. |
| Playback controller | pi-talk | Separating concerns makes testing possible. |
| Operations interfaces | pi-talk | Injectable externals enable unit tests without mocks. |

We are not copying these projects. We are learning from what they do well and applying
those lessons where they genuinely improve pi-speak without adding unnecessary
complexity.
