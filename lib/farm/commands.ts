import { escapeHtml } from "../format";
import { isAbandoned } from "./tick";
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

export function parseFarmCommand(text: string): "batch" | "reels" | "style" | null {
  // "/batch@MyReelsBot arg" -> "batch"; Telegram дописывает имя бота в группах.
  const cmd = text.trim().split(/\s+/)[0]?.split("@")[0].toLowerCase();
  if (cmd === "/batch") return "batch";
  if (cmd === "/reels") return "reels";
  if (cmd === "/style") return "style";
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

export function formatQueue(items: Item[], nowMs: number): string {
  if (items.length === 0) return "Ферма пуста: ни одного ролика ещё не загружено.";

  const review = items.filter((i) => i.status === "review");
  const queued = items.filter((i) => i.status === "queued");
  const rendering = items.filter((i) => i.status === "pending" || i.status === "rendering");
  const failed = items.filter((i) => i.status === "failed");

  const lines: string[] = ["🎬 <b>Ферма</b>"];
  lines.push(`ждут апрува: ${review.length}`);
  lines.push(`в очереди: ${queued.length}`);
  if (rendering.length > 0) lines.push(`ещё рендерится: ${rendering.length}`);

  const nextQueued = queued
    .filter((i) => i.scheduledAt && Date.parse(i.scheduledAt) > nowMs)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0];
  if (nextQueued) lines.push(`ближайший слот: ${formatSlot(nextQueued.scheduledAt!)}`);

  if (failed.length > 0) {
    lines.push("");
    lines.push("⚠️ Не собрались:");
    for (const item of failed.slice(0, MAX_FAILED_IN_QUEUE)) {
      lines.push(`${item.index}/${item.total} — ${escapeHtml(item.error ?? "без деталей")}`);
    }
    if (failed.length > MAX_FAILED_IN_QUEUE) {
      lines.push(`…и ещё ${failed.length - MAX_FAILED_IN_QUEUE}`);
    }
  }

  return lines.join("\n");
}
