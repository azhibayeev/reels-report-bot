import fs from "node:fs";
import { list } from "@vercel/blob";

// ── Разовая рассылка КОММЕНТА от имени @daristeppe под рилсы, где призыв писать "Ikut".
// IG API НЕ умеет менять подпись у опубликованного поста (только владелец вручную).
// Поэтому под каждый такой рилс постим коммент, который уводит на ссылку в шапке профиля.
//
// Запуск (из папки ig-dm-bot):
//   node --env-file=.env.local comment-bio.mjs --dry            # показать цели, ничего не постить
//   node --env-file=.env.local comment-bio.mjs --limit 1        # тест: 1 рилс (канарейка)
//   node --env-file=.env.local comment-bio.mjs                  # все оставшиеся цели
//   ALL=1 node --env-file=.env.local comment-bio.mjs --dry      # цель = ВСЕ 155 рилсов, а не только 28 с ikut

const IG = "https://graph.instagram.com/v21.0";
const META = "../reels-meta.json";
const STATE = "comment-bio-state.json";
const BLOB_KEY = "ig-token.json";
const DELAY_MS = parseInt(process.env.DELAY_MS || "6000", 10); // пауза между коммами, чтобы не словить спам-флаг
const DRY = process.argv.includes("--dry");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();
const ALL = process.env.ALL === "1"; // постить под все рилсы, не только с "ikut"

// Текст коммента — уводим на ссылку в шапке профиля (bio), НЕ на лид-магнит "Ikut"
const COMMENT =
  process.env.COMMENT_TEXT ||
  'Ingin ikut program "30 Days Quran Challenge" khatam Al-Qur’an bersama? 📖\n' +
  "Link pendaftaran ada di BIO 👆 Klik profil kami dan daftar sekarang. InsyaAllah 🤲";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (() => { try { return new Set(JSON.parse(fs.readFileSync(STATE))); } catch { return new Set(); } })();
const save = () => fs.writeFileSync(STATE, JSON.stringify([...state]));

async function gj(url, opts) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, opts); const j = await r.json();
    if (j.error && (j.error.is_transient || j.error.code === 2)) { await sleep(2000 * (i + 1)); continue; }
    return j;
  }
  return { error: { message: "retries exhausted" } };
}

async function getToken() {
  if (process.env.IG_TOKEN) return process.env.IG_TOKEN;
  const { blobs } = await list({ prefix: BLOB_KEY });
  const b = blobs.find((x) => x.pathname === BLOB_KEY);
  if (!b) throw new Error("нет ig-token.json в Blob и нет env IG_TOKEN");
  const j = await (await fetch(b.url, { cache: "no-store" })).json();
  if (!j.access_token) throw new Error("в blob нет access_token");
  return j.access_token;
}

async function postComment(token, mediaId) {
  return gj(`${IG}/${mediaId}/comments?message=${encodeURIComponent(COMMENT)}&access_token=${token}`, { method: "POST" });
}

async function main() {
  const all = JSON.parse(fs.readFileSync(META, "utf8"));
  const reels = all.filter((m) => m.media_product_type === "REELS" || /\/reel\//.test(m.permalink || ""));
  // Точная сигнатура лид-магнита: закавыченное «Ikut» (то самое слово, что просят написать в комменты).
  // Так не цепляем «mengikuti/berikut» (ikut внутри слова) и «Tulis nama Allah» (другой призыв, без "Ikut").
  const isLead = (m) => /[“"”'‘’]\s*ikut\s*[“"”'‘’]/i.test(m.caption || "");
  let targets = ALL ? reels : reels.filter(isLead);
  targets = targets.filter((m) => !state.has(m.id)); // уже прокомменченные пропускаем

  console.log(`Рилсов всего: ${reels.length} | цель (${ALL ? "ВСЕ" : "с Ikut"}): ${targets.length} | уже сделано: ${state.size}`);
  console.log(`Текст коммента:\n---\n${COMMENT}\n---`);
  if (LIMIT !== Infinity) console.log(`ЛИМИТ этого прогона: ${LIMIT}`);

  const token = DRY ? null : await getToken();
  let ok = 0, fail = 0, n = 0, streak = 0;
  for (const m of targets) {
    if (n >= LIMIT) break;
    n++;
    if (DRY) { console.log(`DRY ${m.permalink}  «${(m.caption || "").slice(0, 40).replace(/\n/g, " ")}…»`); continue; }
    const r = await postComment(token, m.id);
    if (r.error) {
      console.log(`FAIL ${m.permalink} #${r.error.code} ${r.error.message}`); fail++; streak++;
      if (streak >= 3) { console.log("!! 3 ошибки подряд — вероятно спам-блок IG. СТОП, остальное не трогаю."); break; }
    } else { console.log(`OK   ${m.permalink}  comment_id=${r.id}`); ok++; streak = 0; state.add(m.id); save(); }
    await sleep(DELAY_MS);
  }
  if (!DRY) console.log(`ИТОГ: запостано=${ok} ошибок=${fail}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
