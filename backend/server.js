import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";

const PORT = Number(process.env.PORT || 3000);
const BACKEND_SECRET = process.env.BACKEND_SECRET || "";
const MODEL = process.env.CLAUDE_MODEL || "sonnet";
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "You are a helpful assistant on my personal website. Answer clearly and concisely.";
const MAX_MESSAGE_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 120_000;

if (!BACKEND_SECRET || BACKEND_SECRET.startsWith("change-me")) {
  console.error("Set BACKEND_SECRET in .env before starting the server.");
  process.exit(1);
}

// Empty working directory: the chatbot never sees your real files.
const SANDBOX_DIR = path.join(os.tmpdir(), "claude-chat-sandbox");
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

function authMode() {
  if (process.env.ANTHROPIC_API_KEY) return "api-key (Console billing)";
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return "subscription (setup-token)";
  return "subscription (local `claude` login)";
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function buildEnv() {
  const env = { ...process.env };
  // Empty strings would shadow the local login, so drop them.
  if (!env.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

async function askClaude(message, sessionId) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  let reply = "";
  let newSessionId = sessionId || null;

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        tools: [], // plain chat: no file, shell or web tools
        settingSources: [], // ignore ~/.claude settings, skills, CLAUDE.md
        cwd: SANDBOX_DIR,
        maxTurns: 1,
        resume: sessionId || undefined,
        env: buildEnv(),
        abortController,
      },
    })) {
      if (msg.session_id) newSessionId = msg.session_id;

      if (msg.type === "assistant") {
        for (const block of msg.message?.content || []) {
          if (block.type === "text") reply += block.text;
        }
      } else if (msg.type === "result") {
        if (msg.is_error) {
          const detail = typeof msg.result === "string" && msg.result ? msg.result : msg.subtype;
          throw new Error(`Claude returned an error: ${detail}`);
        }
        if (typeof msg.result === "string" && msg.result) reply = msg.result;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return { reply: reply.trim(), sessionId: newSessionId };
}

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, auth: authMode(), model: MODEL });
});

app.post("/chat", async (req, res) => {
  if (!safeEqual(req.get("x-backend-secret") || "", BACKEND_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;

  if (!message) return res.status(400).json({ error: "message is required" });
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `message is longer than ${MAX_MESSAGE_CHARS} characters` });
  }

  try {
    let result;
    try {
      result = await askClaude(message, sessionId);
    } catch (err) {
      // Render's disk is wiped on restart/redeploy, so old sessions can vanish.
      if (!sessionId) throw err;
      console.warn("[chat] resume failed, starting a new session:", err.message);
      result = await askClaude(message, null);
    }
    res.json(result);
  } catch (err) {
    console.error("[chat] failed:", err);
    res.status(502).json({ error: err.message || "Claude request failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Claude chat backend on http://localhost:${PORT}`);
  console.log(`Auth mode: ${authMode()} | Model: ${MODEL}`);
});
