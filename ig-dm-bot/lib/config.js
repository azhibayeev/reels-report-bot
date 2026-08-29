// ── Настройки бота. Правь тут тексты/слова, деплой заново.

export const IG_USER_ID = process.env.IG_USER_ID || "17841413773053161"; // @daristeppe
export const GRAPH = "https://graph.instagram.com/v21.0";

// Кодовые слова-триггеры (регистр неважен, ловится как отдельное слово)
export const KEYWORDS = (process.env.KEYWORDS || "ikut,halal")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Ловим слово, НАЧИНАЮЩЕЕСЯ с кодового: "ikut", "ikut...", "mau ikut", "ikutan", "ikut😊".
// Но НЕ ловит, когда ikut внутри другого слова (mengikuti, berikut, pengikut) — там ikut не в начале слова.
export const keywordRegex = new RegExp(
  `(^|[^a-z])(${KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "i"
);

// Финальная ссылка (только для подписчиков)
export const LINK = process.env.LINK || "https://go.quranyy.com/gabung";

// Payload кнопки
export const BTN_PAYLOAD = "GET_LINK";
export const BTN_TITLE = process.env.BTN_TITLE || "Kirim link-nya 🔗"; // «Пришли ссылку»

// 1) Опенинг-DM (сразу после коммента) — с кнопкой
export const DM_OPENING =
  process.env.DM_OPENING ||
  "Assalamu'alaikum! Seneng banget kamu di sini 😊\n\n" + // Мир тебе! Рад, что ты тут
  "Tap tombol di bawah ya, link-nya langsung aku kirimin ✨"; // Тапни кнопку ниже, сразу пришлю ссылку

// 2) DM-просьба подписаться (если НЕ подписан при тапе) — с той же кнопкой
export const DM_FOLLOW_GATE =
  process.env.DM_FOLLOW_GATE ||
  "Dikit lagi! Link ini spesial buat followers aku ✨\n\n" + // Ещё чуть-чуть! Ссылка только для подписчиков
  "Begitu kamu follow, langsung aku kirimin link-nya biar kamu bisa langsung mulai! 🎉"; // Как подпишешься — сразу пришлю

// 3) DM со ссылкой (если подписан)
export const DM_LINK =
  process.env.DM_LINK ||
  ("Alhamdulillah! 🎉 Ini link-nya ya 👇\n" + LINK); // Вот ссылка

// Режим "ссылка сразу" (без кнопки/follow-gate) — включается env DIRECT_LINK=1.
// Проще и конверсионнее для пре-лонча; не зависит от обработки тапа.
export const DIRECT_LINK = process.env.DIRECT_LINK === "1";
export const DM_DIRECT =
  process.env.DM_DIRECT ||
  ("Assalamu'alaikum! 😊 Makasih udah komen ya.\n" +
    "Ini link-nya, langsung gabung di sini 👇\n" +
    LINK +
    "\nSemoga bermanfaat! ❤️"); // Мир тебе! Спасибо за коммент. Вот ссылка, вступай. Пусть будет полезно.

// Публичные ответы под комментом (рандомим)
export const PUBLIC_REPLIES = (process.env.PUBLIC_REPLIES ||
  "Terima kasih! Cek DM ya 📩|Sudah aku kirim ke DM, cek ya ✨|Mantap! Cek DM-nya ya!")
  .split("|");
