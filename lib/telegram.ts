function api(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}/${method}`;
}

function chatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID;
  if (!id) throw new Error("TELEGRAM_CHAT_ID is not set");
  return id;
}

export async function sendMessage(html: string): Promise<void> {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId(),
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendDocument(filename: string, content: string, caption?: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId());
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/csv" }), filename);
  const res = await fetch(api("sendDocument"), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Telegram sendDocument failed (${res.status}): ${await res.text()}`);
  }
}
