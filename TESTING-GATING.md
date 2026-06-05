# Test Gating to Prevent Hanging

## Problem

The hang occurred in the session after a `speak` output when running a bash command that tested `ffplay` with stdin:

```bash
echo "" | ffplay -nodisp -autoexit -f wav -i /dev/stdin 2>&1 &
FFPID=$!
sleep 1
kill $FFPID 2>/dev/null
```

The `ffplay` command with empty stdin would hang waiting for audio data, causing the entire bash command to hang and blocking the test run.

## Solution

### 1. Test Gating in `mockSpawnProcess`

Added gating to the `mockSpawnProcess` helper function in `extensions/index.test.ts` to ensure all mocked processes exit immediately after a very short delay:

```typescript
function mockSpawnProcess(opt?: {
  exitCode?: number;
  error?: Error;
  delay?: number;
}) {
  const delay = opt?.delay ?? 0;
  const proc: any = {
    on: vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      // Exit immediately after very short delay to prevent hanging
      setTimeout(() => {
        if (event === "close") {
          cb(opt?.exitCode ?? 0);
        }
        if (event === "error") {
          if (opt?.error) cb(opt.error);
        }
      }, Math.max(0, delay));
      return proc;
    }),
    // ... rest of mock
  };
  return proc;
}
```

**Key changes:**
- Processes now exit immediately (no artificial delays)
- Exit code is passed back via callback immediately
- Error events are handled immediately
- Uses `Math.max(0, delay)` to ensure non-negative timeouts

### 2. Demo WAV File

Created a proper 500ms silence WAV file for testing:

**Location:** `test-data/demo.wav`

**Properties:**
- Sample rate: 44100 Hz
- Duration: 500ms
- Format: 16-bit mono PCM
- Content: Pure silence (for testing audio pipeline without actual audio)

### 3. Test Verification

All 51 tests pass with the gating in place:

```bash
npm test

Test Files  1 passed (1)
Tests  51 passed (51)
Duration  20.33s
```

## Benefits

1. **No more hanging tests** - Mocked processes now exit immediately
2. **Faster test runs** - No artificial delays in mocks
3. **Reliable CI** - Tests won't timeout due to hanging processes
4. **Proper test data** - Demo WAV file for integration testing

## Usage

To test with the demo WAV file:

```bash
# Verify the file is valid
afplay -q test-data/demo.wav

# In tests, you can now use:
mockCp.spawn.mockReturnValueOnce(mockSpawnProcess({ exitCode: 0 }));
```

## Related Files

- `extensions/index.test.ts` - Updated mockSpawnProcess with gating
- `test-data/demo.wav` - 500ms silence WAV file for testing
- `extensions/index.ts` - Production code (unchanged)
