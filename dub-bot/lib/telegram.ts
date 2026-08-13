function api(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(url: string, body: BodyInit, headers?: HeadersInit): Promise<void> {
  const res = await fetch(url, { method: "POST", body, ...(headers ? { headers } : {}) });
  if (!res.ok) {
    const method = url.slice(url.lastIndexOf("/") + 1);
    throw new Error(`Telegram ${method} failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await call(
    api(token, "sendMessage"),
    JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    { "Content-Type": "application/json" }
  );
}

// Дешёвый путь: Telegram сам скачает файл по ссылке. Работает только до 20 МБ.
export async function sendVideoByUrl(
  token: string,
  chatId: number,
  videoUrl: string,
  caption: string
): Promise<void> {
  await call(
    api(token, "sendVideo"),
    JSON.stringify({
      chat_id: chatId,
      video: videoUrl,
      caption,
      supports_streaming: true,
    }),
    { "Content-Type": "application/json" }
  );
}

// Дорогой путь: гоним файл через нашу функцию. Зато потолок 50 МБ вместо 20.
export async function sendVideoUpload(
  token: string,
  chatId: number,
  bytes: Uint8Array,
  filename: string,
  caption: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("supports_streaming", "true");
  form.append("video", new Blob([bytes], { type: "video/mp4" }), filename);
  await call(api(token, "sendVideo"), form);
}
