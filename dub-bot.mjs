import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

// ── Бот дубляжа: кидаешь видео в личку → он отдаёт то же видео с индонезийской озвучкой.
// Под капотом ElevenLabs Dubbing API (ru → id): он сам расшифровывает речь, переводит,
// синтезирует голос и сводит обратно с видео — своей сборки из Scribe/TTS/ffmpeg здесь нет.
//
// ЗАПАСНОЙ ВАРИАНТ. С 24.08 бот живёт на Vercel (app/api/dub/*, крон /api/dub/poll),
// и на токене стоит вебхук. Long polling с вебхуком несовместим: getUpdates будет
// отвечать 409, пока вебхук не снят —
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
//
// Обход лимита в 20 МБ — страница /dub/<токен> с заливкой прямо в Blob — есть
// только на Vercel: здесь тяжёлый ролик по-прежнему получит только объяснение.
//
// Запуск:
//   TG_DUB_TOKEN='...' ELEVENLABS_API_KEY='...' node dub-bot.mjs
//   nohup env TG_DUB_TOKEN='...' ELEVENLABS_API_KEY='...' node dub-bot.mjs >> dub-bot.log 2>&1 &
//
// Необязательное:
//   TG_ALLOWED_CHAT_IDS='123,456'  — принимать только от этих чатов (по умолчанию от всех)
//   DUB_WATERMARK=1                — сразу с водяным знаком, не пробуя без него
//   DUB_SPEAKERS=0                 — автоопределение числа голосов (по умолчанию 1)

const TOKEN = need("TG_DUB_TOKEN");
const XI_KEY = need("ELEVENLABS_API_KEY");
const ALLOWED = (process.env.TG_ALLOWED_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const SPEAKERS = process.env.DUB_SPEAKERS ?? "1";
const FORCE_WATERMARK = process.env.DUB_WATERMARK === "1";

const SOURCE_LANG = "ru";
const TARGET_LANG = "id";

const XI = "https://api.elevenlabs.io/v1";
const TG = `https://api.telegram.org/bot${TOKEN}`;
const TG_FILE = `https://api.telegram.org/file/bot${TOKEN}`;

// Телеграм не отдаёт ботам файлы больше 20 МБ и не принимает отправку больше 50 МБ —
// это лимиты Bot API, а не наши; обойти их из кода нельзя, только объяснить человеку.
const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const TG_UPLOAD_LIMIT = 50 * 1024 * 1024;

const OUT_DIR = "dubbed";
const STATE = "dub-bot-state.json";
const POLL_MS = 10_000;
const DEADLINE_MS = 40 * 60 * 1000; // дольше ждать нечего: либо зависло, либо ролик неподъёмный

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Нет ${name} в окружении. Пример запуска — в шапке dub-bot.mjs`);
    process.exit(1);
  }
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...a);

// ── Telegram ────────────────────────────────────────────────────────────────

async function tg(method, payload = {}, timeoutMs = 30_000) {
  const res = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

async function tgUpload(method, form, timeoutMs = 600_000) {
  const res = await fetch(`${TG}/${method}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

const say = (chatId, text) => tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });

// Статус живёт в одном сообщении: правим его, а не засыпаем чат строчками прогресса.
function statusLine(chatId, messageId) {
  let last = "";
  return async (text) => {
    if (text === last) return;
    last = text;
    try {
      await tg("editMessageText", { chat_id: chatId, message_id: messageId, text });
    } catch (e) {
      // Правка — не главное: если она сорвалась, дубляж всё равно должен доехать.
      log(`не смог обновить статус: ${e.message}`);
    }
  };
}

async function tgDownload(fileId) {
  const file = await tg("getFile", { file_id: fileId });
  const res = await fetch(`${TG_FILE}/${file.file_path}`, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`Не скачался файл из Telegram: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── ElevenLabs ──────────────────────────────────────────────────────────────

async function xi(pathname, init = {}) {
  const res = await fetch(`${XI}${pathname}`, {
    ...init,
    headers: { "xi-api-key": XI_KEY, ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeoutMs ?? 600_000),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`ElevenLabs ${pathname} → ${res.status}: ${body.slice(0, 400)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res;
}

async function createDub({ buffer, filename, url, name, watermark }) {
  const form = new FormData();
  if (buffer) form.append("file", new Blob([buffer], { type: "video/mp4" }), filename);
  else form.append("source_url", url);
  form.append("source_lang", SOURCE_LANG);
  form.append("target_lang", TARGET_LANG);
  form.append("num_speakers", SPEAKERS);
  form.append("watermark", String(watermark));
  form.append("name", name);

  const res = await xi("/dubbing", { method: "POST", body: form });
  return res.json(); // { dubbing_id, expected_duration_sec }
}

async function dubStatus(id) {
  const res = await xi(`/dubbing/${id}`, { timeoutMs: 30_000 });
  return res.json(); // { status: dubbing | dubbed | failed, error, media_metadata }
}

async function downloadDub(id) {
  const res = await xi(`/dubbing/${id}/audio/${TARGET_LANG}`);
  return Buffer.from(await res.arrayBuffer());
}

async function subscription() {
  const res = await xi("/user/subscription", { timeoutMs: 30_000 });
  const d = await res.json();
  return { tier: d.tier, used: d.character_count, limit: d.character_limit };
}

// ── Конвейер одной задачи ───────────────────────────────────────────────────

function sanitize(name) {
  return (name || "video").replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "video";
}

async function runDub(chatId, source) {
  const started = Date.now();
  const msg = await say(chatId, "Отправляю в ElevenLabs…");
  const status = statusLine(chatId, msg.message_id);

  // Водяной знак снимается только деньгами: на бесплатном тарифе watermark=false
  // возвращает 403 subscription_required. Пробуем чистый вариант, откатываемся на знак.
  let created;
  let watermarked = FORCE_WATERMARK;
  try {
    created = await createDub({ ...source, watermark: FORCE_WATERMARK });
  } catch (e) {
    if (!FORCE_WATERMARK && e.status === 403 && /subscription/i.test(e.body || "")) {
      watermarked = true;
      await status("Тариф не даёт снять водяной знак — дублирую со знаком…");
      created = await createDub({ ...source, watermark: true });
    } else throw e;
  }

  const id = created.dubbing_id;
  const eta = created.expected_duration_sec ? ` (примерно ${Math.ceil(created.expected_duration_sec)} с)` : "";
  log(`задача ${id} для чата ${chatId}${eta}`);
  await status(`Дублирую${eta}…`);

  for (;;) {
    if (Date.now() - started > DEADLINE_MS) throw new Error("ElevenLabs не закончил за 40 минут — задача брошена");
    await sleep(POLL_MS);
    const s = await dubStatus(id);
    if (s.status === "dubbed") break;
    if (s.status === "failed") throw new Error(`ElevenLabs не справился: ${s.error || "без объяснения"}`);
    await status(`Дублирую${eta}… ${Math.round((Date.now() - started) / 1000)} с`);
  }

  await status("Готово, забираю результат…");
  const dubbed = await downloadDub(id);

  // Кладём на диск в любом случае: так результат переживёт и падение отправки,
  // и ролик, который Telegram отказывается принимать по размеру.
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${sanitize(source.filename || source.name)}-id.mp4`);
  await fsp.writeFile(out, dubbed);
  log(`готово ${id} → ${out} (${(dubbed.length / 1024 / 1024).toFixed(1)} МБ)`);

  const note = watermarked ? "\n⚠️ с водяным знаком ElevenLabs" : "";
  if (dubbed.length > TG_UPLOAD_LIMIT) {
    await status(
      `Готово, но ${(dubbed.length / 1024 / 1024).toFixed(0)} МБ — больше 50 МБ, ` +
        `Telegram не даст боту отправить.\nФайл лежит здесь: ${path.resolve(out)}${note}`
    );
    return;
  }

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", new Blob([dubbed], { type: "video/mp4" }), path.basename(out));
  form.append("caption", `Bahasa Indonesia 🇮🇩${note}`);
  form.append("supports_streaming", "true");
  await tgUpload("sendVideo", form);
  await tg("deleteMessage", { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
}

// ── Разбор входящих ─────────────────────────────────────────────────────────

const HELP =
  "Кидай сюда видео (или аудио) на русском — верну его же с индонезийской озвучкой.\n\n" +
  "• Telegram не отдаёт ботам файлы больше 20 МБ. Если ролик тяжелее — пришли ссылку " +
  "на него текстом, ElevenLabs скачает сам.\n" +
  "• /balance — остаток кредитов ElevenLabs.";

async function handle(msg) {
  const chatId = msg.chat.id;
  if (ALLOWED.length && !ALLOWED.includes(String(chatId))) {
    log(`чужой чат ${chatId} — игнор`);
    return;
  }

  const text = (msg.text || "").trim();

  if (/^\/(start|help)/.test(text)) return void (await say(chatId, HELP));

  if (/^\/balance/.test(text)) {
    const s = await subscription();
    return void (await say(chatId, `Тариф ${s.tier}: ${s.used} из ${s.limit} кредитов израсходовано.`));
  }

  const media =
    msg.video ||
    msg.audio ||
    msg.voice ||
    msg.video_note ||
    (/^(video|audio)\//.test(msg.document?.mime_type || "") ? msg.document : null);

  if (media) {
    if (media.file_size > TG_DOWNLOAD_LIMIT) {
      return void (await say(
        chatId,
        `Ролик ${(media.file_size / 1024 / 1024).toFixed(0)} МБ, а Telegram не отдаёт ботам больше 20 МБ.\n` +
          "Пришли ссылку на файл текстом — ElevenLabs скачает его сам, — или сожми ролик."
      ));
    }
    const filename = media.file_name || `video-${media.file_unique_id}.mp4`;
    await say(chatId, "Забираю файл…");
    const buffer = await tgDownload(media.file_id);
    return void (await runDub(chatId, { buffer, filename, name: filename }));
  }

  if (/^https?:\/\//i.test(text)) {
    const url = text.split(/\s+/)[0];
    return void (await runDub(chatId, { url, name: url.slice(-60), filename: url.split("/").pop() }));
  }

  await say(chatId, HELP);
}

// ── Цикл опроса ─────────────────────────────────────────────────────────────

function loadOffset() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8")).offset || 0;
  } catch {
    return 0;
  }
}

const saveOffset = (offset) => fs.writeFileSync(STATE, JSON.stringify({ offset }));

async function main() {
  const me = await tg("getMe");
  log(`@${me.username} запущен, ru → id`);
  let offset = loadOffset();

  for (;;) {
    let updates;
    try {
      updates = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }, 70_000);
    } catch (e) {
      log(`getUpdates: ${e.message}`);
      await sleep(3000);
      continue;
    }

    for (const u of updates) {
      // Сдвигаем offset до обработки: иначе ролик, на котором бот упал,
      // будет прилетать заново каждый рестарт.
      offset = u.update_id + 1;
      saveOffset(offset);
      if (!u.message) continue;
      // Не ждём завершения: дубляж идёт минутами, а бот должен оставаться живым.
      handle(u.message).catch(async (e) => {
        log(`ошибка: ${e.stack || e.message}`);
        await say(u.message.chat.id, `Не вышло: ${e.message}`).catch(() => {});
      });
    }
  }
}

main().catch((e) => {
  log(`упал: ${e.stack || e.message}`);
  process.exit(1);
});
