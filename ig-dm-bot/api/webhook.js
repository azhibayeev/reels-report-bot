// ── Вебхук Instagram.
//  Коммент с кодовым словом → опенинг-DM с кнопкой + публичный ответ.
//  Тап кнопки (postback/quick_reply) → проверка подписки:
//     подписан   → DM со ссылкой
//     не подписан→ DM «сначала подпишись» + кнопка снова.
import { IG_USER_ID, keywordRegex, BTN_PAYLOAD, DM_OPENING, DM_FOLLOW_GATE, DM_LINK, DIRECT_LINK, DM_DIRECT, PUBLIC_REPLIES } from "../lib/config.js";
import { getToken } from "../lib/token.js";
import { sendOpeningDM, sendDirectReply, sendMessage, isFollower, replyPublic } from "../lib/ig.js";
import { phCapture } from "../lib/posthog.js";

const seenComments = new Set();
const seenMsgs = new Set();

export default async function handler(req, res) {
  // Верификация вебхука
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).send("forbidden");
  }
  if (req.method !== "POST") return res.status(405).send("method not allowed");

  try {
    const body = req.body || {};
    const token = await getToken();
    if (!token) { console.error("NO TOKEN"); return res.status(200).send("ok"); }

    for (const entry of body.entry || []) {
      // 1) КОММЕНТЫ
      for (const change of entry.changes || []) {
        if (change.field !== "comments") continue;
        const v = change.value || {};
        const commentId = v.id;
        const text = v.text || "";
        const fromId = v.from?.id;
        const fromUser = v.from?.username || "";
        if (!commentId) continue;
        if (fromId && String(fromId) === String(IG_USER_ID)) continue; // свой коммент
        if (seenComments.has(commentId)) continue;
        if (!keywordRegex.test(text)) continue;
        seenComments.add(commentId);

        const mediaId = v.media?.id || null;
        const kw = (text.match(keywordRegex)?.[2] || "").toLowerCase();
        await phCapture("ig_comment_keyword", fromUser || commentId, { reel: mediaId, keyword: kw });

        // DIRECT_LINK=1 → шлём ссылку сразу (без кнопки/follow-gate); иначе — опенинг с кнопкой
        const dm = DIRECT_LINK
          ? await sendDirectReply(token, commentId, DM_DIRECT)
          : await sendOpeningDM(token, commentId, DM_OPENING);
        if (dm.error) console.error("OPEN_DM_FAIL", fromUser, dm.error.code, dm.error.message);
        else {
          console.log(DIRECT_LINK ? "DIRECT_LINK_SENT" : "OPEN_DM_OK", fromUser);
          await phCapture(DIRECT_LINK ? "ig_app_link_sent" : "ig_opening_dm_sent", fromUser || commentId, { reel: mediaId, direct: DIRECT_LINK });
        }

        const reply = PUBLIC_REPLIES[Math.floor(Math.random() * PUBLIC_REPLIES.length)];
        const pr = await replyPublic(token, commentId, reply);
        if (pr.error) console.error("REPLY_FAIL", fromUser, pr.error.message);
      }

      // 2) СООБЩЕНИЯ (тап кнопки)
      for (const m of entry.messaging || []) {
        if (m.message?.is_echo) continue;                 // наше же исходящее
        const igsid = m.sender?.id;
        if (!igsid || String(igsid) === String(IG_USER_ID)) continue;
        const payload = m.message?.quick_reply?.payload || m.postback?.payload;
        if (payload !== BTN_PAYLOAD) continue;
        const key = m.message?.mid || `${igsid}:${m.timestamp}`;
        if (seenMsgs.has(key)) continue;
        seenMsgs.add(key);
        await phCapture("ig_button_tapped", igsid, {});

        const f = await isFollower(token, igsid);
        if (!f.ok) { console.error("FOLLOW_CHECK_FAIL", igsid, f.error?.message); continue; }

        if (f.following) {
          const r = await sendMessage(token, igsid, DM_LINK, false);
          console.log(r.error ? `LINK_FAIL ${igsid} ${r.error.message}` : `LINK_SENT ${igsid}`);
          await phCapture("ig_app_link_sent", igsid, { following: true });
        } else {
          const r = await sendMessage(token, igsid, DM_FOLLOW_GATE, true); // просьба подписаться + кнопка снова
          console.log(r.error ? `GATE_FAIL ${igsid} ${r.error.message}` : `FOLLOW_GATE_SENT ${igsid}`);
          await phCapture("ig_follow_gate_shown", igsid, { following: false });
        }
      }
    }
  } catch (e) {
    console.error("WEBHOOK_ERR", e.message);
  }
  return res.status(200).send("ok");
}
