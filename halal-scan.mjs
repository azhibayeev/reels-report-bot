import fs from "node:fs";

const B = "https://graph.facebook.com/v21.0";
const TOKEN = process.env.EAATOK;
const IG = "17841413773053161";
const LOG = "halal-scan.log";
const RE = /halal/i;

function log(...a) {
  const line = a.join(" ");
  fs.appendFileSync(LOG, line + "\n");
}
async function gj(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (body.error) {
        if (body.error.is_transient || body.error.code === 4 || body.error.code === 17 || body.error.code === 32 || body.error.code === 613) {
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        return { error: body.error };
      }
      return { body };
    } catch (e) {
      if (i === 4) return { error: { message: e.message } };
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return { error: { message: "retries exhausted" } };
}

// 1. all media
async function allMedia() {
  const out = [];
  let url = `${B}/${IG}/media?fields=id,permalink,media_product_type,caption,comments_count,like_count,timestamp&limit=100&access_token=${encodeURIComponent(TOKEN)}`;
  while (url) {
    const { body, error } = await gj(url);
    if (error) { log("MEDIA ERR", JSON.stringify(error)); break; }
    out.push(...(body.data || []));
    url = body.paging && body.paging.next;
  }
  return out;
}

// 2. all comments (top-level + replies) text for one media
async function commentsText(mediaId) {
  const texts = [];
  let url = `${B}/${mediaId}/comments?fields=text,username,replies.limit(50){text,username}&limit=50&access_token=${encodeURIComponent(TOKEN)}`;
  let pages = 0;
  while (url && pages < 3000) {
    pages++;
    const { body, error } = await gj(url);
    if (error) return { texts, error };
    for (const c of body.data || []) {
      texts.push({ text: c.text || "", username: c.username });
      for (const r of (c.replies && c.replies.data) || []) texts.push({ text: r.text || "", username: r.username });
    }
    url = body.paging && body.paging.next;
  }
  return { texts, error: null };
}

const media = await allMedia();
const reels = media.filter((m) => m.media_product_type === "REELS" || m.media_product_type === "FEED" || true);
log(`START total media=${media.length}`);
let scanned = 0, errs = 0, totalHalal = 0, totalComments = 0;
const perReel = [];
let idx = 0;
async function worker() {
  while (idx < media.length) {
    const m = media[idx++];
    const cc = m.comments_count || 0;
    if (cc === 0) { scanned++; perReel.push({ ...m, halal: 0, matched: [] }); continue; }
    const { texts, error } = await commentsText(m.id);
    if (error) { errs++; log(`ERR ${m.id}: ${JSON.stringify(error)}`); perReel.push({ ...m, halal: 0, matched: [], err: true }); continue; }
    scanned++;
    totalComments += texts.length;
    const matched = texts.filter((t) => RE.test(t.text));
    totalHalal += matched.length;
    perReel.push({ id: m.id, permalink: m.permalink, comments_count: cc, fetched: texts.length, halal: matched.length, matched: matched.slice(0, 5), caption: (m.caption || "").replace(/\s+/g, " ").slice(0, 60) });
    log(`ok ${scanned}/${media.length} cc=${cc} fetched=${texts.length} halal=${matched.length} runningHalal=${totalHalal}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

perReel.sort((a, b) => b.halal - a.halal);
log("=== RESULT ===");
log(`media scanned: ${scanned} | errors: ${errs}`);
log(`total comments fetched: ${totalComments}`);
log(`TOTAL comments containing "halal": ${totalHalal}`);
log("=== TOP 15 reels by halal-comments ===");
for (const r of perReel.slice(0, 15)) {
  log(`${r.halal}\t${r.permalink}\t(of ${r.comments_count} comments)\t${r.caption || ""}`);
}
fs.writeFileSync("halal-result.json", JSON.stringify({ totalHalal, totalComments, scanned, errs, perReel }, null, 2));
log("WROTE halal-result.json");
