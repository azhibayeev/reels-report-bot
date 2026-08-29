import fs from "node:fs";

// ── Клиент к ChatPlace MCP по HTTP. Тем же кабинетом рулит воронка «JOIN → Sahabat Qurany».
//
// Ключ берётся из CHATPLACE_KEY или из .superpowers/chatplace-key.txt (файл вне гита).
//
// Запуск:
//   node chatplace.mjs bots_list
//   node chatplace.mjs automations_list '{"botId":"..."}'
//   node chatplace.mjs --tools comment        # найти инструменты по подстроке
//   node chatplace.mjs --schema comments_create,automations_quick_setup

const URL = "https://mcp.chatplace.io/mcp";

export function key() {
  const k = process.env.CHATPLACE_KEY || (fs.existsSync(".superpowers/chatplace-key.txt")
    ? fs.readFileSync(".superpowers/chatplace-key.txt", "utf8").trim() : null);
  if (!k) throw new Error("нет ключа: CHATPLACE_KEY или .superpowers/chatplace-key.txt");
  return k;
}

export class ChatPlace {
  constructor(k = key()) { this.key = k; this.sid = null; }

  async #rpc(method, params, id = Math.floor(Math.random() * 1e6)) {
    const headers = {
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sid) headers["mcp-session-id"] = this.sid;
    const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!this.sid && res.headers.get("mcp-session-id")) this.sid = res.headers.get("mcp-session-id");
    const text = await res.text();
    if (!text) return null;
    // сервер умеет отвечать и как SSE, и как обычный JSON
    if (text.startsWith("event:") || text.includes("\ndata: ")) {
      const line = text.split("\n").find((l) => l.startsWith("data: "));
      return line ? JSON.parse(line.slice(6)) : null;
    }
    return JSON.parse(text);
  }

  async connect() {
    await this.#rpc("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "qurany", version: "1.0" },
    }, 1);
    await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`, "Content-Type": "application/json",
        Accept: "application/json, text/event-stream", "mcp-session-id": this.sid,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    return this;
  }

  async tools() { return (await this.#rpc("tools/list", {})).result.tools || []; }

  // Возвращает распарсенный результат инструмента. Текстовый ответ, если это JSON, отдаётся объектом.
  async call(name, args = {}) {
    const r = await this.#rpc("tools/call", { name, arguments: args });
    if (r?.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
    const parts = (r?.result?.content || []).map((c) => (c.type === "text" ? c.text : JSON.stringify(c)));
    const text = parts.join("\n");
    if (r?.result?.isError) throw new Error(`${name}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  }
}

// ── CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b] = process.argv.slice(2);
  const cp = await new ChatPlace().connect();
  if (a === "--tools") {
    const list = (await cp.tools()).filter((t) => !b || t.name.includes(b));
    console.log(`инструментов: ${list.length}\n`);
    for (const t of list) console.log("  " + t.name.padEnd(44) + " — " + String(t.description || "").split("\n")[0].slice(0, 90));
  } else if (a === "--schema") {
    const want = new Set((b || "").split(","));
    for (const t of (await cp.tools()).filter((t) => want.has(t.name))) {
      console.log("\n===== " + t.name + "\n" + (t.description || "").trim());
      console.log("аргументы: " + JSON.stringify(t.inputSchema, null, 1));
    }
  } else if (a) {
    const out = await cp.call(a, b ? JSON.parse(b) : {});
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
  } else {
    console.log("usage: node chatplace.mjs <tool> '<json>' | --tools [filter] | --schema a,b");
  }
}
