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
