// src/cli.mjs
import { readFile, writeFile, mkdir, unlink, rmdir, open as openFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

// src/version.mjs
var VERSION = false ? "0.4.1-dev" : "0.4.1";
var BUILD_ID = false ? "development" : "3e17ff92b487d8b5de99";
var SERVICE = "character-studio";

// src/cli.mjs
var root = path.resolve(process.env.CHARACTER_STUDIO_HOME || path.join(os.homedir(), ".character-studio"));
var homeId = createHash("sha256").update(root).digest("hex");
var args = process.argv.slice(2);
var command = args.shift() || "help";
var flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) throw Error("\u53C2\u6570\u9700\u8981\u4EE5 -- \u5F00\u5934");
  const key = args[i].slice(2);
  if (flags[key] !== void 0) throw Error("\u91CD\u590D\u53C2\u6570\uFF1A" + key);
  flags[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
}
var output = (data) => process.stdout.write(JSON.stringify(data) + "\n");
var alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
var serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
function endpoint(port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw Error("\u65E0\u6548\u7684\u672C\u673A\u7AEF\u53E3");
  return "http://127.0.0.1:" + Number(port);
}
async function health(port) {
  try {
    const r = await fetch(endpoint(port) + "/api/health", { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return null;
    const h = await r.json();
    return h.service === SERVICE && h.homeId === homeId && h.buildId === BUILD_ID && h.features?.includes("agent-cli-v1") ? { ...h, port: Number(port) } : null;
  } catch {
    return null;
  }
}
async function discover() {
  try {
    const d = JSON.parse(await readFile(path.join(root, "service.json"), "utf8"));
    const h = await health(d.port);
    if (h) return h;
  } catch {
  }
  return flags.port ? health(flags.port) : health(43127);
}
async function withLaunchLock(fn) {
  await mkdir(root, { recursive: true });
  const lock = path.join(root, ".launch-lock"), owner = path.join(lock, "owner");
  let locked = false;
  for (let n = 0; n < 120; n++) {
    try {
      await mkdir(lock);
      await writeFile(owner, String(process.pid));
      locked = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        const pid = Number(await readFile(owner, "utf8"));
        if (pid && !alive(pid)) {
          await unlink(owner);
          await rmdir(lock);
        }
      } catch {
      }
      await delay(100);
    }
  }
  if (!locked) throw Error("\u5DE5\u4F5C\u53F0\u6B63\u5728\u542F\u52A8\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\uFF1B\u6CA1\u6709\u4FEE\u6539\u5BBF\u4E3B\u7684 MCP \u8BBE\u7F6E\u3002");
  try {
    return await fn();
  } finally {
    await unlink(owner).catch(() => {
    });
    await rmdir(lock).catch(() => {
    });
  }
}
async function launch(port) {
  const log = await openFile(path.join(root, "service.log"), "a");
  const child = spawn(process.execPath, [serverPath, "--http", "--port", String(port)], { detached: true, windowsHide: true, env: { ...process.env, CHARACTER_STUDIO_HOME: root }, stdio: ["ignore", "ignore", log.fd, "ipc"] });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(Error("\u5DE5\u4F5C\u53F0\u542F\u52A8\u8D85\u65F6\uFF0C\u8BF7\u8FD0\u884C doctor \u67E5\u770B\u72B6\u6001\u3002")), 15e3);
      const done = (error, value) => {
        clearTimeout(timer);
        child.removeAllListeners("message");
        child.removeAllListeners("error");
        child.removeAllListeners("exit");
        if (child.connected) child.disconnect();
        child.unref();
        error ? reject(error) : resolve(value);
      };
      child.once("error", (e) => done(e));
      child.once("exit", (code) => done(Error("\u5DE5\u4F5C\u53F0\u672A\u80FD\u542F\u52A8\uFF08" + code + "\uFF09\uFF0C\u8BF7\u67E5\u770B\u672C\u673A service.log\u3002")));
      child.on("message", (m) => {
        if (m?.service === SERVICE && m.homeId === homeId && m.buildId === BUILD_ID) done(null, m);
      });
    });
  } finally {
    await log.close();
  }
}
async function ensure() {
  const known = await discover();
  if (known) return known;
  return withLaunchLock(async () => {
    const existing = await discover();
    if (existing) return existing;
    let started;
    try {
      started = await launch(flags.port ? Number(flags.port) : 43127);
    } catch (error) {
      if (flags.port) throw error;
      started = await launch(0);
    }
    for (let n = 0; n < 30; n++) {
      const ready = await health(started.port);
      if (ready) return ready;
      await delay(100);
    }
    throw Error("\u7A0B\u5E8F\u5DF2\u542F\u52A8\uFF0C\u4F46\u672C\u673A\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA\u3002\u8BF7\u8FD0\u884C doctor \u67E5\u770B\u72B6\u6001\u3002");
  });
}
async function call(service, name, input = {}, timeout = 45e3) {
  let response;
  try {
    response = await fetch(endpoint(service.port) + "/api/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: input }), signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw Error("\u672C\u673A\u8FDE\u63A5\u5931\u8D25\uFF1A" + (e.cause?.code || e.message) + "\u3002\u4EFB\u52A1\u672A\u81EA\u52A8\u91CD\u8BD5\uFF0C\u8BF7\u68C0\u67E5\u5DE5\u4F5C\u53F0\u8FDE\u63A5\u3002");
  }
  const r = await response.json();
  if (!response.ok || r.isError) throw Error(r.error || r.content?.find((x) => x.type === "text")?.text || "\u5DE5\u4F5C\u53F0\u64CD\u4F5C\u5931\u8D25");
  return r.structuredContent;
}
async function sessionId() {
  if (typeof flags.session === "string") return flags.session;
  const file = path.join(root, "agent-session.json");
  try {
    return JSON.parse(await readFile(file, "utf8")).id;
  } catch {
  }
  const id = randomUUID();
  try {
    await writeFile(file, JSON.stringify({ id }), { flag: "wx" });
    return id;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    return JSON.parse(await readFile(file, "utf8")).id;
  }
}
async function openBrowser(url) {
  let executable, parameters;
  if (process.platform === "win32") {
    executable = "rundll32.exe";
    parameters = ["url.dll,FileProtocolHandler", url];
  } else if (process.platform === "darwin") {
    executable = "open";
    parameters = [url];
  } else {
    executable = "xdg-open";
    parameters = [url];
  }
  await new Promise((resolve, reject) => {
    const child = spawn(executable, parameters, { detached: true, windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
async function main() {
  if (command === "help") return output({ service: SERVICE, version: VERSION, commands: { open: "\u81EA\u52A8\u542F\u52A8\u5E76\u6253\u5F00\u5DE5\u4F5C\u53F0\uFF1B--no-browser \u53EF\u7531\u5BBF\u4E3B\u9762\u677F\u5C55\u793A", doctor: "\u68C0\u67E5\u672C\u673A\u670D\u52A1\uFF0C\u4E0D\u4FEE\u6539\u5BBF\u4E3B\u8FDE\u63A5", state: "\u8BFB\u53D6\u5DE5\u4F5C\u53F0\u72B6\u6001", wait: "--agent \u8C46\u5305\u5DE5\u4F5C --image-tool \u5B9E\u9645\u5DE5\u5177\u540D\uFF1B\u7B49\u5F85\u5E76\u9886\u53D6\u7528\u6237\u63D0\u4EA4\u7684\u4EFB\u52A1", claim: "\u624B\u52A8\u9886\u53D6\u4E0B\u4E00\u9879\uFF0C\u901A\u5E38\u4F7F\u7528 wait", result: "--task \u4EFB\u52A1ID\uFF0C\u914D\u5408 --file \u771F\u5B9E\u7ED3\u679C\u8DEF\u5F84\u6216 --error \u5931\u8D25\u539F\u56E0", disconnect: "\u7ED3\u675F\u5F53\u524D Agent \u7684\u8FDE\u63A5" }, note: "\u8FD9\u4E9B\u547D\u4EE4\u7531 Agent \u6267\u884C\uFF0C\u7528\u6237\u4E0D\u9700\u8981\u586B\u5199 MCP \u8BBE\u7F6E\u3002" });
  if (command === "doctor") {
    const service2 = await discover();
    return output({ service: SERVICE, version: VERSION, ready: !!service2, home: root, runtime: process.version, ...service2 ? { url: endpoint(service2.port), buildId: service2.buildId } : { message: "\u5C1A\u672A\u542F\u52A8\uFF0C\u8FD0\u884C open \u4F1A\u81EA\u52A8\u542F\u52A8\u3002" } });
  }
  if (!["open", "state", "wait", "claim", "ack", "result", "disconnect", "unavailable"].includes(command)) throw Error("\u672A\u77E5\u547D\u4EE4\uFF0C\u8BF7\u8FD0\u884C help\u3002");
  const service = await ensure();
  if (command === "open") {
    const current = await call(service, "get_state");
    const executor = flags.executor || (current.channelSetup ? "keep" : "agent");
    if (!["agent", "codex", "keep"].includes(executor)) throw Error("executor \u53EA\u80FD\u4E3A agent\u3001codex \u6216 keep");
    if (flags.host !== void 0 && flags.host !== "doubao") throw Error("host \u76EE\u524D\u53EA\u652F\u6301 doubao");
    await call(service, "open_workbench", executor === "keep" ? {} : { executor });
    const url = endpoint(service.port) + (flags.host === "doubao" ? "/?host=doubao" : "");
    if (!flags["no-browser"]) {
      try {
        await openBrowser(url);
      } catch {
        throw Error("\u5DE5\u4F5C\u53F0\u5DF2\u542F\u52A8\uFF0C\u4F46\u65E0\u6CD5\u81EA\u52A8\u6253\u5F00\u6D4F\u89C8\u5668\u3002\u8BF7\u6253\u5F00 " + url);
      }
    }
    const agentStep = flags.host === "doubao" ? "\u6309\u5B89\u88C5\u76EE\u5F55\u4E2D\u7684\u6280\u80FD\u5148\u5F15\u5BFC\u8FDE\u63A5\u6E20\u9053\u3002\u4F7F\u7528\u8C46\u5305\u65F6\u5148\u68C0\u67E5\u672C\u4F1A\u8BDD\u770B\u56FE\u3001\u751F\u56FE\u548C\u771F\u5B9E\u6587\u4EF6\u56DE\u586B\u80FD\u529B\uFF0C\u5EFA\u7ACB\u771F\u5B9E\u7B49\u5F85\uFF1B\u7F3A\u5C11\u5DE5\u5177\u7528 unavailable \u62A5\u544A\u539F\u56E0\u3002\u5DF2\u4FDD\u5B58\u7684\u5176\u4ED6\u6E20\u9053\u4FDD\u6301\u539F\u9009\u62E9\u3002\u63D0\u4EA4\u540E\u53EF\u53D1\u9001\u300C\u5904\u7406\u5DE5\u4F5C\u53F0\u91CC\u5F85\u751F\u6210\u7684\u56FE\u7247\u300D\u63A5\u624B\u6574\u6279\uFF1B\u6D4B\u8BD5\u56FE\u4F7F\u7528\u540C\u6837\u7684 wait/ack/result \u6D41\u7A0B\u3002" : "\u786E\u8BA4\u672C\u4F1A\u8BDD\u6709\u770B\u56FE\u3001\u751F\u56FE\u548C\u7ED3\u679C\u6587\u4EF6\u5DE5\u5177\u540E\uFF0C\u8FD0\u884C wait --follow --agent \u5BBF\u4E3B\u540D --image-tool \u5B9E\u9645\u5DE5\u5177\u540D\uFF0C\u4FDD\u6301\u7B49\u5F85\u7528\u6237\u63D0\u4EA4\u3002\u6CA1\u6709\u76F8\u5E94\u5DE5\u5177\u5219\u8FD0\u884C unavailable --reason \u5177\u4F53\u539F\u56E0\u3002";
    return output({ opened: true, url, browserRequested: !flags["no-browser"], version: VERSION, buildId: service.buildId, agentStep });
  }
  if (command === "state") return output(await call(service, "get_state"));
  if (command === "claim") return output(await call(service, "claim_next_task"));
  if (command === "ack") {
    if (typeof flags.task !== "string") throw Error("ack \u9700\u8981 --task \u4EFB\u52A1ID");
    return output(await call(service, "agent_ack_task", { taskId: flags.task }));
  }
  if (command === "result") {
    if (typeof flags.task !== "string" || typeof flags.file === "string" === (typeof flags.error === "string")) throw Error("result \u9700\u8981 --task\uFF0C\u4EE5\u53CA --file \u6216 --error \u4E2D\u7684\u4E00\u9879");
    return output(await call(service, "record_result", { taskId: flags.task, ...flags.file ? { filePath: path.resolve(flags.file) } : { error: flags.error } }));
  }
  const id = await sessionId();
  if (command === "disconnect") return output(await call(service, "agent_disconnect", { sessionId: id }));
  if (command === "unavailable") {
    if (typeof flags.reason !== "string") throw Error("\u9700\u8981 --reason \u8BF4\u660E\u7F3A\u5C11\u7684\u80FD\u529B");
    return output(await call(service, "agent_unavailable", { sessionId: id, reason: flags.reason }));
  }
  if (typeof flags.agent !== "string" || typeof flags["image-tool"] !== "string") throw Error("\u7B49\u5F85\u524D\u9700\u586B\u5199 --agent \u548C\u672C\u4F1A\u8BDD\u5B9E\u9645\u53EF\u7528\u7684 --image-tool \u540D\u79F0\uFF1B\u4E0D\u80FD\u51ED\u5BA2\u6237\u7AEF\u6709\u751F\u56FE\u6309\u94AE\u5BA3\u79F0\u5DF2\u63A5\u901A\u3002");
  const timeoutMs = flags.timeout ? Number(flags.timeout) * 1e3 : 45e3;
  const renew = flags.follow === true;
  for (; ; ) {
    const result = await call(service, "agent_wait", { sessionId: id, agentName: flags.agent, imageTool: flags["image-tool"], timeoutMs, renew }, timeoutMs + 1e5);
    if (!renew || result.reason !== "idle") return output(result);
  }
}
main().catch((error) => {
  output({ ok: false, error: error.message });
  process.exitCode = 1;
});
