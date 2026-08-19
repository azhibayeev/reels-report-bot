import { HOOK_LINE_CHARS, HOOK_MAX_LINES, wrapHook } from "./wrap";
import { BATCHES_PREFIX, itemPath, loadItem } from "./store";
import { Batch, DEFAULT_POSITION, HookPosition, Item, Pair } from "./types";

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_BATCH_BYTES = 1024 ** 3;
export const MAX_FILES = 50;

export interface UploadedFile {
  url: string;
  bytes: number;
}

// Диапазоны знаков, которые реально умеет рисовать assets/hook.ttf (Montserrat
// Bold, 969 знаков BMP — латиница, кириллица, базовая пунктуация). Всё, что вне
// этих диапазонов, совпадает в шрифте с пустым .notdef: ffmpeg такой хук
// отрисовывает кодом возврата 0 и пустыми прямоугольниками вместо текста —
// проверять нужно до рендера, а не полагаться на код возврата ffmpeg.
const HOOK_FONT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x007e], // ASCII: латиница, цифры, базовая пунктуация
  [0x00a0, 0x024f], // Latin-1 Supplement + Latin Extended-A/B
  [0x0400, 0x04ff], // кириллица
  [0x2010, 0x2027], // тире и кавычки типографики
];

function firstCharOutsideHookFont(hook: string): string | null {
  for (const ch of hook) {
    // Итерация по строке (for..of) идёт по code point, а не по UTF-16 code
    // unit — иначе эмодзи вне BMP развалились бы на суррогатную пару и код
    // знака посчитался бы неверно.
    const codePoint = ch.codePointAt(0)!;
    if (!HOOK_FONT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)) {
      return ch;
    }
  }
  return null;
}

export const MAX_HOOKS = 60;

/** Группа: список хуков и одно описание на всю группу — оно уйдёт под каждый её ролик. */
export interface HookGroup {
  hooks: string[];
  caption: string;
  /** Одна дорожка на всю группу; пусто — у роликов остаётся звук подложки. */
  musicUrl?: string | null;
}

export interface Assignment {
  pairs: Pair[];
  sources: UploadedFile[];
}

/**
 * Раздача подложек по кругу. При 10 файлах на 30 хуков каждая подложка уходит
 * трижды, но пара «хук + подложка» не повторяется. Чистая случайность иногда
 * ставит одну подложку четыре раза подряд, и в ленте это бросается в глаза.
 */
export function assignSources(groups: HookGroup[], files: UploadedFile[]): Assignment {
  const pairs: Pair[] = [];
  const sources: UploadedFile[] = [];
  if (files.length === 0) return { pairs, sources };

  let taken = 0;
  for (const group of groups) {
    for (const hook of group.hooks) {
      pairs.push({ hook, caption: group.caption, musicUrl: group.musicUrl ?? null });
      sources.push(files[taken % files.length]);
      taken += 1;
    }
  }
  return { pairs, sources };
}

/**
 * Перемешивание порядка публикации. Без него тридцать роликов одной темы уходили
 * бы в ленту подряд два дня, а вторая группа ждала бы своей очереди до конца.
 */
export function interleave(assignment: Assignment, rand: () => number = Math.random): Assignment {
  const order = assignment.pairs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    pairs: order.map((i) => assignment.pairs[i]),
    sources: order.map((i) => assignment.sources[i]),
  };
}

/** Проверка групп до загрузки: нумерация ошибок идёт по группе и месту хука в ней. */
export function validateGroups(groups: HookGroup[], files: UploadedFile[]): string[] {
  const errors: string[] = [];

  if (files.length === 0) errors.push("не выбрано ни одного видео");
  const hookCount = groups.reduce((sum, g) => sum + g.hooks.length, 0);
  if (hookCount === 0) errors.push("не введено ни одного хука");
  if (hookCount > MAX_HOOKS) errors.push(`хуков ${hookCount}, лимит ${MAX_HOOKS} на пачку`);

  groups.forEach((group, gi) => {
    const label = groups.length > 1 ? `группа ${gi + 1}, ` : "";
    if (!group.caption.trim()) {
      errors.push(`${label}описание пустое — оно уходит в подпись под каждым роликом`);
    } else if (group.caption.length > MAX_CAPTION_LENGTH) {
      errors.push(`${label}описание ${group.caption.length} знаков, лимит ${MAX_CAPTION_LENGTH}`);
    }
    group.hooks.forEach((hook, hi) => {
      if (!wrapHook(hook)) {
        errors.push(`${label}хук ${hi + 1}: не влезает в ${HOOK_MAX_LINES} строки по ${HOOK_LINE_CHARS} знаков`);
      }
      const badChar = firstCharOutsideHookFont(hook);
      if (badChar) {
        errors.push(`${label}хук ${hi + 1}: знак «${badChar}» отсутствует в шрифте — в кадре был бы пустой квадрат`);
      }
    });
  });

  files.forEach((file, i) => {
    if (file.bytes > MAX_FILE_BYTES) {
      errors.push(`файл ${i + 1}: ${Math.round(file.bytes / 1024 / 1024)} МБ, лимит ${MAX_FILE_BYTES / 1024 / 1024} МБ`);
    }
  });
  if (files.length > MAX_FILES) errors.push(`файлов ${files.length}, лимит ${MAX_FILES}`);

  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (total > MAX_BATCH_BYTES) {
    errors.push(`пачка ${Math.round(total / 1024 / 1024)} МБ, лимит 1024 МБ — разбейте на две`);
  }

  return errors;
}

const MAX_CAPTION_LENGTH = 2200;

export function validateBatch(input: { pairs: Pair[]; files: UploadedFile[] }): string[] {
  const errors: string[] = [];
  const { pairs, files } = input;

  if (pairs.length !== files.length) {
    errors.push(`блоков текста ${pairs.length}, а файлов ${files.length} — должно совпадать`);
  }
  if (files.length > MAX_FILES) errors.push(`файлов ${files.length}, лимит ${MAX_FILES}`);

  pairs.forEach((pair, i) => {
    // pair.block — номер исходного текстового блока, который проставляет
    // parseBlocks; без него, если раньше был блок, срубленный на разборе,
    // счёт по индексу массива pairs сдвигается и указывает на чужой блок.
    // Пар без этого поля (старые вызовы) считаем по индексу, как раньше.
    const block = (pair as Pair & { block?: number }).block ?? i + 1;
    if (!wrapHook(pair.hook)) {
      errors.push(`блок ${block}: хук не влезает в ${HOOK_MAX_LINES} строки по ${HOOK_LINE_CHARS} знаков`);
    }
    const badChar = firstCharOutsideHookFont(pair.hook);
    if (badChar) {
      errors.push(`блок ${block}: в хуке знак «${badChar}», которого нет в шрифте — уберите эмодзи и нелатинские алфавиты`);
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

// Идемпотентность повторного POST /api/farm/start в пределах ОДНОГО процесса:
// StartDeps не даёт доступа к чтению стора (по спеке), поэтому единственный
// доступный механизм — модульный кэш по отпечатку входа. Это защита ровно от
// повтора ТОЙ ЖЕ формы (ответ не доехал до браузера за 60 с maxDuration, человек
// жмёт «Загрузить пачку» ещё раз, а токен пачки живёт 30 минут и не одноразовый),
// а не общая дедупликация — на другом инстансе или после холодного старта повтор
// снова создаст вторую пачку. TTL — как у токена пачки (BATCH_TOKEN_TTL_MS).
const START_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;
const startIdempotencyCache = new Map<
  string,
  { at: number; result: { batchId: string; total: number }; firstItemId: string | undefined }
>();

function pruneStartIdempotencyCache(nowMs: number): void {
  for (const [key, entry] of startIdempotencyCache) {
    if (nowMs - entry.at > START_IDEMPOTENCY_TTL_MS) startIdempotencyCache.delete(key);
  }
}

// Кэш-хит без проверки — враньё, если пачка, на которую он указывает, уже не
// существует (например, в тестах модульное состояние переживает beforeEach,
// который чистит стор). firstItemId === undefined — легальный случай пачки
// из нуля роликов, её нечем проверить, и это не повод считать кэш протухшим.
// Ошибку чтения (сеть моргнула) трактуем как «жива»: иначе временный сбой
// list()/loadItem() превратил бы идемпотентность обратно в дубль пачки.
async function cachedBatchStillExists(firstItemId: string | undefined): Promise<boolean> {
  if (firstItemId === undefined) return true;
  try {
    return (await loadItem(firstItemId)) !== null;
  } catch {
    return true;
  }
}

// Состав отпечатка критичен: chatId, threadId, ИСХОДНАЯ input.position (не
// путать с эффективной — обе включены нарочно, см. описание задачи) вместе с
// эффективной, тексты пар и url файлов по порядку. Без chatId/threadId два
// разных чата с одинаковой пачкой текста слились бы в один отпечаток.
function startFingerprint(input: {
  chatId: number;
  threadId: number | null;
  pairs: Pair[];
  files: UploadedFile[];
  position?: HookPosition;
}): string {
  const effectivePosition = input.position ?? DEFAULT_POSITION;
  return JSON.stringify({
    chatId: input.chatId,
    threadId: input.threadId,
    inputPosition: input.position ?? null,
    effectivePosition,
    pairs: input.pairs.map((p) => [p.hook, p.caption]),
    files: input.files.map((f) => f.url),
  });
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

  const nowMs = deps.now().getTime();
  pruneStartIdempotencyCache(nowMs);
  const fingerprint = startFingerprint(input);
  const cached = startIdempotencyCache.get(fingerprint);
  if (cached) {
    if (await cachedBatchStillExists(cached.firstItemId)) return cached.result;
    // Пачка из кэша исчезла (в тестах — стор почищен beforeEach, в проде —
    // теоретически удалена уборкой раньше TTL): доверять больше нельзя,
    // создаём заново, как будто повтора не было.
    startIdempotencyCache.delete(fingerprint);
  }

  const batchId = deps.newId();
  const createdAt = deps.now().toISOString();
  const total = input.pairs.length;
  const position = input.position ?? DEFAULT_POSITION;

  // Файлы уже целиком в Blob, а записей о задачах ещё нет: любой отказ ниже без
  // явного удаления оставил бы до гигабайта висеть в хранилище навсегда.
  // savedItemIds копит id задач, чей saveItem реально прошёл: при отказе на
  // полпути именно эти записи остаются в сторе pending-фантомами со ссылками
  // на уже удалённые исходники, если их не снести вместе с файлами.
  const savedItemIds: string[] = [];
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
      const itemId = deps.newId();
      await deps.saveItem({
        itemId,
        batchId,
        chatId: input.chatId,
        threadId: input.threadId,
        index: i + 1,
        total,
        hook: input.pairs[i].hook,
        caption: input.pairs[i].caption,
        sourceUrl: input.files[i].url,
        musicUrl: input.pairs[i].musicUrl ?? null,
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
      savedItemIds.push(itemId);
    }
  } catch (error) {
    // Порядок важен: сперва записи задач и пачки, потом файлы. Иначе есть окно,
    // где /reels уже пнул бы цепочку рендера по ещё живой записи, у которой
    // источник уже удалён. deleteBlobQuiet принимает и pathname (не только
    // полный url) — так же, как liveDailyDeps().deleteItemRecord в daily.ts.
    for (const itemId of savedItemIds) await deps.deleteBlobQuiet(itemPath(itemId));
    await deps.deleteBlobQuiet(`${BATCHES_PREFIX}${batchId}.json`);
    for (const file of input.files) await deps.deleteBlobQuiet(file.url);
    throw error;
  }

  await deps.triggerRender(batchId);
  const result = { batchId, total };
  // Кэшируем ТОЛЬКО дошедший до конца вызов: упавший startBatch уже откатил
  // файлы и записи (см. catch выше), и если закэшировать его, повтор вернул бы
  // batchId несуществующей пачки вместо того, чтобы честно попробовать снова.
  startIdempotencyCache.set(fingerprint, { at: nowMs, result, firstItemId: savedItemIds[0] });
  return result;
}
