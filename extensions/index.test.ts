import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
      setTimeout(() => {
        if (event === "close") {
          if (opt?.error) {
            // error event fires instead
          } else {
            cb(opt?.exitCode ?? 0);
          }
        }
        if (event === "error") {
          if (opt?.error) cb(opt.error);
        }
      }, delay);
      return proc;
    }),
    once: vi.fn().mockReturnThis(),
    kill: vi.fn(),
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
    mockCp.spawn.mockReturnValue(mockSpawnProcess({ exitCode: 0 }));
    const ext = await import("./index.ts");
    const result = await ext._ensureDaemonRunning();
    expect(result).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
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
  });

  it("cleans up temp file on error", async () => {
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
    await ext._speakText("hello", "alba");
    expect(mockFs.unlinkSync).toHaveBeenCalledWith("/tmp/speakturbo_test/audio.wav");
  });

  it("cleans up temp file on daemon error response", async () => {
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
    await ext._speakText("hello", "alba");
    expect(mockFs.unlinkSync).toHaveBeenCalledWith("/tmp/speakturbo_test/audio.wav");
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
