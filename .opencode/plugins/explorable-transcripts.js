// explorable-transcripts-v1: project-local completion and recovery hooks.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const python = "/opt/homebrew/opt/python@3.14/bin/python3.14"; // configured by startup
const root = fileURLToPath(new URL("../../", import.meta.url));
const runner = fileURLToPath(new URL("../../explorables/tools/transcript_hooks.py", import.meta.url));

const server = async ({ client } = {}) => {
  const running = new Map();
  const run = (session, event, prompt) => new Promise((resolve) => {
    const child = spawn(python, ["-B", runner, "--harness", "opencode", "--event", event],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"], timeout: 85000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.on("error", (error) => { stderr += error.message; });
    child.on("close", async (code) => {
      let warning;
      try { warning = JSON.parse(stdout).systemMessage; }
      catch { warning = stderr || "Transcript hook returned no result."; }
      if (code || warning) {
        const message = warning || stderr || "Transcript hook failed; run transcript_hooks.py --recover PAPER.";
        // Surface failures without throwing into OpenCode's event loop.
        try { await client?.app?.log({ body: { service: "explorable-transcripts", level: "warn", message } }); }
        catch { /* The durable Python state still prevents a stale submission. */ }
        try { await client?.tui?.showToast({ body: { title: "Transcript save pending", message, variant: "warning" } }); }
        catch { /* Some clients do not have a TUI. */ }
      }
      resolve();
    });
    child.stdin.end(JSON.stringify({ session_id: session, prompt_id: prompt }));
  });
  return {
    "shell.env": async (input, output) => {
      if (input.sessionID) output.env.T4G_OPENCODE_SESSION_ID = input.sessionID;
    },
    event: async ({ event }) => {
      let session, phase, prompt;
      if (event.type === "session.idle" || event.type === "session.error") {
        session = event.properties?.sessionID;
        phase = event.type === "session.idle" ? "Stop" : "StopFailure";
      } else if (event.type === "message.updated" && event.properties?.info?.role === "user") {
        session = event.properties.info.sessionID;
        prompt = event.properties.info.id;
        phase = "UserPromptSubmit";
      }
      if (!session) return;
      // Preserve event ordering per conversation, even when delivery overlaps.
      const work = (running.get(session) || Promise.resolve()).then(() => run(session, phase, prompt));
      running.set(session, work);
      await work;
      if (running.get(session) === work) running.delete(session);
    },
  };
};

export default { id: "explorable-transcripts", server };
