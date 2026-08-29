// ── Действия в Instagram: публичный ответ, DM с ЗАЛИПАЮЩЕЙ кнопкой (button template), проверка подписки.
import { GRAPH, BTN_TITLE, BTN_PAYLOAD } from "./config.js";

// сообщение с button-template (текст + кнопка-постбек в одном бабле, как в ManyChat)
const buttonMessage = (text) => ({
  attachment: {
    type: "template",
    payload: {
      template_type: "button",
      text,
      buttons: [{ type: "postback", title: BTN_TITLE, payload: BTN_PAYLOAD }],
    },
  },
});

async function post(token, recipient, message) {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message }),
  });
  return res.json();
}

// Опенинг-DM как private reply на коммент, с залипающей кнопкой
export async function sendOpeningDM(token, commentId, text) {
  return post(token, { comment_id: commentId }, buttonMessage(text));
}

// Прямой DM со ссылкой (без кнопки) — private reply на коммент
export async function sendDirectReply(token, commentId, text) {
  return post(token, { comment_id: commentId }, { text });
}

// Сообщение открытому диалогу (по IGSID), опционально с кнопкой
export async function sendMessage(token, igsid, text, withButton = false) {
  return post(token, { id: igsid }, withButton ? buttonMessage(text) : { text });
}

export async function isFollower(token, igsid) {
  const res = await fetch(`${GRAPH}/${igsid}?fields=is_user_follow_business&access_token=${token}`);
  const j = await res.json();
  if (j.error) return { ok: false, following: null, error: j.error };
  return { ok: true, following: !!j.is_user_follow_business };
}

export async function replyPublic(token, commentId, message) {
  const url = `${GRAPH}/${commentId}/replies?message=${encodeURIComponent(message)}&access_token=${token}`;
  const res = await fetch(url, { method: "POST" });
  return res.json();
}
