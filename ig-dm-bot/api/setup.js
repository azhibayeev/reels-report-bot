// ── Разовая настройка/здоровье: пишет seed-токен в Blob и проверяет аккаунт.
// GET /api/setup?key=CRON_SECRET  → сохраняет IG_TOKEN_SEED в Blob и возвращает статус.
import { GRAPH, KEYWORDS, LINK } from "../lib/config.js";
import { getToken, saveToken } from "../lib/token.js";

export default async function handler(req, res) {
  if (!req.query?.key || req.query.key !== process.env.CRON_SECRET) {
    return res.status(401).send("unauthorized");
  }
  try {
    // если в env есть seed и просят засеять — пишем в Blob
    if (req.query.seed === "1" && process.env.IG_TOKEN_SEED) {
      await saveToken(process.env.IG_TOKEN_SEED);
    }
    const token = await getToken();
    const me = await (await fetch(`${GRAPH}/me?fields=username,user_id&access_token=${token}`)).json();
    return res.status(200).json({
      ok: !me.error,
      account: me.username || null,
      error: me.error?.message || null,
      keywords: KEYWORDS,
      link: LINK,
      token_source: token ? "present" : "missing",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
