import { formatDuration } from "./credits";
import { isActive, Job } from "./jobs";

export type Command = "dub" | "status" | "help";

export interface CommandDeps {
  uploadUrl: (chatId: number) => string;
  listJobs: () => Promise<Job[]>;
  triggerTick: (jobId: string) => Promise<void>;
}

export function parseCommand(text: string): Command | null {
  // В группах Telegram дописывает к команде имя бота: /dub@my_bot.
  const word = text.trim().split(/\s+/)[0]?.split("@")[0];
  switch (word) {
    case "/dub":
      return "dub";
    case "/status":
      return "status";
    case "/help":
    case "/start":
      return "help";
    default:
      return null;
  }
}

const HELP = [
  "Дубляж видео с русского на индонезийский.",
  "",
  "/dub — получить ссылку для загрузки ролика",
  "/status — проверить задачи в работе",
  "/help — эта справка",
].join("\n");

export async function handleCommand(
  command: Command,
  chatId: number,
  deps: CommandDeps
): Promise<string> {
  if (command === "help") return HELP;

  if (command === "dub") {
    return [
      "Открой ссылку и выбери видео — она живёт 30 минут:",
      deps.uploadUrl(chatId),
      "",
      "Готовый ролик пришлю сюда же.",
    ].join("\n");
  }

  const mine = (await deps.listJobs()).filter((job) => job.chatId === chatId && isActive(job));
  if (mine.length === 0) return "Задач в работе нет. Отправь /dub, чтобы начать.";

  // Заодно подталкиваем задачи: если цепочка опроса оборвалась, /status её оживит.
  await Promise.all(mine.map((job) => deps.triggerTick(job.jobId)));

  const lines = mine.map((job) => `• ${formatDuration(job.durationSec)} — ${job.status}`);
  return [`В работе: ${mine.length}`, ...lines, "", "Пришлю, как будет готово."].join("\n");
}
