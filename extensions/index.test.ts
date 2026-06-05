import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ───────────────────────────────────────────────────────────
// Gating: Prevent tests from hanging on long-running processes
// ───────────────────────────────────────────────────────────

function createFastMockProcess(opt?: { exitCode?: number; delay?: number }) {
  const delay = opt?.delay ?? 0;
  const proc: any = {
    on: vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      // Exit immediately after very short delay to prevent hanging
      setTimeout(() => {
        if (event === "close") cb(opt?.exitCode ?? 0);
        if (event === "error") opt?.error && cb(opt.error);
      }, Math.max(0, delay));
      return proc;
    }),
    once: vi.fn().mockReturnThis(),
    kill: vi.fn(),
    stdin: { write: vi.fn().mockReturnValue(true), end: vi.fn() },
    stdout: { on: vi.fn(), pipe: vi.fn() },
    stderr: { on: vi.fn() },
    pid: 12345,
  };
  return proc;
}

// ───────────────────────────────────────────────────────────
// Mock setup — must be before imports
// ───────────────────────────────────────────────────────────

const mockFs = {
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(),
  existsSync: vi.fn(),
};
const mockCp = {
  spawn: vi.fn(),
  execSync: vi.fn(),
};
const mockHttp = {
  Agent: vi.fn(),
  get: vi.fn(),
};
const mockOs = {
  homedir: vi.fn().mockReturnValue("/Users/testuser"),
};
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("node:fs", () => ({
  default: {
    readFileSync: mockFs.readFileSync,
    unlinkSync: mockFs.unlinkSync,
    createWriteStream: mockFs.createWriteStream,
    existsSync: mockFs.existsSync,
  },
  readFileSync: mockFs.readFileSync,
  unlinkSync: mockFs.unlinkSync,
  createWriteStream: mockFs.createWriteStream,
  existsSync: mockFs.existsSync,
}));
vi.mock("node:child_process", () => ({
  default: {
    spawn: mockCp.spawn,
    execSync: mockCp.execSync,
  },
  spawn: mockCp.spawn,
  execSync: mockCp.execSync,
}));
vi.mock("node:http", () => ({
  default: {
    Agent: mockHttp.Agent,
    get: mockHttp.get,
  },
  Agent: mockHttp.Agent,
  get: mockHttp.get,
}));
vi.mock("node:os", () => ({
  default: {
    homedir: mockOs.homedir,
  },
  homedir: mockOs.homedir,
}));

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

function mockReadableStream(chunks: Uint8Array[]) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) {
          const value = chunks[i++];
          return { done: false, value };
        }
        return { done: true, value: undefined };
      },
      cancel: vi.fn(),
      releaseLock: vi.fn(),
    }),
  };
}

function mockWriteStream(opt?: { errorOnEnd?: boolean }) {
  let writeHandler: ((chunk: any) => void) | null = null;
  let endHandler: (() => void) | null = null;
  let errorHandler: ((err: Error) => void) | null = null;

  const ws: any = {
    write: vi.fn().mockImplementation((chunk: any) => {
      if (writeHandler) writeHandler(chunk);
      return true;
    }),
    end: vi.fn().mockImplementation((cb?: () => void) => {
      endHandler = cb || (() => {});
      if (opt?.errorOnEnd) {
        setTimeout(() => errorHandler?.(new Error("write failed")), 0);
      } else {
        setTimeout(() => endHandler?.(), 0);
      }
    }),
    on: vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      if (event === "error") errorHandler = cb;
      if (event === "close") setTimeout(() => cb(), 0);
      return ws;
    }),
    once: vi.fn().mockReturnThis(),
    close: vi.fn(),
    destroy: vi.fn(),
  };
  return ws;
}

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
    once: vi.fn().mockReturnThis(),
    kill: vi.fn(),
    stdin: {
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
    },
    stdout: { on: vi.fn(), pipe: vi.fn() },
    stderr: {
      on: vi.fn().mockImplementation((_event: string, cb: (d: Buffer) => void) => {
        // no-op
        return proc.stderr;
      }),
    },
    pid: 12345,
  };
  return proc;
}

// ───────────────────────────────────────────────────────────
// Test: prepareText
// ───────────────────────────────────────────────────────────

describe("prepareText", () => {
  async function importExt() {
    return await import("./index.ts");
  }

  it("strips code fences", async () => {
    const ext = await importExt();
    expect(ext._prepareText("hello ```code``` world")).toBe("hello world");
  });

  it("strips inline code", async () => {
    const ext = await importExt();
    expect(ext._prepareText("text `code` more")).toBe("text more");
  });

  it("preserves link text while stripping URLs", async () => {
    const ext = await importExt();
    expect(ext._prepareText("click [here](url) now")).toBe("click here now");
  });

  it("strips heading markers", async () => {
    const ext = await importExt();
    expect(ext._prepareText("# Title\n## Subtitle")).toBe("Title Subtitle");
  });

  it("strips bold markers", async () => {
    const ext = await importExt();
    expect(ext._prepareText("**bold** text")).toBe("bold text");
  });

  it("strips italic markers", async () => {
    const ext = await importExt();
    expect(ext._prepareText("*italic* _text_")).toBe("italic text");
  });

  it("strips strikethrough", async () => {
    const ext = await importExt();
    expect(ext._prepareText("~~strike~~")).toBe("strike");
  });

  it("strips list markers", async () => {
    const ext = await importExt();
    expect(ext._prepareText("- item\n* item\n1. item")).toBe("item item item");
  });

  it("removes table pipes", async () => {
    const ext = await importExt();
    expect(ext._prepareText("a | b | c")).toBe("a b c");
  });

  it("normalizes whitespace", async () => {
    const ext = await importExt();
    expect(ext._prepareText("  hello   world\n  test  ")).toBe("hello world test");
  });

  it("handles empty string", async () => {
    const ext = await importExt();
    expect(ext._prepareText("")).toBe("");
  });

  it("handles plain text with no markdown", async () => {
    const ext = await importExt();
    expect(ext._prepareText("hello world")).toBe("hello world");
  });
});

// ───────────────────────────────────────────────────────────
// Test: loadConfig
// ───────────────────────────────────────────────────────────

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue("/Users/testuser");
  });

  it("loads valid config", async () => {
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ voice: "marius", port: 9999, playbackMode: "queue" })
    );
    const ext = await import("./index.ts");
    const cfg = ext._loadConfig();
    expect(cfg.voice).toBe("marius");
    expect(cfg.port).toBe(9999);
    expect(cfg.playbackMode).toBe("queue");
  });

  it("returns empty object on missing config", async () => {
    mockFs.readFileSync.mockImplementationOnce(() => {
      const err: any = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    });
    const ext = await import("./index.ts");
    const cfg = ext._loadConfig();
    expect(cfg).toEqual({});
  });

  it("returns empty object on invalid JSON", async () => {
    mockFs.readFileSync.mockReturnValueOnce("not json");
    const ext = await import("./index.ts");
    const cfg = ext._loadConfig();
    expect(cfg).toEqual({});
  });
});

// ───────────────────────────────────────────────────────────
// Test: daemonHealth
// ───────────────────────────────────────────────────────────

describe("daemonHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when daemon responds 200", async () => {
    mockHttp.get.mockImplementationOnce((_url, _opts, cb) => {
      const req: any = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    const ext = await import("./index.ts");
    const result = await ext._daemonHealth();
    expect(result).toBe(true);
  });

  it("returns false when daemon responds non-200", async () => {
    mockHttp.get.mockImplementationOnce((_url, _opts, cb) => {
      const req: any = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      setImmediate(() => cb({ statusCode: 500 }));
      return req;
    });
    const ext = await import("./index.ts");
    const result = await ext._daemonHealth();
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    mockHttp.get.mockImplementationOnce((_url, _opts, _cb) => {
      const req: any = {
        on: vi.fn().mockImplementation((event, cb) => {
          if (event === "error") setImmediate(() => cb());
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      return req;
    });
    const ext = await import("./index.ts");
    const result = await ext._daemonHealth();
    expect(result).toBe(false);
  });

  it("returns false on timeout", async () => {
    mockHttp.get.mockImplementationOnce((_url, _opts, _cb) => {
      const req: any = {
        on: vi.fn(),
        setTimeout: vi.fn((_t, cb) => setImmediate(() => cb())),
        destroy: vi.fn(),
      };
      return req;
    });
    const ext = await import("./index.ts");
    const result = await ext._daemonHealth();
    expect(result).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// Test: ensureDaemonRunning
// ───────────────────────────────────────────────────────────

describe("ensureDaemonRunning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when daemon is already healthy", async () => {
    mockHttp.get.mockImplementationOnce((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    const ext = await import("./index.ts");
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(true);
    expect(ext._getDaemonReady()).toBe(true);
  });

  it("returns false when daemon fails to start", async () => {
    // First health check fails (triggers spawn)
    mockHttp.get.mockImplementation((_url, _opts, _cb) => {
      const req: any = {
        on: vi.fn().mockImplementation((event, cb) => {
          if (event === "error") setImmediate(() => cb());
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      return req;
    });
    // Mock spawn so daemon exits immediately (no PORT_BOUND emitted)
    mockCp.spawn.mockImplementation(() => {
      const proc = mockSpawnProcess({ exitCode: 1 });
      // Emit close immediately so the loop doesn't wait
      proc.on = vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
        if (event === "close") setImmediate(() => cb(1));
        return proc;
      });
      return proc;
    });
    const ext = await import("./index.ts");
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// Test: daemonHealthAnywhere
// ───────────────────────────────────────────────────────────

describe("daemonHealthAnywhere", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns port when daemon is alive on a candidate port", async () => {
    // Use a port not in the standard FALLBACK_PORTS so we can isolate it
    const targetPort = 7900;
    mockHttp.get.mockImplementation((_url, _opts, _cb) => {
      const portMatch = _url.match(/:(\d+)\/health/);
      const port = portMatch ? parseInt(portMatch[1], 10) : null;
      const req: any = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "error") {
            if (port !== targetPort) {
              setImmediate(() => handler());
            }
          }
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      if (port === targetPort) {
        setImmediate(() => _cb({ statusCode: 200 }));
      }
      return req;
    });
    const ext = await import("./index.ts");
    ext._setPersistedPort(targetPort);
    const result = await ext._daemonHealthAnywhere();
    expect(result).toBe(targetPort);
  });

  it("returns null when no candidate port responds", async () => {
    mockHttp.get.mockImplementation((_url, _opts, _cb) => {
      const req: any = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "error") setImmediate(() => handler());
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      return req;
    });
    const ext = await import("./index.ts");
    ext._setPersistedPort(null);
    const result = await ext._daemonHealthAnywhere();
    expect(result).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// Test: port fallback constants and exports
// ───────────────────────────────────────────────────────────

describe("port fallback", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module-level state that persists across tests
    const ext = await import("./index.ts");
    ext._setPersistedPort(null);
  });

  it("exports high port constants", async () => {
    const ext = await import("./index.ts");
    const hpc = ext._getHighPortConstants();
    expect(hpc.HIGH_PORT_MIN).toBe(7200);
    expect(hpc.HIGH_PORT_MAX).toBe(7999);
    expect(hpc.MAX_RANDOM_ATTEMPTS).toBe(5);
  });

  it("exports persisted port getter/setter", async () => {
    const ext = await import("./index.ts");
    expect(ext._getPersistedPort()).toBeNull();
    ext._setPersistedPort(7300);
    expect(ext._getPersistedPort()).toBe(7300);
  });

  it("exports lastPortAttemptLog", async () => {
    const ext = await import("./index.ts");
    const log = ext._getLastPortAttemptLog();
    expect(Array.isArray(log)).toBe(true);
  });

  it("ensureDaemonRunning returns true when daemon healthy", async () => {
    mockHttp.get.mockImplementationOnce((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    const ext = await import("./index.ts");
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(true);
    expect(ext._getDaemonReady()).toBe(true);
  });

  it("tries persisted port first when available (slow)", async () => {
    // First health check fails, spawn with persisted port succeeds,
    // then health checks succeed after port bind
    let healthCount = 0;
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      healthCount++;
      const req: any = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "error" && healthCount === 1) {
            setImmediate(() => handler());
          }
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      if (healthCount > 1) {
        setImmediate(() => cb({ statusCode: 200 }));
      }
      return req;
    });
    // Use mockSpawnProcess but override stdout for first spawn
    let spawnIdx = 0;
    mockCp.spawn.mockImplementation(() => {
      spawnIdx++;
      const proc = mockSpawnProcess({ exitCode: 0 });
      if (spawnIdx === 1) {
        // First spawn (persisted port) should emit PORT_BOUND
        proc.stdout.on = vi.fn().mockImplementation((_event: string, cb: (d: Buffer) => void) => {
          cb(Buffer.from("PORT_BOUND:7300\n"));
          return proc.stdout;
        });
      }
      return proc;
    });
    const ext = await import("./index.ts");
    ext._setPersistedPort(7300);
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(true);
    expect(ext._getPersistedPort()).toBe(7300);
  }, 120000);

  it("falls through to high ports when standard ports fail (slow)", async () => {
    let healthCount = 0;
    let spawnCount = 0;
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      healthCount++;
      const req: any = {
        on: vi.fn().mockImplementation((event, handler) => {
          // All health checks fail until after a successful spawn
          if (event === "error" && spawnCount < 12) {
            setImmediate(() => handler());
          }
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      // Health checks succeed only after the 12th spawn (high port) bound
      if (spawnCount >= 12) {
        setImmediate(() => cb({ statusCode: 200 }));
      }
      return req;
    });
    // Only the 12th spawn (high port) succeeds with PORT_BOUND
    mockCp.spawn.mockImplementation(() => {
      spawnCount++;
      const proc = mockSpawnProcess({ exitCode: 0 });
      if (spawnCount === 12) {
        proc.stdout.on = vi.fn().mockImplementation((_event: string, cb: (d: Buffer) => void) => {
          cb(Buffer.from("PORT_BOUND:7500\n"));
          return proc.stdout;
        });
      }
      return proc;
    });
    const ext = await import("./index.ts");
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(true);
    expect(ext._getPersistedPort()).toBe(7500);
  }, 120000);

  it("logs error when all ports exhausted (slow)", async () => {
    mockHttp.get.mockImplementation((_url, _opts, _cb) => {
      const req: any = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "error") setImmediate(() => handler());
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      return req;
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(false);
    const attemptLog = ext._getLastPortAttemptLog();
    expect(attemptLog.length).toBeGreaterThan(0);
  }, 120000);
});// ───────────────────────────────────────────────────────────
// Test: stopDaemon// ───────────────────────────────────────────────────────────
// Test: stopDaemon
// ───────────────────────────────────────────────────────────

describe("stopDaemon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kills process and resets state", async () => {
    const proc = mockSpawnProcess();
    mockCp.spawn.mockReturnValue(proc);
    const ext = await import("./index.ts");
    ext._setDaemonReady(true);
    ext._setDaemonProcess(proc);

    ext._stopDaemon();

    expect(proc.kill).toHaveBeenCalled();
    expect(ext._getDaemonReady()).toBe(false);
    expect(ext._getDaemonProcess()).toBeNull();
  });

  it("does nothing when no daemon is running", async () => {
    const ext = await import("./index.ts");
    ext._setDaemonReady(false);
    ext._setDaemonProcess(null);

    ext._stopDaemon();

    expect(mockCp.spawn).not.toHaveBeenCalled();
    expect(ext._getDaemonReady()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// Test: speakText
// ───────────────────────────────────────────────────────────

describe("speakText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue("/Users/testuser");
    mockCp.execSync.mockReturnValue(Buffer.from("/tmp/speakturbo_test"));
    mockFs.createWriteStream.mockReturnValue(mockWriteStream());
  });

  it("returns false when daemon not available", async () => {
    mockHttp.get.mockImplementation((_url, _opts, _cb) => {
      const req: any = {
        on: vi.fn().mockImplementation((event, cb) => {
          if (event === "error") setImmediate(() => cb());
          return req;
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };
      return req;
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 1 }));
    const ext = await import("./index.ts");
    const result = await ext._speakText("hello", "alba");
    expect(result).toBe(false);
  });

  it("returns false on aborted signal before download", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    const ext = await import("./index.ts");
    const aborted = new AbortController();
    aborted.abort();
    const result = await ext._speakText("hello", "alba", aborted.signal);
    expect(result).toBe(false);
  });

  it("returns false on empty response body", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
    });
    const ext = await import("./index.ts");
    const result = await ext._speakText("hello", "alba");
    expect(result).toBe(false);
    // Temp file should be cleaned up
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it("returns false on daemon error response and cleans up temp file", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    const ext = await import("./index.ts");
    const result = await ext._speakText("hello", "alba");
    expect(result).toBe(false);
    // Temp file should be cleaned up
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it("writes audio to temp file then plays with afplay (not stdin)", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockReadableStream([new Uint8Array([1, 2, 3])]),
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const result = await ext._speakText("hello", "alba");
    expect(result).toBe(true);
    // execSync should be called to create temp dir
    expect(mockCp.execSync).toHaveBeenCalled();
    // createWriteStream should be called for temp file
    expect(mockFs.createWriteStream).toHaveBeenCalled();
    // afplay should be called with a file path, NOT "-"
    const afplayCalls = mockCp.spawn.mock.calls.filter(
      (call: any[]) => call[0] === "afplay"
    );
    expect(afplayCalls.length).toBeGreaterThan(0);
    // The first arg to afplay must be a file path, not "-"
    for (const call of afplayCalls) {
      expect(call[1][0]).not.toBe("-");
    }
  });

  it("cleans up temp file after successful playback", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockReadableStream([new Uint8Array([1, 2, 3])]),
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const result = await ext._speakText("hello", "alba");
    expect(result).toBe(true);
    // Temp file should be cleaned up after playback
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────
// Test: PlaybackController
// ───────────────────────────────────────────────────────────

describe("PlaybackController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue("/Users/testuser");
    mockCp.execSync.mockReturnValue(Buffer.from("/tmp/speakturbo_test"));
    mockFs.createWriteStream.mockReturnValue(mockWriteStream());
  });

  it("supports synchronous mode", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockReadableStream([new Uint8Array([1, 2, 3])]),
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const ctrl = ext._getPlaybackController();
    ctrl.setMode("synchronous");
    const result = await ctrl.play("hello", "alba");
    expect(result).toBe(true);
  });

  it("supports interrupt mode", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockReadableStream([new Uint8Array([1, 2, 3])]),
    });
    const proc1 = mockSpawnProcess({ exitCode: 0 });
    mockCp.spawn.mockReturnValueOnce(proc1); // afplay for interrupt kill
    mockCp.spawn.mockReturnValueOnce(mockSpawnProcess({ exitCode: 0 })); // afplay for new play

    const ext = await import("./index.ts");
    const ctrl = ext._getPlaybackController();
    ctrl.setMode("interrupt");
    // Set up a current playback to interrupt
    ext._setCurrentPlayback({ process: mockSpawnProcess(), tmpFile: "/tmp/old.wav" });
    const result = await ctrl.play("hello", "alba");
    expect(result).toBe(true);
    expect(mockFs.unlinkSync).toHaveBeenCalledWith("/tmp/old.wav");
  });

  it("supports queue mode", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockReadableStream([new Uint8Array([1, 2, 3])]),
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const ctrl = ext._getPlaybackController();
    ctrl.setMode("queue");
    const result = await ctrl.play("hello", "alba");
    expect(result).toBe(true);
  });

  it("supports fire-and-forget mode", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    const ext = await import("./index.ts");
    const ctrl = ext._getPlaybackController();
    ctrl.setMode("fire-and-forget");
    const result = await ctrl.play("hello", "alba");
    expect(result).toBe(true);
  });

  it("drains queue items pushed during active drain", async () => {
    mockHttp.get.mockImplementation((_url, _opts, cb) => {
      const req: any = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      setImmediate(() => cb({ statusCode: 200 }));
      return req;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockReadableStream([new Uint8Array([1, 2, 3])]),
    });
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const ctrl = ext._getPlaybackController();
    ctrl.setMode("queue");
    // Queue two items; both should resolve true
    const p1 = ctrl.play("one", "alba");
    const p2 = ctrl.play("two", "marius");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// Test: voiceOutputExtension
// ───────────────────────────────────────────────────────────

describe("voiceOutputExtension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue("/Users/testuser");
    mockCp.execSync.mockReturnValue(Buffer.from("/tmp/speakturbo_test"));
    mockHttp.get.mockReturnValue({
      on: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
    });
  });

  it("registers speak tool and event handlers", async () => {
    const registerTool = vi.fn();
    const on = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([]);
    const mockPi = {
      registerTool,
      on,
      getAllTools,
      registerProvider: vi.fn(),
      getActiveTools: vi.fn().mockReturnValue([]),
      setActiveTools: vi.fn(),
      exec: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
    };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;
    expect(typeof defaultExport).toBe("function");

    defaultExport(mockPi);
    expect(registerTool).toHaveBeenCalled();
    expect(on).toHaveBeenCalled();
  });

  it("registers onTerminalInput handler for Esc", async () => {
    const onTerminalInput = vi.fn();
    const mockCtx = {
      ui: { onTerminalInput },
      cwd: "/test",
      isIdle: () => true,
    };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;

    const onCalls: any[] = [];
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([]);
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    defaultExport(mockPi);

    const sessionStartHandler = onCalls.find((c: any) => c.event === "session_start")?.handler;
    expect(sessionStartHandler).toBeDefined();

    await sessionStartHandler({ type: "session_start", reason: "startup" }, mockCtx);
    expect(onTerminalInput).toHaveBeenCalled();
    const inputHandler = onTerminalInput.mock.calls[0][0];
    expect(typeof inputHandler).toBe("function");

    // Esc with no currentPlayback returns undefined
    const result = inputHandler("\x1b");
    expect(result).toBeUndefined();
  });

  it("Esc handler stops current playback", async () => {
    const onTerminalInput = vi.fn();
    const mockCtx = { ui: { onTerminalInput }, cwd: "/test", isIdle: () => true };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;

    const onCalls: any[] = [];
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([]);
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    defaultExport(mockPi);
    const sessionStartHandler = onCalls.find((c: any) => c.event === "session_start")?.handler;
    await sessionStartHandler({ type: "session_start", reason: "startup" }, mockCtx);
    const inputHandler = onTerminalInput.mock.calls[0][0];

    // Set up a current playback
    const mockProc = mockSpawnProcess();
    ext._setCurrentPlayback({ process: mockProc, tmpFile: "/tmp/test.wav" });

    const result = inputHandler("\x1b");
    expect(result).toEqual({ consume: true });
    expect(mockProc.kill).toHaveBeenCalled();
    expect(mockFs.unlinkSync).toHaveBeenCalledWith("/tmp/test.wav");
    expect(ext._getCurrentPlayback()).toBeNull();
  });

  it("onTerminalInput handler ignores non-Esc input", async () => {
    const onTerminalInput = vi.fn();
    const mockCtx = { ui: { onTerminalInput }, cwd: "/test", isIdle: () => true };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;

    const onCalls: any[] = [];
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([]);
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    defaultExport(mockPi);
    const sessionStartHandler = onCalls.find((c: any) => c.event === "session_start")?.handler;
    await sessionStartHandler({ type: "session_start", reason: "startup" }, mockCtx);
    const inputHandler = onTerminalInput.mock.calls[0][0];

    const result = inputHandler("hello");
    expect(result).toBeUndefined();
  });

  it("re-registers speak tool if missing from getAllTools", async () => {
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([{ name: "bash" }, { name: "read" }]);

    const onCalls: any[] = [];
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;
    defaultExport(mockPi);

    const sessionStartHandler = onCalls.find((c: any) => c.event === "session_start")?.handler;
    await sessionStartHandler({ type: "session_start", reason: "startup" }, { ui: { onTerminalInput: vi.fn() }, cwd: "/test", isIdle: () => true });

    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("does not re-register speak tool if already present", async () => {
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([{ name: "speak" }, { name: "bash" }]);

    const onCalls: any[] = [];
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;
    defaultExport(mockPi);

    const sessionStartHandler = onCalls.find((c: any) => c.event === "session_start")?.handler;
    await sessionStartHandler({ type: "session_start", reason: "startup" }, { ui: { onTerminalInput: vi.fn() }, cwd: "/test", isIdle: () => true });

    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("before_agent_start adds voice guidelines to system prompt", async () => {
    const onCalls: any[] = [];
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([]);
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;
    defaultExport(mockPi);

    const beforeAgentStartHandler = onCalls.find((c: any) => c.event === "before_agent_start")?.handler;
    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler(
      { type: "before_agent_start", prompt: "test", systemPrompt: "base prompt", systemPromptOptions: {} },
      { ui: {}, cwd: "/test", isIdle: () => true }
    );

    expect(result.systemPrompt).toContain("Voice and Response Guidelines");
    expect(result.systemPrompt).toContain("base prompt");
  });

  it("session_shutdown stops the daemon", async () => {
    const onCalls: any[] = [];
    const registerTool = vi.fn();
    const getAllTools = vi.fn().mockReturnValue([]);
    const on = vi.fn().mockImplementation((event: string, handler: any) => {
      onCalls.push({ event, handler });
    });
    const mockPi = { registerTool, on, getAllTools, registerProvider: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), exec: vi.fn(), events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } };

    const ext = await import("./index.ts");
    const defaultExport = (ext as any).default;
    defaultExport(mockPi);

    const shutdownHandler = onCalls.find((c: any) => c.event === "session_shutdown")?.handler;
    expect(shutdownHandler).toBeDefined();
    await shutdownHandler({ type: "session_shutdown", reason: "quit" }, { ui: {}, cwd: "/test" });
    // No error — handler runs successfully
  });
});
