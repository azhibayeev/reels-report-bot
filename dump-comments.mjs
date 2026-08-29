import fs from "node:fs";

const B = "https://graph.facebook.com/v21.0";
const TOKEN = process.env.EAATOK;
const IG = "17841413773053161";
const LOG = "dump-comments.log";
const OUT = "comments-all.jsonl";
const META = "reels-meta.json";

function log(...a) { fs.appendFileSync(LOG, a.join(" ") + "\n"); }
const sc = (u) => { const m = (u || "").match(/\/reel\/([^/?]+)/) || (u || "").match(/\/p\/([^/?]+)/); return m ? m[1] : (u || ""); };

async function gj(url) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (body.error) {
        const c = body.error.code;
        if (body.error.is_transient || c === 4 || c === 17 || c === 32 || c === 613 || c === 2) {
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

const media = await allMedia();
fs.writeFileSync(META, JSON.stringify(media, null, 2));
log(`START media=${media.length}`);
fs.writeFileSync(OUT, "");
let idx = 0, scanned = 0, totalC = 0;
const stream = fs.createWriteStream(OUT, { flags: "a" });
async function worker() {
  while (idx < media.length) {
    const m = media[idx++];
    const code = sc(m.permalink);
    if ((m.comments_count || 0) === 0) { scanned++; continue; }
    let url = `${B}/${m.id}/comments?fields=text,username,timestamp,replies.limit(50){text,username,timestamp}&limit=50&access_token=${encodeURIComponent(TOKEN)}`;
    let pages = 0, got = 0;
    while (url && pages < 3000) {
      pages++;
      const { body, error } = await gj(url);
      if (error) { log(`ERR ${code}: ${JSON.stringify(error)}`); break; }
      for (const c of body.data || []) {
        stream.write(JSON.stringify({ sc: code, u: c.username, t: c.text || "" }) + "\n"); got++;
        for (const r of (c.replies && c.replies.data) || []) { stream.write(JSON.stringify({ sc: code, u: r.username, t: r.text || "", reply: 1 }) + "\n"); got++; }
      }
      url = body.paging && body.paging.next;
    }
    scanned++; totalC += got;
    log(`ok ${scanned}/${media.length} ${code} cc=${m.comments_count} got=${got} total=${totalC}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
stream.end();
log(`=== DUMP DONE === media=${scanned} comments_written=${totalC}`);
