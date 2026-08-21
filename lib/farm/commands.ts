import { escapeHtml } from "../format";
import { isAbandoned } from "./tick";
import { Cooldown, formatCooldown, isPaused } from "./cooldown";
import { isRateBlock } from "./post";
import { HookPosition, Item } from "./types";

// Ролики фермы, которых команда должна коснуться заново: свежий /batch мог
// прерваться на середине пачки, и /reels заодно пинает такую цепочку рендера.
export function batchesToKick(items: Item[], nowMs: number): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const stuck =
      item.status === "pending" || (item.status === "rendering" && isAbandoned(item.renderingAt, nowMs));
    if (stuck && !ids.includes(item.batchId)) ids.push(item.batchId);
  }
  return ids;
}

export function parseFarmCommand(
  text: string
): "batch" | "reels" | "style" | "rhythm" | "retry" | "token" | "hooks" | null {
  // "/batch@MyReelsBot arg" -> "batch"; Telegram дописывает имя бота в группах.
  const cmd = text.trim().split(/\s+/)[0]?.split("@")[0].toLowerCase();
  if (cmd === "/batch") return "batch";
  if (cmd === "/reels") return "reels";
  if (cmd === "/style") return "style";
  if (cmd === "/rhythm") return "rhythm";
  if (cmd === "/retry") return "retry";
  if (cmd === "/token") return "token";
  if (cmd === "/hooks") return "hooks";
  return null;
}

// Явный список допустимых синонимов: принимаем только перечисленные значения,
// всё остальное — отказ (null). Map.get честно типизирован как HookPosition |
// undefined, поэтому произвольный ключ ("constructor" и т.п.) не может
// случайно резолвиться в позицию.
const POSITION_SYNONYMS = new Map<string, HookPosition>([
  ["верх", "top"],
  ["top", "top"],
  ["центр", "center"],
  ["center", "center"],
  ["низ", "bottom"],
  ["bottom", "bottom"],
]);

// Аргумент /style: без него — показать текущее значение, синонимы (рус/eng)
// без учёта регистра — конкретная позиция, всё остальное — отказ с подсказкой.
export function parseStylePosition(text: string): HookPosition | "show" | null {
  const arg = text.trim().split(/\s+/).slice(1).join(" ").toLowerCase();
  if (!arg) return "show";
  return POSITION_SYNONYMS.get(arg) ?? null;
}

export type ParsedRhythm = { minutes: number; perDay: number } | "show" | null;

/**
 * /rhythm — регулярность выпуска. Понимает пресет («плотно», «обычно»,
 * «спокойно») и пару чисел «интервал количество»: /rhythm 30 20.
 */
export function parseRhythm(text: string, presets: Record<string, { minutes: number; perDay: number }>): ParsedRhythm {
  const arg = text.trim().split(/\s+/).slice(1).join(" ").toLowerCase().trim();
  if (!arg) return "show";

  const preset = presets[arg];
  if (preset) return preset;

  const numbers = arg.match(/\d+/g);
  if (numbers && numbers.length === 2) {
    return { minutes: Number(numbers[0]), perDay: Number(numbers[1]) };
  }
  return null;
}

/**
 * Сбойные ролики, которые можно пересобрать: упавшие ДО получения видео и с целой
 * подложкой. Упавшие на публикации сюда не попадают намеренно — повторная заливка
 * рискует дублем в ленте, а это хуже потерянного ролика.
 */
export function retryableItems(items: Item[]): Item[] {
  return items
    .filter((i) => i.status === "failed" && !i.videoUrl && Boolean(i.sourceUrl))
    .sort((a, b) => a.index - b.index);
}

/**
 * Ролики, убитые блоком по частоте действий: собранное видео цело, а до самой
 * публикации дело не дошло — Instagram отказал раньше. Дубля в ленте тут быть
 * не может, поэтому их, в отличие от прочих упавших на заливке, можно просто
 * вернуть в очередь, не пересобирая.
 *
 * Ветка нужна для роликов, потерянных ДО появления паузы (21.08.2026, шесть
 * штук): дальше такие в failed уже не уходят — их придерживает cooldown.
 */
export function rateBlockedItems(items: Item[]): Item[] {
  return items
    .filter((i) => i.status === "failed" && Boolean(i.videoUrl) && isRateBlock(i.error ?? ""))
    .sort((a, b) => a.index - b.index);
}

/** «/retry 5» — сколько роликов вернуть в работу. Без числа — три: после починки
 * инфраструктуры дешевле проверить на трёх, чем снова получить лавину. */
export function parseRetryCount(text: string): number {
  const arg = text.trim().split(/\s+/)[1];
  const n = Number(arg);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

export function positionName(p: HookPosition): string {
  return { top: "верх", center: "центр", bottom: "низ" }[p];
}

export interface ParsedCallback {
  action: "approve" | "reject" | "edit";
  itemId: string;
}

// callback_data формата "a:<itemId>" — см. approvalKeyboard в lib/farm/telegram.ts.
export function parseCallback(data: string): ParsedCallback | null {
  const sep = data.indexOf(":");
  if (sep === -1) return null;
  const prefix = data.slice(0, sep);
  const itemId = data.slice(sep + 1);
  if (!itemId) return null;
  const action = prefix === "a" ? "approve" : prefix === "r" ? "reject" : prefix === "e" ? "edit" : null;
  if (!action) return null;
  return { action, itemId };
}

export function formatSlot(iso: string, tz: string = "Asia/Jakarta"): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short" })
    .format(d)
    // Intl добавляет точку к сокращению месяца ("20 авг.") — в подписях фермы её не хотим.
    .replace(/\.$/, "");
  const timePart = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${datePart}, ${timePart}`;
}

// Сколько свежих failed показывать в сводке: без потолка длинная серия сбоев
// превратила бы /reels в портянку и рисковала бы упереться в лимит Telegram.
const MAX_FAILED_IN_QUEUE = 10;

// Реальная ошибка ffmpeg — это "ffmpeg вышел с кодом 1: <хвост stderr 600 знаков>"
// (lib/farm/render.ts); MAX_FAILED_IN_QUEUE ограничивает число строк, но не их
// длину — уже 7 таких строк перерастают лимит sendMessage. Обрезаем текст
// каждой ошибки задолго до этого предела.
const MAX_ERROR_CHARS = 160;

// Жёсткий потолок sendMessage в Telegram Bot API — выше него запрос вернёт 400,
// и /reels не ответит вообще.
export const TELEGRAM_TEXT_LIMIT = 4096;
// Запас под маркер обрезки, добавляемый в хвост, если всё равно не влезли.
const TRUNCATION_NOTE = "\n\n…сводка обрезана, влезло не всё";

function truncateError(error: string): string {
  if (error.length <= MAX_ERROR_CHARS) return error;
  return `${error.slice(0, MAX_ERROR_CHARS)}…`;
}

export function formatQueue(items: Item[], nowMs: number, cooldown: Cooldown | null = null): string {
  if (items.length === 0) return "Ферма пуста: ни одного ролика ещё не загружено.";

  const review = items.filter((i) => i.status === "review");
  const queued = items.filter((i) => i.status === "queued");
  // Две стадии, а не одна. Складывать их в строку «ещё рендерится» — значит
  // выдавать вставшую цепочку за идущую работу: пинок сборки может не дойти
  // (см. triggerRender в lib/farm/tick.ts), и тогда задачи молча висят в
  // pending, а сводка бодро сообщает, что они рендерятся. Именно так и вышло.
  const rendering = items.filter((i) => i.status === "rendering");
  const waiting = items.filter((i) => i.status === "pending");
  // Рендер и заливка в IG — разные стадии с разными виновниками: ffmpeg vs Graph API.
  // videoUrl появляется только после успешной сборки (см. lib/farm/render.ts), поэтому
  // по нему и различаем — упал ли ролик, ещё не собравшись, или уже собранный на публикации.
  const failedRendering = items.filter((i) => i.status === "failed" && i.videoUrl === null);
  const failedPosting = items.filter((i) => i.status === "failed" && i.videoUrl !== null);

  const lines: string[] = ["🎬 <b>Ферма</b>"];
  // Паузу показываем первой строкой: без неё «в очереди: 40, ближайший слот
  // 12:31» читается как «всё идёт», хотя не идёт ничего.
  if (isPaused(cooldown, nowMs)) {
    lines.push(`⏸ Заливка на паузе — Instagram ограничил частоту. Ждём ${formatCooldown(cooldown!, nowMs)}.`);
  }
  lines.push(`ждут апрува: ${review.length}`);
  lines.push(`в очереди: ${queued.length}`);
  if (rendering.length > 0) lines.push(`собирается сейчас: ${rendering.length}`);
  if (waiting.length > 0) lines.push(`ждут сборки: ${waiting.length}`);

  const nextQueued = queued
    .filter((i) => i.scheduledAt && Date.parse(i.scheduledAt) > nowMs)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0];
  if (nextQueued) lines.push(`ближайший слот: ${formatSlot(nextQueued.scheduledAt!)}`);

  const pushFailedBlock = (title: string, list: Item[]) => {
    if (list.length === 0) return;
    lines.push("");
    lines.push(title);
    for (const item of list.slice(0, MAX_FAILED_IN_QUEUE)) {
      lines.push(`${item.index}/${item.total} — ${escapeHtml(truncateError(item.error ?? "без деталей"))}`);
    }
    if (list.length > MAX_FAILED_IN_QUEUE) {
      lines.push(`…и ещё ${list.length - MAX_FAILED_IN_QUEUE}`);
    }
  };
  pushFailedBlock("⚠️ Не собрались:", failedRendering);
  pushFailedBlock("⚠️ Не залились:", failedPosting);

  const text = lines.join("\n");
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  // Обрезка ошибок и MAX_FAILED_IN_QUEUE должны были уложиться сами — этот
  // потолок только страхует край случая (много блоков, длинные позиции и т.п.),
  // чтобы sendMessage не получил 400 и /reels ответил хоть чем-то.
  return `${safeTruncate(text, TELEGRAM_TEXT_LIMIT - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`;
}

// Голый slice(0, room) режет по числу знаков и не знает, что текст уже прошёл
// через escapeHtml — срез легко приходится внутрь "&amp;"/"&lt;", Telegram
// с parse_mode=HTML отвечает 400 "can't parse entities", и /reels не отвечает
// вообще. Сначала режем по последнему переводу строки (чтобы не рвать строку
// посередине), затем срубаем недописанную в самом хвосте HTML-сущность.
function safeTruncate(text: string, room: number): string {
  let cut = text.slice(0, room);
  const lastNewline = cut.lastIndexOf("\n");
  // Если перевод строки слишком близко к началу, резать по нему бессмысленно —
  // получим почти пустую сводку вместо страховки от оборванной сущности.
  if (lastNewline > room / 2) cut = cut.slice(0, lastNewline);
  return cut.replace(/&[a-zA-Z#0-9]*$/, "");
}
