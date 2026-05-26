# Changelog

## [2.0.4] — 2026-05-25

### Fixed

- **Install script detects Python 3.10+ correctly.** macOS system `python3` is 3.9, which pocket-tts doesn't support. The script now tries `python3.13`, `python3.12`, `python3.11`, `python3.10` before falling back to `python3`. Fails with a clear message if no 3.10+ is found.

### Removed

- **Legacy Kokoro voice mapping.** The old `VOICE_MAP` translating `af_heart`, `am_adam`, etc. to speakturbo voices has been removed. Only speakturbo voice names (`alba`, `marius`, etc.) are accepted now. The tool description and agent guidelines no longer reference Kokoro names.

### Added

- **Credits section in README.** Attributes pocket-tts (Kyutai Labs), Speak-Turbo (EmZod), and the pi-coding-agent extension API.

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

### Removed

- **`tts_server.py`** — No longer needed. The daemon is now `daemon/daemon_streaming.py` bundled in the package.

## [2.0.2] — 2026-05-25

### Changed

- **Removed misleading "truncated to ~200 characters" claim.** The tool parameter description now accurately reflects the daemon's capabilities.
- **Softened "speak exactly once" to "speak at most once".** Enables the natural summary + detail pattern.
- **Relaxed "do not repeat" to "do not echo verbatim; complementary text is fine".**

## [2.0.1] — 2026-05-25

### Fixed

- **Tool result no longer echoes spoken text.** Returns `"✓ spoken"` — a minimal marker with no content to echo.
- **Health check before every speak call.** `speakText()` calls `ensureDaemonRunning()` before every request.
- **Curl retry added.** `curl --retry 3 --retry-delay 1` for transient failures.

## [2.0.0] — 2026-05-25

### Changed (Breaking)

- **Backend switched from Kokoro/mlx-audio to speakturbo (pocket-tts).**
- **Communication via HTTP instead of stdio.**
- **`speakCount` enforcement removed.**
- **Voice mapping added.** (Removed in 2.0.4)

### Added

- **Daemon health checking.**
- **Model auto-shutdown** after 1 hour idle.
- **Streaming audio** (~90ms to first sound).

### Removed

- **Kokoro model dependency.**
- **stdin/stdout JSON protocol.**
- **Temp file race condition.**

## [1.6.0] — 2026-05-24

### Added

- Persistent TTS server, temp file cleanup, speakCount enforcement, unload handler.

## [1.5.0] — 2026-05-24

### Changed

- Removed success message from tool result.

## [1.4.0] — 2026-05-23

### Added

- `session_start` reactivation.

## [1.3.0] — 2026-05-23

### Removed

- Auto-speak feature and `/voice` command.

### Added

- `before_agent_start` system prompt injection.

## [1.2.0] — 2025-05-23

### Added

- Markdown and emoji stripping, spoken-language guideline.

## [1.1.0] — 2025-01-27

### Changed

- Switched from `exec` to `spawn`.

## [1.0.0] — Initial Release

- `speak` tool, auto-speak, `/voice` command, Kokoro voices.
