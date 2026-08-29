import fs from "node:fs";

// ── DM-бот: ловит кодовое слово в комментах рилсов → публичный ответ + приватный DM со ссылкой.
// Механизм DM = Instagram Private Replies (то же, что использует ManyChat под капотом).
//
// ТРЕБУЕТ у токена скоуп: instagram_basic, instagram_manage_comments, instagram_manage_messages.
// Без instagram_manage_messages публичный ответ пойдёт, а DM вернёт ошибку #10/#200 (нет прав).
//
// Запуск:
//   EAATOK='...' node dm-bot.mjs --recover     # разослать по УЖЕ собранным комментам (окно 7 дней)
//   EAATOK='...' node dm-bot.mjs               # один проход по свежим комментам (для cron)
//   EAATOK='...' node dm-bot.mjs --dry         # ничего не отправлять, только показать кого бы задел
//   EAATOK='...' node dm-bot.mjs --test <comment_id>   # тест DM+reply на один конкретный коммент

const B = "https://graph.facebook.com/v21.0";
const TOKEN = process.env.EAATOK;
const IG = "17841413773053161"; // @daristeppe
const KEYWORD = /(^|[^a-z])ikut([^a-z]|$)/i; // "Ikut" как отдельное слово
const LINK = "https://t.me/+an5ULC0h7r41NmJi";
const STATE = "dm-bot-state.json";       // дедуп: какие comment_id уже обработаны
const LOG = "dm-bot.log";
const PRIVATE_REPLY_WINDOW_DAYS = 7;     // IG разрешает private reply в течение 7 дней после коммента
const SEND_DELAY_MS = 4000;              // троттлинг, чтобы IG не счёл спамом
const LOOKBACK_MEDIA = 25;              // сколько последних постов сканировать

const DRY = process.argv.includes("--dry");
const RECOVER = process.argv.includes("--recover");
const TEST_ID = (() => { const i = process.argv.indexOf("--test"); return i > -1 ? process.argv[i + 1] : null; })();

// Публичный ответ под комментом (варианты — как в ManyChat)
const PUBLIC_REPLIES = [
  "Terima kasih! Silakan cek DM ya. 📩",       // Спасибо! Проверь DM
  "Sudah saya kirim pesannya! Silakan dicek!", // Уже отправил сообщение! Проверь
  "Mantap! Cek DM-nya ya! ✨",                  // Отлично! Проверь DM
];
// Текст DM (ссылка сразу, без follow-gate)
const DM_TEXT =
  "Assalamu'alaikum! 😊 Ini link yang kamu minta ya 👇\n" +
  LINK +
  "\nSemoga bermanfaat! ❤️"; // Мир тебе! Вот ссылка, что ты просил. Пусть будет полезно!

function log(...a) { const line = `[${new Date().toISOString()}] ${a.join(" ")}`; console.log(line); fs.appendFileSync(LOG, line + "\n"); }
const loadState = () => { try { return new Set(JSON.parse(fs.readFileSync(STATE, "utf8"))); } catch { return new Set(); } };
const saveState = (set) => fs.writeFileSync(STATE, JSON.stringify([...set], null, 0));

async function gj(url, opts) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url, opts);
      const body = await res.json();
      if (body.error) {
        const c = body.error.code;
        if (body.error.is_transient || c === 4 || c === 17 || c === 32 || c === 2 || c === 613) {
          await new Promise((r) => setTimeout(r, 2500 * (i + 1))); continue;
        }
        return { error: body.error };
      }
      return { body };
    } catch (e) {
      if (i === 5) return { error: { message: e.message } };
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return { error: { message: "retries exhausted" } };
}

// приватный ответ (DM) на коммент — нужен instagram_manage_messages
async function sendDM(commentId) {
  const url = `${B}/${IG}/messages?access_token=${encodeURIComponent(TOKEN)}`;
  return gj(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: DM_TEXT } }),
  });
}
// публичный ответ под комментом — нужен instagram_manage_comments
async function replyPublic(commentId) {
  const msg = PUBLIC_REPLIES[Math.floor(Date.now() / 1000) % PUBLIC_REPLIES.length];
  const url = `${B}/${commentId}/replies?message=${encodeURIComponent(msg)}&access_token=${encodeURIComponent(TOKEN)}`;
  return gj(url, { method: "POST" });
}

async function handleComment(c, state, stats) {
  if (state.has(c.id)) return;                       // уже обработан
  if (!KEYWORD.test(c.text || "")) return;           // не то слово
  const ageDays = (Date.now() - new Date(c.timestamp).getTime()) / 86400000;
  if (ageDays > PRIVATE_REPLY_WINDOW_DAYS) { stats.expired++; return; } // окно 7 дней закрыто

  stats.matched++;
  if (DRY) { log(`DRY  @${c.username} "${(c.text||"").slice(0,30)}" age=${ageDays.toFixed(1)}d`); return; }

  const dm = await sendDM(c.id);
  if (dm.error) { log(`DM  FAIL @${c.username} #${dm.error.code} ${dm.error.message}`); stats.dmFail++; }
  else { log(`DM  OK   @${c.username}`); stats.dmOk++; }

  const pub = await replyPublic(c.id);
  if (pub.error) log(`REPLY FAIL @${c.username} #${pub.error.code} ${pub.error.message}`);

  state.add(c.id); saveState(state);
  await new Promise((r) => setTimeout(r, SEND_DELAY_MS)); // троттлинг
}

async function eachCommentOfMedia(mediaId, cb) {
  let url = `${B}/${mediaId}/comments?fields=id,text,username,timestamp,replies.limit(100){id,text,username,timestamp}&limit=50&access_token=${encodeURIComponent(TOKEN)}`;
  while (url) {
    const { body, error } = await gj(url);
    if (error) { log("COMMENTS ERR", JSON.stringify(error)); break; }
    for (const c of body.data || []) {
      await cb(c);
      for (const r of (c.replies?.data || [])) await cb(r);
    }
    url = body.paging?.next;
  }
}

async function main() {
  if (!TOKEN) { console.error("нет EAATOK в окружении"); process.exit(1); }
  const state = loadState();
  const stats = { matched: 0, dmOk: 0, dmFail: 0, expired: 0 };

  if (TEST_ID) {
    log(`TEST на комменте ${TEST_ID}`);
    const dm = await sendDM(TEST_ID);
    log("DM:", JSON.stringify(dm.error || dm.body));
    const pub = await replyPublic(TEST_ID);
    log("REPLY:", JSON.stringify(pub.error || pub.body));
    return;
  }

  // список последних постов
  const { body, error } = await gj(`${B}/${IG}/media?fields=id,timestamp,comments_count&limit=${LOOKBACK_MEDIA}&access_token=${encodeURIComponent(TOKEN)}`);
  if (error) { log("MEDIA ERR", JSON.stringify(error)); process.exit(1); }
  const media = (body.data || []).filter((m) => (m.comments_count || 0) > 0);
  log(`${RECOVER ? "RECOVER" : "POLL"} режим | постов с комментами: ${media.length}${DRY ? " | DRY-RUN" : ""}`);

  for (const m of media) {
    await eachCommentOfMedia(m.id, (c) => handleComment(c, state, stats));
  }
  log(`ИТОГ: подошло=${stats.matched} DM_ok=${stats.dmOk} DM_fail=${stats.dmFail} вне_окна(>7д)=${stats.expired}`);
}

main();
