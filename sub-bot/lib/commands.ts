import { Cue } from "./cues";
import { isActive, Job } from "./jobs";

export type Command = "sub" | "status" | "help";

export interface CommandDeps {
  uploadUrl: (chatId: number) => string;
  listJobs: () => Promise<Job[]>;
}

export function parseCommand(text: string): Command | null {
  // В группах Telegram дописывает к команде имя бота: /sub@my_bot.
  const word = text.trim().split(/\s+/)[0]?.split("@")[0];
  switch (word) {
    case "/sub":
      return "sub";
    case "/status":
      return "status";
    case "/help":
    case "/start":
      return "help";
    default:
      return null;
  }
}

// Правка — обычное сообщение вида «<номер><пробел><текст>». Число обязано
// попасть в диапазон существующих реплик, иначе это не правка, а обычное
// сообщение: бот должен ответить подсказкой, а не проглотить его молча.
// Текстом реплики становится весь остаток строки как есть, включая
// внутренние пробелы, — поэтому `.+` с флагом `s`, а не разбор по словам.
// Команды (/ok, /cancel, /status и т. д.) отсеиваются сами: они начинаются
// не с цифры, и ведущий `\d` их не пропускает.
// Флаги needsManual/warning снимает вызывающий код после того, как правка
// принята и применена, — parseEdit только разбирает строку.
export function parseEdit(text: string, cues: Cue[]): { i: number; text: string } | null {
  const m = /^(\d{1,3})\s+(.+)$/s.exec(text.trim());
  if (!m) return null;
  const i = Number(m[1]);
  if (!cues.some((c) => c.i === i)) return null;
  const body = m[2].trim();
  if (body.length === 0) return null;
  return { i, text: body };
}

// Номера реплик, которые блокируют рендер: помеченные вручную (needsManual)
// и те, у кого непустой warning (например, строка физически не влезает —
// см. fitLines в lib/cues.ts).
export function blockingWarnings(cues: Cue[]): number[] {
  return cues.filter((c) => c.needsManual || c.warning !== null).map((c) => c.i);
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Показывает и индонезийский перевод, и русский оригинал — чтобы сверить
// правку можно было прямо в чате, не отматывая ролик.
export function renderCueList(job: Job): string {
  const lines = job.cues.map((c) => {
    const head = `${c.i}. [${mmss(c.start)}] ${c.id ?? "—"}`;
    const warn = c.warning ? `\n   ⚠ ${c.warning}` : "";
    return `${head}\n   ${c.ru}${warn}`;
  });

  const blocking = blockingWarnings(job.cues);
  const tail = blocking.length
    ? `\nПоправь строки: ${blocking.join(", ")}. Пиши «номер новый текст».`
    : "\nВсё чисто. /ok — вшить субтитры, /cancel — отменить.";

  return `Субтитры, ${job.cues.length} реплик:\n\n${lines.join("\n\n")}\n${tail}`;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.round(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const HELP = [
  "Вшивание индонезийских субтитров в видео.",
  "",
  "/sub — получить ссылку для загрузки ролика",
  "/status — проверить задачи в работе",
  "/help — эта справка",
].join("\n");

export async function handleCommand(
  command: Command,
  chatId: number,
  deps: CommandDeps
): Promise<string> {
  if (command === "help") return HELP;

  if (command === "sub") {
    return [
      "Открой ссылку и выбери видео — она живёт 30 минут:",
      deps.uploadUrl(chatId),
      "",
      "Готовый ролик пришлю сюда же.",
    ].join("\n");
  }

  const mine = (await deps.listJobs()).filter((job) => job.chatId === chatId && isActive(job));
  if (mine.length === 0) return "Задач в работе нет. Отправь /sub, чтобы начать.";

  const lines = mine.map((job) => `• ${formatDuration(job.durationSec)} — ${job.status}`);
  return [`В работе: ${mine.length}`, ...lines].join("\n");
}
