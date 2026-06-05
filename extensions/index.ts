import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";

// ───────────────────────────────────────────────────────────
// Path resolution — works regardless of install location
// ───────────────────────────────────────────────────────────

const EXTENSION_DIR = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(new URL(import.meta.url).pathname);

const PACKAGE_ROOT = path.resolve(EXTENSION_DIR, "..");
const DAEMON_SCRIPT = path.join(PACKAGE_ROOT, "daemon", "daemon_streaming.py");
const VENV_DIR = path.join(PACKAGE_ROOT, ".venv");
const VENV_PYTHON = path.join(VENV_DIR, "bin", "python3");

// ───────────────────────────────────────────────────────────
// Config file — ~/.pi/agent/speak.json
// ───────────────────────────────────────────────────────────

interface SpeakConfig {
  voice?: string;
  port?: number;
  playbackMode?: "synchronous" | "interrupt" | "queue" | "fire-and-forget";
}

function loadConfig(): SpeakConfig {
  const configPath = path.join(os.homedir(), ".pi", "agent", "speak.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as SpeakConfig;
  } catch {
    return {};
  }
}

const CONFIG = loadConfig();

// ───────────────────────────────────────────────────────────
// SpeakTurbo backend config
// ───────────────────────────────────────────────────────────

let DAEMON_PORT = CONFIG.port ?? parseInt(process.env.SPEAKTURBO_PORT || "7125", 10);
const DAEMON_HOST = "127.0.0.1";
let DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

// Candidate ports for fallback
const FALLBACK_PORTS = [7125, 7126, 7127, 7128, 7129, 7130];

// High port range for random fallback when all standard ports are taken
const HIGH_PORT_MIN = 7200;
const HIGH_PORT_MAX = 7999;
const MAX_RANDOM_ATTEMPTS = 5;

// Persisted port — remembers the last successful port so we try it first on restart
let persistedPort: number | null = null;

// Track which ports we've tried for logging
let lastPortAttemptLog: string[] = [];

const DEFAULT_VOICE = CONFIG.voice ?? "alba";

const VOICE_NAMES = ["alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma"];

// ───────────────────────────────────────────────────────────
// HTTP agent with keepAlive for health checks
// ───────────────────────────────────────────────────────────

const healthAgent = new http.Agent({ keepAlive: true });

// ───────────────────────────────────────────────────────────
// Daemon management
// ───────────────────────────────────────────────────────────

let daemonProcess: ReturnType<typeof spawn> | null = null;
let daemonReady = false;

function daemonHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${DAEMON_URL}/health`, { agent: healthAgent }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Try all known candidate ports to see if the daemon is already alive on any of them
function daemonHealthAnywhere(): Promise<number | null> {
  return new Promise((resolve) => {
    const candidates = new Set<number>();
    if (CONFIG.port && CONFIG.port >= 1024 && CONFIG.port <= 65535) {
      candidates.add(CONFIG.port);
    }
    if (persistedPort !== null) {
      candidates.add(persistedPort);
    }
    for (const p of FALLBACK_PORTS) {
      candidates.add(p);
    }
    const ports = Array.from(candidates);
    let foundPort: number | null = null;
    let completed = 0;
    for (const port of ports) {
      const req = http.get(`http://${DAEMON_HOST}:${port}/health`, { agent: healthAgent }, (res) => {
        if (foundPort === null && res.statusCode === 200) {
          foundPort = port;
        }
        completed++;
        if (completed === ports.length) {
          resolve(foundPort);
        }
      });
      req.on("error", () => {
        completed++;
        if (completed === ports.length) {
          resolve(foundPort);
        }
      });
      // 2s timeout per port — whichever responds fastest wins
      req.setTimeout(2000, () => {
        req.destroy();
        completed++;
        if (completed === ports.length) {
          resolve(foundPort);
        }
      });
    }
    // If no candidates, resolve immediately
    if (ports.length === 0) {
      resolve(null);
    }
  });
}

async function ensureDaemonRunning(): Promise<boolean> {
  // First check if daemon is alive on the current port
  if (await daemonHealth()) {
    daemonReady = true;
    return true;
  }

  // Daemon not on current port — check all known candidate ports
  const alivePort = await daemonHealthAnywhere();
  if (alivePort !== null) {
    DAEMON_PORT = alivePort;
    DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;
    persistedPort = alivePort;
    daemonReady = true;
    console.log("[speak] Found existing daemon on port " + alivePort);
    return true;
  }

  // Async kill instead of sync pkill + sleep
  await new Promise<void>((resolve) => {
    const kill = spawn("pkill", ["-9", "-f", "daemon_streaming.py"], { stdio: "ignore" });
    kill.on("close", resolve);
    kill.on("error", resolve);
  });
  await new Promise((r) => setTimeout(r, 500));

  // ───────────────────────────────────────────────────────
  // Port negotiation strategy:
  //   1. Try CONFIG.port (if set in ~/.pi/agent/speak.json)
  //   2. Try persistedPort from last successful run
  //   3. Try standard fallback ports 7125-7130
  //   4. Try random high ports 7200-7999 (up to 5 attempts)
  // ───────────────────────────────────────────────────────
  let boundPort: number | null = null;
  let boundChild: ReturnType<typeof spawn> | null = null;
  lastPortAttemptLog = [];

  // Build ordered list of ports to try
  const portsToTry: number[] = [];

  // Config port override (already set as DAEMON_PORT, but try explicitly)
  if (CONFIG.port && CONFIG.port >= 1024 && CONFIG.port <= 65535) {
    portsToTry.push(CONFIG.port);
  }

  // Persisted port from last successful run (skip if same as config port)
  if (persistedPort !== null && persistedPort !== CONFIG.port) {
    portsToTry.push(persistedPort);
  }

  // Standard fallback ports (skip duplicates)
  for (const p of FALLBACK_PORTS) {
    if (!portsToTry.includes(p)) {
      portsToTry.push(p);
    }
  }

  // Random high ports (up to MAX_RANDOM_ATTEMPTS unique ports not already in list)
  const highPorts: number[] = [];
  while (highPorts.length < MAX_RANDOM_ATTEMPTS) {
    const candidate = HIGH_PORT_MIN + Math.floor(Math.random() * (HIGH_PORT_MAX - HIGH_PORT_MIN + 1));
    if (!portsToTry.includes(candidate) && !highPorts.includes(candidate)) {
      highPorts.push(candidate);
    }
  }
  for (const p of highPorts) {
    portsToTry.push(p);
  }

  console.log("[speak] Trying ports: " + portsToTry.join(", "));

  for (const candidatePort of portsToTry) {
    lastPortAttemptLog.push(String(candidatePort));
    const child = spawn(VENV_PYTHON, [DAEMON_SCRIPT, "--port", String(candidatePort)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdoutBuf = "";
    child.stdout?.on("data", (data: Buffer) => {
      stdoutBuf += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error("[speak] daemon:", msg.slice(0, 200));
    });

    child.on("close", (code) => {
      if (boundChild !== null) return;
      if (daemonProcess !== child) return;
      if (code !== 0 && code !== null) {
        console.log("[speak] daemon exited (code:" + code + ")");
      }
      daemonReady = false;
      daemonProcess = null;
    });
    child.on("error", (e) => {
      if (boundChild !== null) return;
      if (daemonProcess !== child) return;
      console.error("[speak] daemon error:", e.message);
      daemonReady = false;
      daemonProcess = null;
    });

    daemonProcess = child;

    // Wait for PORT_BOUND: on stdout or process exit, whichever comes first.
    // Model load + voice pre-warm takes ~1-3s.
    let started = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { resolve(); }, 3000);
      const checkInterval = setInterval(() => {
        if (stdoutBuf.includes("PORT_BOUND:")) {
          clearTimeout(timer);
          started = true;
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      child.on("close", () => {
        clearInterval(checkInterval);
        if (!started) { clearTimeout(timer); started = true; resolve(); }
      });
    });
    const match = stdoutBuf.match(/PORT_BOUND:(\d+)/);
    if (match) {
      boundPort = parseInt(match[1], 10);
      boundChild = child;
      persistedPort = boundPort;
      console.log("[speak] Daemon bound on port " + boundPort + " (persisted for next start)");
      break;
    }
    // Kill failed attempt
    child.kill();
  }

  if (boundPort) {
    DAEMON_PORT = boundPort;
    DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;
  } else {
    // All ports exhausted — log a clear error
    const triedPorts = [...new Set(lastPortAttemptLog)].join(", ");
    console.error(
      "[speak] All ports in use. No available port in 7125-7130 or 7200-7999. Tried: " + triedPorts
    );
  }

  // Health check on the actual port
  for (let i = 0; i < 12; i++) {
    const ok = await daemonHealth();
    if (ok) {
      daemonReady = true;
      console.log("[speak] speakturbo daemon ready (~90ms latency)");
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.error("[speak] speakturbo daemon failed to start");
  return false;
}

function stopDaemon() {
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
    daemonReady = false;
  }
}

// ───────────────────────────────────────────────────────────
// Playback controller — supports multiple modes
// ───────────────────────────────────────────────────────────

type PlaybackMode = "synchronous" | "interrupt" | "queue" | "fire-and-forget";

interface QueuedPlayback {
  text: string;
  voice: string;
  signal?: AbortSignal;
  resolve: (ok: boolean) => void;
}

class PlaybackController {
  private mode: PlaybackMode;
  private queue: QueuedPlayback[] = [];
  private busy = false;

  constructor(mode: PlaybackMode) {
    this.mode = mode;
  }

  setMode(mode: PlaybackMode) {
    this.mode = mode;
  }

  async play(text: string, voice: string, signal?: AbortSignal): Promise<boolean> {
    switch (this.mode) {
      case "synchronous":
        return speakText(text, voice, signal);
      case "interrupt": {
        if (currentPlayback) {
          try { currentPlayback.process.kill(); } catch {}
          try { fs.unlinkSync(currentPlayback.tmpFile); } catch {}
          currentPlayback = null;
        }
        return speakText(text, voice, signal);
      }
      case "queue": {
        return new Promise<boolean>((resolve) => {
          this.queue.push({ text, voice, signal, resolve });
          this.dequeue();
        });
      }
      case "fire-and-forget":
        speakText(text, voice, signal);
        return true;
    }
  }

  private async dequeue() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const ok = await speakText(item.text, item.voice, item.signal);
      item.resolve(ok);
    }
    this.busy = false;
    // Re-check for items pushed during drain
    this.dequeue();
  }
}

const playbackController = new PlaybackController(CONFIG.playbackMode ?? "synchronous");

// ───────────────────────────────────────────────────────────
// State for playback control
// ───────────────────────────────────────────────────────────

let currentPlayback: { process: ReturnType<typeof spawn>; tmpFile: string } | null = null;

// ───────────────────────────────────────────────────────────
// Text sanitization — strip markdown before sending to TTS
// ───────────────────────────────────────────────────────────

function prepareText(text: string): string {
  return text
    // Code fences
    .replace(/```[\s\S]*?```/g, "")
    // Inline code
    .replace(/`[^`]*`/g, "")
    // Links [text](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Headings
    .replace(/^#+\s*/gm, "")
    // Bold / italic
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Strikethrough
    .replace(/~~([^~]+)~~/g, "$1")
    // List markers
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Table pipes
    .replace(/\|/g, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ───────────────────────────────────────────────────────────
// Speak via HTTP to the daemon
// ───────────────────────────────────────────────────────────

async function speakText(text: string, voice: string, signal?: AbortSignal): Promise<boolean> {
  let tmpFile: string | null = null;
  let playProcess: ReturnType<typeof spawn> | null = null;

  const cleanup = () => {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
      tmpFile = null;
    }
  };

  try {
    if (!await ensureDaemonRunning()) {
      console.error("[speak] daemon not available");
      return false;
    }

    if (signal?.aborted) {
      return false;
    }

    const url = `${DAEMON_URL}/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;

    // Write to temp file — afplay doesn't support stdin on macOS
    tmpFile = `${execSync("mktemp -d -t speakturbo_XXXXX").toString().trim()}/audio.wav`;

    // Register abort handler for cleanup
    if (signal) {
      signal.addEventListener("abort", () => {
        // Kill playback if running
        if (playProcess) {
          try { playProcess.kill(); } catch {}
          playProcess = null;
        }
        if (currentPlayback && currentPlayback.tmpFile === tmpFile) {
          try { currentPlayback.process.kill(); } catch {}
          currentPlayback = null;
        }
        cleanup();
      }, { once: true });
    }

    // Download audio using fetch + writeStream
    const response = await fetch(url);
    if (!response.ok) {
      cleanup();
      throw new Error(`TTS daemon returned ${response.status}`);
    }
    const body = response.body;
    if (!body) {
      cleanup();
      throw new Error("Empty response body from TTS daemon");
    }
    const reader = body.getReader();
    const ws = fs.createWriteStream(tmpFile);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        ws.on("error", () => {}); // prevent unhandled error
        ws.end(() => {});
        cleanup();
        return false;
      }
      ws.write(value);
    }
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.end(() => resolve());
    });

    if (signal?.aborted) {
      cleanup();
      return false;
    }

    // Play audio
    playProcess = spawn("afplay", [tmpFile], { stdio: "ignore" });
    currentPlayback = { process: playProcess, tmpFile: tmpFile };

    await new Promise<void>((playResolve, playReject) => {
      playProcess!.on("error", (e) => playReject(e));
      playProcess!.on("close", (code) => {
        if (currentPlayback && currentPlayback.process === playProcess) {
          currentPlayback = null;
        }
        if (code === 0) playResolve();
        else playReject(new Error(`afplay exited with code ${code}`));
      });
    });

    // Clean up
    cleanup();
    return true;
  } catch (e) {
    cleanup();
    if (currentPlayback) {
      try { currentPlayback.process.kill(); } catch {}
      currentPlayback = null;
    }
    console.error("[speak] speak error:", (e as Error).message?.slice(0, 120));
    return false;
  }
}

// ───────────────────────────────────────────────────────────
// Extension
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Test exports — exported only for unit testing
// ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function _prepareText(text: string): string { return prepareText(text); }
export function _loadConfig(): SpeakConfig { return loadConfig(); }
export function _daemonHealth(): Promise<boolean> { return daemonHealth(); }
export function _ensureDaemonRunning(): Promise<boolean> { return ensureDaemonRunning(); }
export function _stopDaemon(): void { stopDaemon(); }
export function _getDaemonReady(): boolean { return daemonReady; }
export function _getDaemonProcess() { return daemonProcess; }
export function _getCurrentPlayback() { return currentPlayback; }
export function _setDaemonReady(val: boolean) { daemonReady = val; }
export function _setDaemonProcess(proc: ReturnType<typeof spawn> | null) { daemonProcess = proc; }
export function _setCurrentPlayback(val: { process: ReturnType<typeof spawn>; tmpFile: string } | null) { currentPlayback = val; }
export function _getPlaybackController() { return playbackController; }
export function _speakText(text: string, voice: string, signal?: AbortSignal): Promise<boolean> { return speakText(text, voice, signal); }
export function _getPersistedPort(): number | null { return persistedPort; }
export function _setPersistedPort(val: number | null) { persistedPort = val; }
export function _getLastPortAttemptLog(): string[] { return lastPortAttemptLog; }
export function _getHighPortConstants() { return { HIGH_PORT_MIN, HIGH_PORT_MAX, MAX_RANDOM_ATTEMPTS }; }
export function _daemonHealthAnywhere(): Promise<number | null> { return daemonHealthAnywhere(); }

export default function voiceOutputExtension(pi: ExtensionAPI) {
  ensureDaemonRunning();

  // Build voice list string once from the canonical array
  const voiceList = VOICE_NAMES.join(", ");
  const voiceLines = VOICE_NAMES.map((v) => `  - ${v}`).join("\n");

  const toolDef = {
    name: "speak",
    label: "Speak",
    description:
      "Convert text to spoken audio output using the system speaker. " +
      "Ultra-fast (~90ms to first sound) using the speakturbo engine.\n\n" +
      "Supported voices:\n" + voiceLines,
    promptSnippet: "Read text aloud using TTS",
    promptGuidelines: [
      "Use the speak tool whenever the user asks you to read a response aloud or speak something out loud. Do not just say you will read — actually call the tool.",
      "When speaking, formulate your response as natural spoken language. Avoid markdown formatting, bullet points, numbered lists, emojis, bold markers, and any visual-only text conventions. Write how you would naturally speak the words.",
      "After using the speak tool, do not simply echo the spoken words in your text response. You may write complementary text: code blocks, tables, additional detail, or clarification. The spoken delivery handles narration; your text handles structure. Avoid verbatim duplication but complementary expansion is fine.",
      "Use voice for natural conversation and text for code, tables, and structured information. Keep chain-of-thought concise and efficient.",
    ],
    parameters: Type.Object({
      text: Type.String({
        description:
          "The text to speak aloud. Keep spoken portions concise — detailed data goes in your text response.",
      }),
      voice: Type.Optional(
        Type.String({
          description: `Voice to use. Default: ${DEFAULT_VOICE}. Options: ${voiceList}. Can be overridden in ~/.pi/agent/speak.json.`,
          default: DEFAULT_VOICE,
        })
      ),
    }),
    async execute(toolCallId: string, params: { text: string; voice?: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const text = prepareText(params.text);
      const voice = params.voice ?? DEFAULT_VOICE;

      const ok = await playbackController.play(text, voice, signal);

      if (!ok) {
        return {
          content: [{ type: "text" as const, text: "Failed to play audio. The TTS daemon may not be available." }],
          isError: true,
          details: { spoken: false, voice },
        };
      }

      return {
        content: [{ type: "text" as const, text: "✓ spoken" }],
        details: { spoken: true, voice },
      };
    },
  };

  pi.registerTool(toolDef);

  pi.on("session_start", async (_event, ctx) => {
    const all = pi.getAllTools().map((t) => t.name);
    if (!all.includes("speak")) {
      pi.registerTool(toolDef);
    }

    // Stop controls — Esc to cut audio
    ctx.ui.onTerminalInput((data) => {
      if (data === "\x1b") {
        if (currentPlayback) {
          try { currentPlayback.process.kill(); } catch {}
          try { fs.unlinkSync(currentPlayback.tmpFile); } catch {}
          currentPlayback = null;
          return { consume: true };
        }
      }
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const guidelines = `
## Voice and Response Guidelines

- The speak tool is your primary channel for conversational responses. Use it when the user asks you to read, explain, or converse. Do not just say you will speak — actually call the tool.
- **Call the speak tool at most ONCE per turn.** Use it for the narrative headline or key takeaway. Then provide complementary detail — code, tables, data — in your text response.
- **Call the speak tool at the very start of your response**, before writing any other text. This ensures audio begins playing immediately, in parallel with your written text.
- After speaking, do not simply echo the spoken words verbatim in your text. Complementary text (code blocks, tables, additional detail not spoken) is welcome. The spoken delivery handles narration; your text handles structure.
- When speaking, formulate your response as natural spoken language. Avoid markdown formatting, bullet points, numbered lists, emojis, bold markers, and any visual-only text conventions.
- Use text output for code, tables, syntax, and structured information. Use voice for natural conversation, explanations, and spoken feedback.
- Keep chain-of-thought / reasoning concise. Do not pad with long internal monologue.
- Text and voice can be complementary: use text for visual structure (tables, code) and voice for the narrative explaining it.
`;

    return {
      systemPrompt: event.systemPrompt + "\n" + guidelines,
    };
  });

  pi.on("session_shutdown", async (_event) => {
    stopDaemon();
  });
}
