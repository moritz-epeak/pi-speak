# Speak — Development Roadmap

## Current State

### Features (shipped in v2.0.4)
- ~90ms latency — first audio arrives before generation finishes
- Streaming playback — starts playing mid-generation
- Synchronous playback — `afplay` blocks until done; no mute on rapid calls
- Self-contained — single `pi install`, no manual path config
- 8 voices — male and female options
- Auto-shutdown — daemon frees ~100MB after 1hr idle
- Health checks — verifies daemon alive before every speak call, auto-restarts
- CPU only — runs on Apple Silicon CPU, fast enough for ~90ms

### Known Limitations (not yet shipped)
- macOS only (`afplay`) — no Linux `aplay` support
- No voice cloning — custom `.wav` voices not supported
- No emotion tags — no `[laugh]`, `[sigh]` support
- No non-blocking mode — no fire-and-forget playback option
- Single daemon port (7125) — no auto-fallback if port is in use

---

## Polish Items (from May 2026 execSync investigation, commit `2882b50`)

Low-priority refinements to revisit when there's time.

### 1. Optimistic "✓ spoken" result

The `execute()` function fires `speakText()` without `await` and immediately
returns `"✓ spoken"`. If the download or playback fails, the user sees a
success checkmark but hears nothing.

**Fix:** either `await speakText()` before returning (tool shows loading
spinner during audio), or catch the promise rejection and return `isError:
true` with a descriptive message so the model can adapt.

### 2. Sync `mktemp` call

```typescript
const tmpDir = execSync("mktemp -t speakturbo_XXXXX").toString().trim();
```

Still uses `execSync` — fast but synchronous. Replace with
`fs.mkdtempSync()` or `fs.mkdtemp()` for a fully async code path.

### 3. Sync `pkill` + `sleep` in daemon restart

```typescript
execSync("pkill -9 -f daemon_streaming.py", { stdio: "ignore" });
execSync("sleep 1", { stdio: "ignore" });
```

Blocks the event loop for ~1 second during daemon restart (rare — only on
first use or after a crash). Replace with `spawn` or `child_process.exec`
async.

### 4. Daemon health-poll timeout (30s)

`ensureDaemonRunning()` polls for 60 iterations at 500ms intervals (max 30
seconds). If the daemon fails to start, the tool result already returned
`"✓ spoken"` but the user gets silence. Could shorten the timeout or add a
progress callback.

### 5. Temp file cleanup on early abort

If the `signal` (AbortSignal from pi) fires mid-download or mid-playback,
the temp file in `/tmp/` isn't cleaned up. Register an abort handler to
remove it.

### 6. Error propagation to the model

If `speakText()` fails, the model still receives `"✓ spoken"` — it has no
way to know the audio didn't play. Return `isError: true` with a
descriptive message so the model can fall back to text-only output.

### 7. `daemonHealth()` uses raw `http.get` without connection reuse

Creates a new connection every health check. Could reuse via
`http.Agent` with `keepAlive`. Negligible impact — micro-optimization.

### 8. Download uses `http.get` with manual fd write

Streams into a raw file descriptor. Could use `fetch` +
`fs.createWriteStream` for simpler code and built-in retry logic.
