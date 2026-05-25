# Changelog

## [2.0.3] — 2026-05-25

### Changed

- **Packaged as self-contained Pi package.** The extension no longer depends on the Speak-Turbo repo being cloned at `~/ai/Speak-Turbo`. The daemon script is bundled inside the package at `daemon/daemon_streaming.py`, and the Python environment lives in the package's own `.venv`.

- **Runtime path resolution.** Replaced hardcoded `~/ai/Speak-Turbo` paths with `__dirname`/`import.meta.url` — resolves relative to the extension's install location, works regardless of where Pi installs the package.

- **`package.json` now a Pi manifest.** Added `pi.extensions` key pointing to `./extensions`. The extension is auto-discovered by `pi install`.

- **Install script.** `scripts/install.sh` creates `.venv`, installs pocket-tts/fastapi/uvicorn, and pre-downloads model weights so the first speak call is ~90ms instead of 2-5s.

- **Configurable port.** `SPEAKTURBO_PORT` env var lets users change port 7125 if there's a conflict.

### Added

- `daemon/requirements.txt` — Python dependency manifest
- `scripts/install.sh` — One-step Python environment setup

### Fixed

- **Python version detection in install script.** pocket-tts requires Python >= 3.10. The original script defaulted to `python3` which is 3.9.6 on macOS. Now checks for python3.13/3.12/3.11/3.10 first, falls back with version validation.

### Removed

- **`tts_server.py`** — No longer needed. The daemon is now `daemon/daemon_streaming.py` bundled in the package.

### Removed

- **`tts_server.py`** — No longer needed. The daemon is now `daemon/daemon_streaming.py` bundled in the package.

## [2.0.2] — 2026-05-25

### Changed

- **Removed misleading "truncated to ~200 characters" claim.** The speakturbo daemon accepts arbitrary-length text and streams it in full. The tool parameter description now says "Keep spoken portions concise — detailed data goes in your text response" which is accurate and doesn't discourage substantive speech.

- **Softened "speak exactly once" to "speak at most once".** The old rule forced the agent to either speak everything or speak nothing. The new rule allows: speak the narrative headline, then provide complementary detail in text. Enables the natural summary + detail pattern.

- **Relaxed "do not repeat" to "do not echo verbatim; complementary text is fine".** The old rule prevented any follow-up text after speaking. The new rule permits code blocks, tables, additional detail — only verbatim duplication of the spoken words is forbidden.

## [2.0.1] — 2026-05-25

### Fixed

- **Tool result no longer echoes spoken text.** Previously `execute()` returned `{ content: [{ type: "text", text }] }` where `text` was the spoken text verbatim. The agent saw this in the tool result and repeated it in its written response. Now returns `"✓ spoken"` — a minimal marker with no content to echo.

- **Health check before every speak call.** The daemon was started and checked once on extension load, but could die before the agent actually calls `speak`. Now `speakText()` calls `ensureDaemonRunning()` before every request, restarting the daemon if needed.

- **Curl retry added.** `curl --retry 3 --retry-delay 1` handles transient connection failures instead of failing immediately.

- **Removed invalid `timeout` option from `spawn()`.** Node.js `spawn` doesn't support a `timeout` option (only `exec`/`execSync` do). The option was silently ignored.

## [2.0.0] — 2026-05-25

### Changed (Breaking)

- **Backend switched from Kokoro/mlx-audio to speakturbo (pocket-tts).** The TTS engine is now the speakturbo daemon (`daemon_streaming.py`) using the pocket-tts model (~100MB, ~90ms latency). The old Kokoro-82M model (~2GB, ~1-2s latency) is no longer used.
- **Communication via HTTP instead of stdio.** The extension talks to the daemon via `GET /tts` and checks health via `GET /health`. No more stdin/stdout JSON protocol.
- **`speakCount` enforcement removed.** No longer needed — speakturbo plays audio synchronously (`afplay` blocks until done).
- **Voice mapping added.** Kokoro voice names (`af_heart`, `am_adam`, etc.) are automatically mapped to speakturbo voices (`alba`, `marius`, etc.).

### Added

- **Daemon health checking.** `ensureDaemonRunning()` checks `GET /health` before speaking, restarts the daemon if gone.
- **Model auto-shutdown.** The speakturbo daemon shuts down after 1 hour idle, freeing ~100MB of memory.
- **Streaming audio.** The daemon streams the WAV response — playback starts before generation finishes (~90ms to first sound).

### Removed

- **Kokoro model dependency.** No more `mlx-audio`, Kokoro-82M model weights, or `audio_env` venv.
- **stdin/stdout JSON protocol.** Removed `pendingTts` queue, `ttsReady` flag, stdio parsing.
- **Temp file race condition.** Old architecture used `Popen` (fire-and-forget) for `afplay`, causing mute on rapid calls. New architecture uses synchronous `execSync`.

## [1.6.0] — 2026-05-24

### Added

- **Persistent TTS server (`tts_server.py`).** A long-running Python backend that loads the Kokoro model once at startup.
- **Automatic cleanup of temp WAV files.**
- **One-spoken-audio-per-turn enforcement.** A `speakCount` counter resets at each `before_agent_start`.
- **`unload` handler.** The TTS server process is killed when the extension is unloaded.
- **`(spoken via audio)` removed from tool result.**

### Changed

- **Tool fires TTS in background.** The execute function no longer awaits `speakText`.
- **System prompt guidelines hardened.**
- **Cleanup on startup.** `startTtsServer()` kills lingering `tts_server.py` processes.

## [1.5.0] — 2026-05-24

### Changed

- **Removed success message from tool result.** The speak tool no longer returns `"Speech generated and played successfully."` — instead it returns the spoken text itself.

## [1.4.0] — 2026-05-23

### Added

- **`session_start` reactivation.** Ensures the speak tool survives `/new`, `/resume`, `/fork`.

### Changed

- **Tool definition extracted to variable.**

## [1.3.0] — 2026-05-23

### Removed

- **Auto-speak feature and `/voice` command.**

### Added

- **`before_agent_start` system prompt injection.**

## [1.2.0] — 2025-05-23

### Added

- **Markdown and emoji stripping for natural speech.**
- **Clean tool responses.**
- **Spoken-language guideline.**

### Changed

- **`prepareText` overhauled.**

## [1.1.0] — 2025-01-27

### Changed

- **Switched from `exec` to `spawn` for TTS invocation.**

### Fixed

- **Text with spaces broke TTS.**
- **Shell metacharacter safety.**

## [1.0.0] — Initial Release

### Added

- `speak` tool registration for text-to-speech via `mlx_audio.tts.generate`
- Auto-speak hook for assistant responses (toggled via `/voice`)
- `/voice` command to toggle auto-speak mode
- Support for multiple voices (`af_heart`, `af_bella`, `af_nicole`, `af_sarah`, `af_en`, `am_adam`, `am_winston`)
