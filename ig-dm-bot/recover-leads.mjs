import fs from "node:fs";

// ── Разовая рассылка по УЖЕ собранным комментам (окно private reply = 7 дней).
// Читаем историю комментов Facebook-токеном (IG-Login API историю не отдаёт),
// шлём опенинг-DM с кнопкой через IG-Login токен → человек попадает в тот же follow-gate.
//
// Запуск:
//   FB_TOKEN='EAA...' IG_TOKEN='IGAA...' node recover-leads.mjs --dry     # показать кого заденем
//   FB_TOKEN='EAA...' IG_TOKEN='IGAA...' node recover-leads.mjs           # реально разослать

const FB = "https://graph.facebook.com/v21.0";
const IG = "https://graph.instagram.com/v21.0";
const FB_TOKEN = process.env.FB_TOKEN;
const IG_TOKEN = process.env.IG_TOKEN;
const IG_USER = "17841413773053161";
const KW_WORDS = (process.env.RECOVER_KEYWORDS || "ikut").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const KW = new RegExp(`(^|[^a-z])(${KW_WORDS.join("|")})([^a-z]|$)`, "i");
const WINDOW_DAYS = 7;
const DELAY_MS = 4000;
const STATE = "recover-state.json";
const DRY = process.argv.includes("--dry");

const OPENING = "Assalamu'alaikum! Seneng banget kamu di sini 😊\n\nTap tombol di bawah ya, link-nya langsung aku kirimin ✨";
const BTN = { content_type: "text", title: "Kirim link-nya 🔗", payload: "GET_LINK" };

const state = (() => { try { return new Set(JSON.parse(fs.readFileSync(STATE))); } catch { return new Set(); } })();
const save = () => fs.writeFileSync(STATE, JSON.stringify([...state]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gj(url, opts) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, opts); const j = await r.json();
    if (j.error && (j.error.is_transient || j.error.code === 2)) { await sleep(2000 * (i + 1)); continue; }
    return j;
  }
  return { error: { message: "retries exhausted" } };
}

async function sendOpening(commentId) {
  return gj(`${IG}/me/messages?access_token=${IG_TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: OPENING, quick_replies: [BTN] } }),
  });
}

async function main() {
  if (!FB_TOKEN || !IG_TOKEN) { console.error("нужны FB_TOKEN и IG_TOKEN"); process.exit(1); }
  // необязательный фильтр по конкретным рилсам (shortcodes через запятую)
  const TARGETS = (process.env.TARGETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const scOf = (u) => (u || "").match(/\/reel\/([^/?]+)/)?.[1] || (u || "").match(/\/p\/([^/?]+)/)?.[1] || "";

  // список медиа (FB API)
  const media = [];
  let url = `${FB}/${IG_USER}/media?fields=id,permalink,timestamp,comments_count&limit=50&access_token=${FB_TOKEN}`;
  while (url) {
    const j = await gj(url); if (j.error) { console.error("MEDIA", j.error.message); break; }
    for (const m of j.data || []) {
      const age = (Date.now() - new Date(m.timestamp).getTime()) / 86400000;
      if (TARGETS.length && !TARGETS.includes(scOf(m.permalink))) continue;
      if (age <= WINDOW_DAYS && (m.comments_count || 0) > 0) media.push(m);
    }
    // если самый старый пост уже за окном — дальше можно не идти
    const oldest = (j.data || [])[j.data.length - 1];
    if (oldest && (Date.now() - new Date(oldest.timestamp).getTime()) / 86400000 > WINDOW_DAYS) break;
    url = j.paging?.next;
  }
  console.log(`медиа в окне ${WINDOW_DAYS}д: ${media.length}`);

  const targets = [];
  for (const m of media) {
    let cu = `${FB}/${m.id}/comments?fields=id,text,username,timestamp,replies.limit(100){id,text,username,timestamp}&limit=50&access_token=${FB_TOKEN}`;
    while (cu) {
      const j = await gj(cu); if (j.error) { console.error("COMMENTS", j.error.message); break; }
      for (const c of j.data || []) {
        const all = [c, ...((c.replies?.data) || [])];
        for (const x of all) {
          const age = (Date.now() - new Date(x.timestamp).getTime()) / 86400000;
          if (age <= WINDOW_DAYS && KW.test(x.text || "") && !state.has(x.id)) targets.push(x);
        }
      }
      cu = j.paging?.next;
    }
  }
  // уник по comment_id
  const uniq = [...new Map(targets.map((t) => [t.id, t])).values()];
  console.log(`целей (Ikut/halal, в окне, не отправлено): ${uniq.length}${DRY ? " | DRY" : ""}`);

  let ok = 0, fail = 0;
  for (const t of uniq) {
    if (DRY) { console.log(`DRY @${t.username} "${(t.text || "").slice(0, 25)}"`); continue; }
    const r = await sendOpening(t.id);
    if (r.error) { console.log(`FAIL @${t.username} #${r.error.code} ${r.error.message}`); fail++; }
    else { console.log(`OK @${t.username}`); ok++; }
    state.add(t.id); save();
    await sleep(DELAY_MS);
  }
  console.log(`ИТОГ: отправлено=${ok} ошибок=${fail} всего_целей=${uniq.length}`);
}
main();
