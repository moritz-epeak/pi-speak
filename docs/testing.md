# Testing

> See [README.md](../README.md) for package overview.

## Overview

pi-speak has **41 Vitest tests** with **59 assertions** covering all critical code paths in the Pi extension. The test suite mocks all external dependencies (file system, HTTP, child processes, fetch, OS) so tests run without requiring the Python daemon or any system dependencies.

### Running Tests

```bash
npm test          # Run Vitest test suite
npm run typecheck # TypeScript type checking (tsc --noEmit)
```

### Test Infrastructure

**Framework:** Vitest with Node environment
**Config:** `vitest.config.ts` — discovers `extensions/**/*.test.ts` with 30s timeout

**Mocked dependencies:**
- **`node:fs`** — `readFileSync`, `unlinkSync`, `createWriteStream`, `existsSync`
- **`node:child_process`** — `spawn`, `execSync`
- **`node:http`** — `get`, `Agent`
- **`node:os`** — `homedir` (returns `/Users/testuser`)
- **`fetch`** — global stub for HTTP audio downloads
- **Pi SDK** — `registerTool`, `on`, `getAllTools`, `onTerminalInput`, `registerProvider`, `getActiveTools`, `setActiveTools`, `exec`, `events`
- **ReadableStream** — (see [Writing Mock Helpers](#writing-mock-helpers) for examples)

## Test Exports

The production module exports testing helpers prefixed with `_`:

| Export | Purpose |
|--------|---------|
| `_prepareText(text)` | Text sanitization |
| `_loadConfig()` | Config file loading |
| `_daemonHealth()` | HTTP health check |
| `_ensureDaemonRunning()` | Daemon startup with retry |
| `_stopDaemon()` | Daemon shutdown |
| `_getDaemonReady()` | Daemon ready state flag |
| `_getDaemonProcess()` | Spawned daemon process handle |
| `_getCurrentPlayback()` | Current playback state |
| `_setDaemonReady(val)` | Set daemon ready state |
| `_setDaemonProcess(proc)` | Set daemon process handle |
| `_setCurrentPlayback(val)` | Set current playback state |
| `_getPlaybackController()` | Playback controller instance |
| `_speakText(text, voice, signal?)` | Core speak logic |

## Test Categories

### 1. Text Sanitization (12 tests)

`prepareText()` strips all markdown before sending to TTS. Each test verifies a specific markdown construct is removed while preserving readable text.

| Test | Verifies |
|------|----------|
| Code fences removed | ``` blocks stripped |
| Inline code removed | Backtick-wrapped code stripped |
| Links converted | `[text](url)` → `text` |
| Headings stripped | `# ` through `###### ` removed |
| Bold asterisks stripped | `**text**` → `text` |
| Bold underscores stripped | `__text__` → `text` |
| Italic stripped | `*text*` and `_text_` → `text` |
| Strikethrough stripped | `~~text~~` → `text` |
| List markers removed | `-`, `*`, `+`, numbered lists stripped |
| Table pipes removed | `|` → `` |
| Whitespace normalized | Multiple spaces/crlf → single space |
| Combined input | All constructs tested together |

### 2. Config Loading (3 tests)

`loadConfig()` reads `~/.pi/agent/speak.json` and falls back gracefully.

| Test | Verifies |
|------|----------|
| Valid config | Correctly parses voice, port, playbackMode |
| Missing file | Returns empty config without error |
| Invalid JSON | Returns empty config without error |

### 3. Daemon Health (8 tests)

Covers health checks, startup retry logic, and shutdown.

| Test | Verifies |
|------|----------|
| Health 200 OK | `true` when daemon responds with 200 |
| Health non-200 | `false` for any non-200 status |
| Health network error | `false` on HTTP error event |
| Health timeout | `false` after 2s timeout |
| Startup already healthy | Skips spawn if daemon already up |
| Startup fails | Retries 12×500ms, returns false on failure |
| Shutdown | `pkill` kills process, clears state |
| Daemon exit handler | Sets ready=false when process exits |

### 4. speakText (5 tests)

Core HTTP download → file write → `afplay` flow with error handling.

| Test | Verifies |
|------|----------|
| Daemon unavailable | Returns false if daemon fails to start |
| Abort before download | Cleans up temp file when signal aborted |
| Empty response body | Throws error, cleanup triggered |
| Cleanup on error | Temp file removed on any failure |
| Cleanup on daemon error | Non-200 response triggers cleanup |

### 5. Playback Modes (5 tests)

`PlaybackController` supports four modes.

| Test | Verifies |
|------|----------|
| Synchronous | Default mode, blocks until afplay done |
| Interrupt | Kills current playback, starts new one |
| Queue | Chains plays sequentially |
| Fire-and-forget | Non-blocking, returns true immediately |
| Queue drain race | Items pushed during drain are still consumed |

### 6. Extension Registration (8 tests)

Covers Pi SDK integration, Esc handler, and guideline injection.

| Test | Verifies |
|------|----------|
| Tool registration | `registerTool` called with correct API |
| Esc handler | `onTerminalInput` registered on session_start |
| Esc stops playback | Kills afplay, removes temp file, clears state |
| Non-Esc passthrough | Other keypresses return undefined |
| Tool re-register | Re-registers if not in `getAllTools()` |
| No re-register | Skips if already present |
| Voice guidelines | `before_agent_start` injects into system prompt |
| Session shutdown | Calls `stopDaemon()` on `session_shutdown` |

## Adding New Tests

1. Write tests in `extensions/index.test.ts` using Vitest patterns
2. If your test needs an internal function, add an `export function _name()` wrapper in `index.ts`
3. Run `npm test` to verify
4. Run `npm run typecheck` to ensure no type regressions

## Writing Mock Helpers

Common patterns used by the test suite:

**ReadableStream mock (simplified for clarity):**
```ts
function mockReadableStream(chunks: Uint8Array[]) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
```

**Spawn process mock (simplified for clarity):**
```ts
function mockSpawnProcess({ exitCode = 0 }) {
  const proc = {
    on: vi.fn((event, cb) => {
      if (event === "close") setImmediate(() => cb(exitCode));
    }),
    kill: vi.fn(),
  };
  return proc;
}
```

**HTTP get mock (health check):**
```ts
mockHttp.get.mockImplementation((_url, _opts, cb) => {
  const req = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
  setImmediate(() => cb({ statusCode: 200 }));
  return req;
});
```
