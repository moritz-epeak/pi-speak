# Similar Projects Analysis — Pi Speech Packages

An in-depth comparison of pi-speak against two other Pi speech extensions, examining architecture,
sophistication, design philosophy, and lessons learned.

---

## 1. pi-tts-explainer — GabrielEspeschit

**Repository:** https://github.com/GabrielEspeschit/pi-tts-explainer

### Architecture

```
agent_end → extractLastAssistantText()
  ├─ short/medium (<500 chars) → speakText() via macOS `say`
  ├─ long (≥2000 chars) → summarizeLongAnswer() via pi-ai
  │   └─ ui.confirm("Start guided explanation?")
  │       ├─ accepted → newSession() → explainer agent
  │       │   └─ tts_explainer_update_notes tool writes answer.md
  │       └─ declined → silent
  └─ empty → skip
```

### Sophistication Level: **Medium-High (6/10)**

| Dimension | Assessment |
|-----------|-----------|
| TTS backend | **Low** — macOS `say` command, no model download, single system voice, no voice selection |
| Auto-speech logic | **High** — three-tier classification (short/medium/long), configurable thresholds |
| Guided sessions | **High** — full sub-session with notes persistence, `/tts-explain-start`/`/tts-explain-done` workflow |
| Config system | **Medium** — single JSON file, global + project merge, validation + normalization |
| Stop controls | **Medium** — Esc/Ctrl+Space via `onTerminalInput`, process group kill |
| Test coverage | **Low** — 4 test files, lightweight contract tests |
| Code organization | **Medium** — 8 files, clear separation (config/tts/text/runs/prompts) |
| Documentation | **Medium** — good README, no architecture doc, no ADRs |

### Key Design Decisions

1. **System `say` over dedicated TTS model** — zero download, zero Python dependency, instant speech. Tradeoff: one voice, no streaming, no latency optimization.
2. **Fire-and-forget playback** — `spawn` + `unref`, no blocking. Tradeoff: overlapping speech possible on rapid calls.
3. **Pi-ai for summarization** — uses `@mariozechner/pi-ai` to generate LLM summaries and naturalize text. Adds token cost but produces better spoken output.
4. **Guided sessions** — creates a new Pi session with an explainer agent, writes markdown notes via a registered tool, returns to parent session. Sophisticated workflow management.
5. **Threshold-based auto-speech** — classifies output length into short/medium/long with configurable character limits.

### What It Does Well

- **Auto-speech with smart defaults** — speaks short answers, summarizes long ones, asks before committing to a guided session
- **Guided explanation workflow** — full lifecycle: create run → explainer session → update notes → return to parent
- **Naturalized speech** — uses LLM to convert markdown/text into conversational spoken prose
- **Configurable behavior** — thresholds, TTS command, medium behavior, naturalize toggle
- **Stop controls** — Esc and Ctrl+Space interrupt speech

### What It Doesn't Do

- Streaming TTS (generates full text then speaks)
- Voice selection (single macOS system voice)
- Synchronous playback (no mute protection)
- Cross-platform (macOS `say` only)
- Health checks or daemon management

---

## 2. pi-talk — Whamp

**Repository:** https://github.com/Whamp/pi-talk

### Architecture

```
registerShortcut(alt+s) → speakPreviousResponse()
  └─ findPreviousAssistantMessage() → extractSpeakableText()
  └─ serverManager.ensureReady()
      ├─ findFreePort()
      └─ spawn("uv tool run supertonic serve ...")
          └─ poll /v1/health (up to 30s)
  └─ synthesizeSpokenResponse(baseUrl, text, config)
      └─ POST /v1/tts → ArrayBuffer
  └─ playbackController.play(audio)
      ├─ writeTempAudio() → temp WAV
      ├─ resolvePlaybackCommand() → afplay/ffplay/mpv/pw-play/paplay/aplay
      └─ spawn(command, [audioPath])
          ├─ interrupt mode: kill active → start new
          └─ queue mode: enqueue → play sequentially

registerCommand("talk") → showTalkOverlay()
  └─ TUI overlay with status, doctor, auto-speech toggle, config
```

### Sophistication Level: **High (8/10)**

| Dimension | Assessment |
|-----------|-----------|
| TTS backend | **High** — Supertonic model via uv-managed Python server, 10 voices, configurable quality/speed |
| Server management | **High** — lazy autostart, free port detection, health polling, process lifecycle, shutdown |
| Playback controller | **High** — interrupt/queue modes, cross-platform command auto-detection |
| TUI overlay | **High** — full interactive overlay with status, doctor, auto-speech toggle, config |
| Config system | **High** — global + project merge, deep merge, validation, env overrides, source tracking |
| Auto-speech mode | **Medium** — toggleable on/off, speaks every assistant response |
| Test coverage | **High** — 10 test files with DI/injection boundaries, TDD-style contract tests |
| Code organization | **High** — 11 source files, clear DI pattern, operations interfaces for testability |
| Documentation | **Very High** — README, CONTEXT.md with domain glossary, 2 ADRs, 2 decision docs with tradeoff analysis |
| Build/CI | **Medium** — TypeScript build to dist, vitest, tsconfig.build.json |

### Key Design Decisions

1. **Supertonic via uv** — production-grade TTS model with 10 voices, quality control, language support. Tradeoff: requires `uv` (setup requirement), ~385MB model cache, ~61s model download.
2. **uv shared tool runtime over package-local venv** — avoids storing ~180MB venv inside Pi's managed package checkout where `git clean -fdx` would delete it. Tradeoff: depends on `uv` being on PATH.
3. **Lazy autostart** — server starts on first speech request, not at Pi startup. Tradeoff: first request has ~1s server readiness latency.
4. **Operations interfaces** — every external dependency (spawn, fetch, mkdir, platform) is injectable via an operations interface. Enables comprehensive unit testing without mocking.
5. **DI-based architecture** — `createPiTalkExtension()` accepts dependency injection options. Makes the extension testable and composable.
6. **Interrupt/queue playback** — configurable overlap behavior. Queue mode prevents mute on rapid calls.
7. **Cross-platform playback detection** — auto-selects from afplay, ffplay, mpv, pw-play, paplay, aplay. Works on macOS and Linux.
8. **JSON config only** — explicitly chose JSON over YAML/TOML to keep the extension dependency-free.

### What It Does Well

- **Production-grade TTS** — Supertonic model with quality control, voice selection, language support
- **Server lifecycle management** — lazy autostart, health polling, port detection, shutdown
- **Playback flexibility** — interrupt/queue modes, cross-platform command detection
- **Testability** — DI pattern with operations interfaces enables thorough testing
- **TUI overlay** — interactive control panel with doctor, status, auto-speech toggle
- **Documentation** — ADRs, decision docs, domain glossary — clearly documents tradeoffs
- **Config UX** — global + project merge with validation, env overrides, source tracking

### What It Doesn't Do

- Streaming TTS (full synthesis then playback)
- Synchronous playback (no mute protection — relies on interrupt mode)
- Auto-speech thresholds (all-or-nothing toggle)
- Guided explanation sessions
- Text naturalization (speaks raw assistant text)
- Health checks before every call (checks once on ensureReady, not per-call)

---

## 3. pi-speak — our package

**Repository:** https://github.com/moritz-epeak/pi-speak

### Architecture

```
registerTool("speak") → speakText(text, voice)
  └─ ensureDaemonRunning()
      ├─ GET /health (2s timeout)
      │   ├─ alive → skip spawn
      │   └─ dead → pkill → spawn daemon → poll /health (30s max)
  └─ http.get /tts?text=...&voice=... → temp.wav
  └─ afplay temp.wav (synchronous — blocks until done)
  └─ rm temp.wav

before_agent_start → inject voice guidelines
session_start → re-register tool
unload → stop daemon
```

### Sophistication Level: **Medium (5/10)**

| Dimension | Assessment |
|-----------|-----------|
| TTS backend | **Medium** — pocket-tts via Python daemon, 8 voices, ~90ms streaming, CPU-only |
| Daemon management | **Medium** — health checks per-call, auto-spawn on crash, idle shutdown, host validation middleware |
| Playback | **Medium** — synchronous (no mute), streaming playback (first audio ~90ms), temp file cleanup |
| Auto-speech | **None** — no auto-speech, manual speak tool calls only |
| Config system | **None** — no config file, hardcoded defaults (port via env var only) |
| Stop controls | **None** — no Esc/Ctrl+Space interrupt |
| Test coverage | **None** — no tests |
| Code organization | **Low** — single index.ts file, no separation of concerns |
| Documentation | **Medium** — README, architecture.md, install-explained.md, dev-roadmap.md |
| Build/CI | **None** — plain TypeScript, no build step |

### Key Design Decisions

1. **pocket-tts for latency** — Kyutai Labs model optimized for Apple Silicon CPU, ~90ms first audio. Tradeoff: CPU-only, no GPU acceleration, macOS only.
2. **Streaming daemon** — model loaded once, kept resident, streams WAV chunks. Tradeoff: ~100MB resident memory, 1hr idle timeout frees it.
3. **Synchronous playback** — `afplay` blocks until done. Tradeoff: no mute on rapid calls, but no non-blocking mode either.
4. **Self-contained install** — single `pi install`, no uv, no system Python dependency beyond the `.venv`. Tradeoff: Python 3.10+ requirement, ~100MB model download.
5. **Health checks per call** — verifies daemon alive before every TTS request, auto-restarts if crashed. Tradeoff: ~2ms overhead per call.
6. **Minimal tool result** — returns `"✓ spoken"` to avoid echo. Tradeoff: no error propagation on failure.

### What It Does Well

- **Latency** — ~90ms first audio, streaming playback, feels instant
- **Mute prevention** — synchronous playback guarantees no overlapping audio
- **Reliability** — health checks per call, auto-restart on crash, idle shutdown
- **Self-contained** — no uv, no system Python pollution, single `pi install`
- **8 voices** — good variety, all built-in
- **Guidelines injection** — comprehensive voice behavior rules injected every turn

### What It Doesn't Do (Opportunities)

- Auto-speech mode
- Config file for defaults
- Stop controls (Esc interrupt)
- Queue/interrupt playback modes
- Cross-platform (macOS only)
- Error propagation to the model
- Test coverage
- TUI overlay
- Text naturalization
- Guided explanation sessions

---

## 4. Comparative Analysis

### Sophistication Matrix

| Capability | pi-tts-explainer | pi-talk | pi-speak |
|---|---|---|---|
| TTS model quality | Low (system `say`) | High (Supertonic) | Medium (pocket-tts) |
| Streaming TTS | — | — | ✅ ~90ms |
| Latency | instant | ~1s (first request) | ~90ms |
| Voice selection | — | ✅ 10 voices | ✅ 8 voices |
| Auto-speech logic | ✅ smart thresholds | ✅ toggleable | — |
| Guided sessions | ✅ full workflow | — | — |
| Text naturalization | ✅ LLM-based | — | — |
| Playback modes | fire-and-forget | interrupt/queue | synchronous |
| Mute protection | — | ✅ interrupt mode | ✅ synchronous |
| Cross-platform | macOS | macOS + Linux | macOS |
| Config system | ✅ global+project | ✅ global+project+env | — |
| Stop controls | ✅ Esc/Ctrl+Space | ✅ keybindings+quiet | — |
| TUI overlay | — | ✅ | — |
| Daemon management | — | ✅ lazy autostart | ✅ per-call health |
| Error propagation | — | — | — (optimistic ✓) |
| Test coverage | 4 tests | 10 tests (DI) | — |
| ADRs/decision docs | — | ✅ 2 ADRs + 2 decisions | — |
| Code organization | 8 files | 11 files (DI) | 1 file |

### Architectural Complexity

```
pi-tts-explainer:  ──○────○────○───  moderate complexity
pi-talk:           ──●──●──●──●──●──  high complexity (DI, ADRs, ops interfaces)
pi-speak:          ──○────○────○───  moderate complexity
```

### Design Philosophy Differences

| Project | Philosophy | Tradeoff |
|---------|-----------|---------|
| pi-tts-explainer | **Smart auto-behavior** — let the agent decide when and how to speak, guided by thresholds and LLM summarization | More token cost, more complex workflow, but better spoken output |
| pi-talk | **Production-quality infrastructure** — proper server management, config system, DI, tests, TUI, cross-platform | Heavy setup (uv, 385MB model), complex architecture, but robust and testable |
| pi-speak | **Minimal and reliable** — self-contained, low latency, synchronous playback, health checks | No config, no auto-speech, no stop controls, no tests, macOS only |

### Research Questions & Answers

**Q1: Why does pi-talk use uv instead of a package-local venv?**
The ADR `0002-use-uv-shared-tool-runtime` documents the reasoning: Pi's git package updates run `git clean -fdx`, which deletes untracked files. A package-local venv (~180MB) would be deleted on every update. Using uv's shared tool/cache storage avoids this. pi-speak's `.venv` faces the same risk — it lives inside the installed package and could be deleted on update.

**Q2: Why does pi-tts-explainer use fire-and-forget instead of synchronous playback?**
It relies on the `stopSpeech()` kill mechanism to handle overlap. When a new speech request comes, it kills the previous process before starting a new one. This works but leaves a window where two processes overlap. pi-speak's synchronous approach is more reliable for rapid calls.

**Q3: Why does pi-speak have no config file while both competitors do?**
pi-speak is the newest and simplest — it trades configurability for zero setup overhead. pi-tts-explainer needs config for thresholds, pi-talk needs it for voices/playback/server settings. Adding a config file to pi-speak would enable voice defaults, port configuration, and playback behavior without code changes.

**Q4: Why does pi-talk have such thorough test coverage while pi-speak has none?**
pi-talk's DI/operations interface pattern makes testing trivial — every external dependency is injectable. pi-speak's `index.ts` directly calls `spawn`, `http.get`, `fs.openSync` — untestable without heavy mocking. The DI pattern is the key enabler.

**Q5: Why does pi-tts-explainer use LLM summarization while others don't?**
pi-tts-explainer's guided session workflow requires a summary for the kickoff prompt. It also uses LLM for text naturalization (converting markdown to spoken prose). pi-speak could benefit from a simpler version: optionally naturalize text before speaking to avoid reading markdown/table syntax aloud.

**Q6: What's the real-world latency tradeoff between these backends?**
- macOS `say` — instant (system call, no model load)
- pocket-tts (pi-speak) — ~90ms first audio (streaming), ~100MB resident model
- Supertonic (pi-talk) — ~1s first request (server startup), ~385MB model cache, non-streaming

For conversational use, ~90ms is effectively instant. The 1s Supertonic startup is noticeable but acceptable if cached.

**Q7: Can pi-speak learn from pi-talk's DI/test pattern?**
Yes. The key insight is the **operations interface** — extract `spawn`, `fetch`, `fs`, `mktemp`, `afplay` into injectable interfaces. This makes the extension testable without mocking globals. pi-speak's `speakText()` and `ensureDaemonRunning()` are the prime candidates.

**Q8: What's the minimum viable set of improvements for pi-speak?**
Based on competitive gaps:
1. Config file (voice default, port, playback behavior)
2. Stop controls (Esc interrupt)
3. Error propagation (return `isError` on failure)
4. Interrupt/queue playback modes

These add the most value with the least complexity.

---

## 5. Key Takeaways for pi-speak

### What pi-speak Should Keep

- **Low latency** (~90ms streaming) — unique among these three, a strong differentiator
- **Synchronous playback** — guarantees no mute, simpler than interrupt/queue management
- **Self-contained install** — no uv dependency, single `pi install`
- **Health checks per call** — more resilient than pi-talk's one-time ensureReady

### What pi-speak Should Borrow

- **Config file** (from pi-talk) — global + project merge for voice, port, playback defaults
- **Stop controls** (from pi-tts-explainer) — Esc to interrupt audio
- **Error propagation** (from both) — return `isError` on failure instead of optimistic `✓ spoken`
- **Operations interface** (from pi-talk) — extract externals for testability
- **Interrupt/queue modes** (from pi-talk) — let users choose overlap behavior
- **Text sanitization** (from pi-tts-explainer) — strip markdown before speaking

### What pi-speak Should Defer

- Auto-speech mode — adds complexity, risks unwanted speech
- Guided explanation sessions — niche feature, significant complexity
- TUI overlay — adds TUI dependency, large surface area
- Cross-platform — Linux playback detection requires testing
- LLM naturalization — adds token cost and latency, defer to config option
