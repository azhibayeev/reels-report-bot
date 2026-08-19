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
