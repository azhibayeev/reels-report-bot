import { HOOK_LINE_CHARS, HOOK_MAX_LINES, wrapHook } from "./wrap";
import { Batch, DEFAULT_POSITION, HookPosition, Item, Pair } from "./types";

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_BATCH_BYTES = 1024 ** 3;
export const MAX_FILES = 50;

export interface UploadedFile {
  url: string;
  bytes: number;
}

export function validateBatch(input: { pairs: Pair[]; files: UploadedFile[] }): string[] {
  const errors: string[] = [];
  const { pairs, files } = input;

  if (pairs.length !== files.length) {
    errors.push(`блоков текста ${pairs.length}, а файлов ${files.length} — должно совпадать`);
  }
  if (files.length > MAX_FILES) errors.push(`файлов ${files.length}, лимит ${MAX_FILES}`);

  pairs.forEach((pair, i) => {
    if (!wrapHook(pair.hook)) {
      errors.push(`блок ${i + 1}: хук не влезает в ${HOOK_MAX_LINES} строки по ${HOOK_LINE_CHARS} знаков`);
    }
  });

  files.forEach((file, i) => {
    if (file.bytes > MAX_FILE_BYTES) {
      errors.push(`файл ${i + 1}: ${Math.round(file.bytes / 1024 / 1024)} МБ, лимит ${MAX_FILE_BYTES / 1024 / 1024} МБ`);
    }
  });

  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (total > MAX_BATCH_BYTES) {
    errors.push(`пачка ${Math.round(total / 1024 / 1024)} МБ, лимит 1024 МБ — разбейте на две`);
  }

  return errors;
}

export interface StartDeps {
  saveItem: (item: Item) => Promise<void>;
  saveBatch: (batch: Batch) => Promise<void>;
  triggerRender: (batchId: string) => Promise<void>;
  deleteBlobQuiet: (url: string) => Promise<void>;
  now: () => Date;
  newId: () => string;
}

export async function startBatch(
  input: {
    chatId: number;
    threadId: number | null;
    pairs: Pair[];
    files: UploadedFile[];
    position?: HookPosition;
  },
  deps: StartDeps
): Promise<{ batchId: string; total: number }> {
  const errors = validateBatch(input);
  if (errors.length) throw new Error(errors.join("; "));

  const batchId = deps.newId();
  const createdAt = deps.now().toISOString();
  const total = input.pairs.length;
  const position = input.position ?? DEFAULT_POSITION;

  // Файлы уже целиком в Blob, а записей о задачах ещё нет: любой отказ ниже без
  // явного удаления оставил бы до гигабайта висеть в хранилище навсегда.
  try {
    await deps.saveBatch({
      batchId,
      chatId: input.chatId,
      threadId: input.threadId,
      total,
      createdAt,
      position,
    });
    for (let i = 0; i < total; i += 1) {
      await deps.saveItem({
        itemId: deps.newId(),
        batchId,
        chatId: input.chatId,
        threadId: input.threadId,
        index: i + 1,
        total,
        hook: input.pairs[i].hook,
        caption: input.pairs[i].caption,
        sourceUrl: input.files[i].url,
        videoUrl: null,
        messageId: null,
        editPromptId: null,
        status: "pending",
        renderingAt: null,
        postingAt: null,
        scheduledAt: null,
        igMediaId: null,
        permalink: null,
        error: null,
        createdAt,
        position,
      });
    }
  } catch (error) {
    for (const file of input.files) await deps.deleteBlobQuiet(file.url);
    throw error;
  }

  await deps.triggerRender(batchId);
  return { batchId, total };
}
