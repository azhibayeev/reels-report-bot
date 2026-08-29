// ── Крон: продлевает IG-токен (раз в месяц). IG long-lived живёт 60 дней, refresh даёт +60.
import { refreshToken } from "../lib/token.js";

export default async function handler(req, res) {
  // защита: Vercel Cron шлёт заголовок; ручной вызов — по секрету
  const auth = req.headers["authorization"] || "";
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = req.query?.key && req.query.key === process.env.CRON_SECRET;
  if (!isCron && !isManual) return res.status(401).send("unauthorized");

  try {
    const r = await refreshToken();
    const days = Math.floor((r.expires_in || 0) / 86400);
    console.log("TOKEN_REFRESHED", days, "days");
    return res.status(200).json({ ok: true, expires_in_days: days });
  } catch (e) {
    console.error("REFRESH_ERR", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
