import type { Word } from "./cues";

const BASE = "https://api.elevenlabs.io/v1";

// Термины, на которых распознавание не должно ошибаться. Scribe принимает
// до 1000 штук по 50 знаков; надбавка к цене транскрипции 20% — доли цента
// на ролик, зато срезает огрехи распознавания на религиозной лексике.
export const KEYTERMS = [
  "дуа", "зикр", "азкар", "намаз", "салят", "ракаат", "закят", "садака",
  "вакф", "сунна", "суннат", "фард", "тахаджуд", "витр", "иншааллах",
  "альхамдулиллях", "субханаллах", "бисмиллях", "аят", "сура", "хадис",
  "тасбих", "иман", "таква", "умма",
];

// Сырой токен ответа Scribe. Поля start/end/type необязательные —
// защищаемся от ответа, где модель их не прислала (Ruling 2 брифа).
interface ScribeToken {
  text?: string;
  type?: string;
  start?: number;
  end?: number;
}

interface ScribeResponse {
  words?: ScribeToken[];
}

// Распознаёт русскую речь ролика по ссылке через ElevenLabs Scribe v2 и
// возвращает только слова с таймкодами — без пауз и звуковых событий.
export async function transcribe(apiKey: string, sourceUrl: string): Promise<Word[]> {
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  // Файл не гоняем через функцию: тело запроса на Vercel ограничено 4.5 МБ,
  // а source_url принимает любой HTTPS-адрес (потолок файла у Scribe — 2 ГБ),
  // включая прямую ссылку на Blob.
  form.append("source_url", sourceUrl);
  // Язык задан явно: на 60 секундах с фоновой музыкой автоопределение
  // ошибается заметно чаще, чем на длинном чистом аудио.
  form.append("language_code", "rus");
  form.append("timestamps_granularity", "word");
  form.append("keyterms", JSON.stringify(KEYTERMS));

  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    // Не тихий пустой список: пустой список ниже означает «речи нет», и
    // путать его с «ключ протух» или «сервис лёг» нельзя.
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Scribe вернул ${res.status}: ${body}`);
  }

  const data = (await res.json()) as ScribeResponse;
  const tokens = data.words ?? [];

  const words: Word[] = [];
  for (const token of tokens) {
    // Музыка, нашид и смех приходят токенами type: "audio_event", паузы —
    // "spacing". В текст они попадать не должны: ровно ради этого выбран
    // Scribe, а не Whisper, который на фоновом нашиде галлюцинирует
    // связным текстом.
    if (token.type !== "word") continue;
    // Токен без числового таймкода отбрасываем целиком, а не пропускаем
    // с NaN: дальше по конвейеру NaN в таймкоде даёт испорченный файл
    // субтитров, и найти причину будет трудно.
    if (!Number.isFinite(token.start) || !Number.isFinite(token.end)) continue;
    const text = (token.text ?? "").trim();
    if (text.length === 0) continue;
    words.push({ text, start: token.start as number, end: token.end as number });
  }

  return words;
}
