import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import http from "node:http";

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
// SpeakTurbo backend config
// ───────────────────────────────────────────────────────────

const DAEMON_PORT = parseInt(process.env.SPEAKTURBO_PORT || "7125", 10);
const DAEMON_HOST = "127.0.0.1";
const DAEMON_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}`;

const VOICE_NAMES = ["alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma"];

// ───────────────────────────────────────────────────────────
// Daemon management
// ───────────────────────────────────────────────────────────

let daemonProcess: ReturnType<typeof spawn> | null = null;
let daemonReady = false;

function daemonHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${DAEMON_URL}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureDaemonRunning(): Promise<boolean> {
  if (await daemonHealth()) {
    daemonReady = true;
    return true;
  }

  try {
    execSync("pkill -9 -f daemon_streaming.py", { stdio: "ignore" });
  } catch {}
  try {
    execSync("sleep 1", { stdio: "ignore" });
  } catch {}

  const child = spawn(VENV_PYTHON, [DAEMON_SCRIPT], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error("[voice_output] daemon:", msg.slice(0, 200));
  });

  child.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.log("[voice_output] daemon exited (code:" + code + ")");
    }
    daemonReady = false;
    daemonProcess = null;
  });
  child.on("error", (e) => {
    console.error("[voice_output] daemon error:", e.message);
    daemonReady = false;
    daemonProcess = null;
  });

  daemonProcess = child;

  for (let i = 0; i < 60; i++) {
    const ok = await daemonHealth();
    if (ok) {
      daemonReady = true;
      console.log("[voice_output] speakturbo daemon ready (~90ms latency)");
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.error("[voice_output] speakturbo daemon failed to start");
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
// Speak via HTTP to the daemon
// ───────────────────────────────────────────────────────────

function speakText(text: string, voice: string): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      if (!await ensureDaemonRunning()) {
        console.error("[voice_output] daemon not available");
        resolve(false);
        return;
      }

      const url = `${DAEMON_URL}/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;

      const tmpDir = execSync("mktemp -t speakturbo_XXXXX").toString().trim();
      const tmpFile = `${tmpDir}.wav`;

      const downloadCmd = `curl -s --retry 3 --retry-delay 1 -o "${tmpFile}" "${url}"`;
      execSync(downloadCmd, { timeout: 120_000 });

      execSync(`afplay "${tmpFile}"`, { timeout: 120_000, stdio: "ignore" });

      execSync(`rm -f "${tmpFile}"`, { stdio: "ignore" });

      resolve(true);
    } catch (e) {
      console.error("[voice_output] speak error:", (e as Error).message?.slice(0, 120));
      resolve(false);
    }
  });
}

// ───────────────────────────────────────────────────────────
// Extension
// ───────────────────────────────────────────────────────────

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
          description: `Voice to use. Default: alba. Options: ${voiceList}.`,
          default: "alba",
        })
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const text = params.text;
      const voice = params.voice ?? "alba";

      speakText(text, voice).catch(() => {});

      return {
        content: [{ type: "text", text: "✓ spoken" }],
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

  pi.on("unload", async () => {
    stopDaemon();
  });
}
