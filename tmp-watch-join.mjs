// Наблюдение за воронкой JOIN: ловит новые комменты со словом, проверяет,
// появился ли под ними публичный ответ аккаунта, и смотрит счётчик входов в ChatPlace.
// Печатает строку только когда есть что сказать — каждая строка станет уведомлением.
import { list } from "@vercel/blob";
import crypto from "node:crypto";
import fs from "node:fs";
import { ChatPlace } from "./chatplace.mjs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}
const key = crypto.createHash("sha256").update(fs.readFileSync(".superpowers/cron-secret.txt", "utf8").trim()).digest();
const { blobs } = await list({ prefix: "state/" });
const blob = blobs.find((x) => x.pathname === "state/fb-token.enc");
const enc = Buffer.from((await (await fetch(blob.url)).text()).trim(), "base64");
const dec = crypto.createDecipheriv("aes-256-gcm", key, enc.subarray(0, 12));
dec.setAuthTag(enc.subarray(12, 28));
const s = Buffer.concat([dec.update(enc.subarray(28)), dec.final()]).toString("utf8").trim();
const TOKEN = s.startsWith("{") ? (JSON.parse(s).token || JSON.parse(s).access_token) : s;

const B = "https://graph.facebook.com/v21.0";
const IG = "17841413773053161";
const AUT = "01a03951-e530-7327-88af-f95953fab8ef";
const gj = async (u) => { try { return await (await fetch(u)).json(); } catch { return {}; } };
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const cp = await new ChatPlace().connect();
const START = Date.now();
const seen = new Set();
let lastClients = null;

async function tick() {
  // 1. свежие комменты со словом JOIN
  const media = (await gj(`${B}/${IG}/media?fields=id,permalink,comments_count&limit=25&access_token=${encodeURIComponent(TOKEN)}`)).data || [];
  for (const m of media.filter((m) => m.comments_count > 0)) {
    const c = await gj(`${B}/${m.id}/comments?fields=text,username,timestamp,replies{text,username}&limit=25&access_token=${encodeURIComponent(TOKEN)}`);
    for (const x of c.data || []) {
      if (!/join/i.test(x.text || "")) continue;
      if (Date.parse(x.timestamp) < START - 10 * 60 * 1000) continue; // только то, что появилось около запуска
      const replies = (x.replies && x.replies.data) || [];
      const ours = replies.find((r) => r.username === "daristeppe");
      const k = x.id + ":" + (ours ? "replied" : "bare");
      if (seen.has(k)) continue;
      seen.add(k);
      say(`КОММЕНТ JOIN от @${x.username} — «${(x.text || "").slice(0, 40)}» ${m.permalink}`);
      if (ours) say(`  ПУБЛИЧНЫЙ ОТВЕТ ЕСТЬ: «${(ours.text || "").slice(0, 70)}»`);
    }
  }
  // 2. счётчик входов в воронку
  try {
    const a = await cp.call("automations_quick_setup_analytics", { automationId: AUT });
    const n = a?.clientsStatistic?.total ?? 0;
    const msgs = a?.botMessagesStatistic?.total ?? 0;
    const clicks = a?.buttonsStatistic?.total ?? 0;
    const sig = `${n}/${msgs}/${clicks}`;
    if (lastClients !== null && sig !== lastClients) say(`ВОРОНКА: вошло ${n}, отправлено ботом ${msgs}, кликов ${clicks}`);
    lastClients = sig;
  } catch (e) { say("аналитика недоступна:", String(e.message).slice(0, 80)); }
}

say(`наблюдение включено; воронка Active, слово JOIN`);
while (true) { await tick(); await new Promise((r) => setTimeout(r, 60000)); }
