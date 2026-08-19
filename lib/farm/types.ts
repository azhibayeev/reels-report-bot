export type ItemStatus =
  | "pending"
  | "rendering"
  | "review"
  | "editing"
  | "rejected"
  | "queued"
  | "posting"
  | "posted"
  | "failed";

export interface Pair {
  hook: string;
  caption: string;
  /** Дорожка группы: одна на все её ролики, пусто — остаётся звук подложки. */
  musicUrl?: string | null;
}

export const REEL_DURATIONS = [7, 10, 15] as const;
export type ReelDuration = (typeof REEL_DURATIONS)[number];
export const DEFAULT_DURATION: ReelDuration = 7;

export function isReelDuration(value: unknown): value is ReelDuration {
  return typeof value === "number" && (REEL_DURATIONS as readonly number[]).includes(value);
}

export const HOOK_POSITIONS = ["top", "center", "bottom"] as const;
export type HookPosition = (typeof HOOK_POSITIONS)[number];
export const DEFAULT_POSITION: HookPosition = "top";

export function isHookPosition(v: unknown): v is HookPosition {
  return typeof v === "string" && (HOOK_POSITIONS as readonly string[]).includes(v);
}

export interface Item {
  itemId: string;
  batchId: string;
  chatId: number;
  threadId: number | null;
  /** Номер в пачке, с единицы: он же в подписи «7/30» и в тексте ошибок. */
  index: number;
  total: number;
  hook: string;
  caption: string;
  /** Необязательное: задачи в Blob сериализованы без него, обязательное поле сломало бы старые записи и литералы Item в тестах. */
  position?: HookPosition;
  sourceUrl: string;
  /** Необязательно: задачи, созданные до появления музыки, поля не имеют. */
  musicUrl?: string | null;
  /** Длина ролика в секундах; у старых задач поля нет — берётся значение по умолчанию. */
  seconds?: number;
  videoUrl: string | null;
  messageId: number | null;
  /** Сообщение force_reply: по ответу на него находим ролик при правке описания. */
  editPromptId: number | null;
  status: ItemStatus;
  /**
   * Отметки начала работы. Вызов функции умирает молча, и без них ролик застрял
   * бы в промежуточном статусе навсегда: старше 300 с — работа мертва.
   */
  renderingAt: string | null;
  postingAt: string | null;
  scheduledAt: string | null;
  igMediaId: string | null;
  permalink: string | null;
  error: string | null;
  createdAt: string;
  /** Необязательное по той же причине, что у position: старые записи в Blob сериализованы без него, а обязательное поле сломало бы литералы Item в тестах. Счётчик попыток заливки, переживших временный отказ Graph — после MAX_TRANSIENT_ATTEMPTS ролик уходит в failed, а не ретраится вечно. */
  postAttempts?: number;
}

export interface Batch {
  batchId: string;
  chatId: number;
  threadId: number | null;
  total: number;
  /** Необязательное по той же причине, что у Item: старые пачки в Blob без этого поля. */
  position?: HookPosition;
  createdAt: string;
}
