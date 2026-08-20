import { createTrialContainer, fetchPermalink, publishContainer, waitForContainer } from "./instagram";
import { deleteBlobQuiet, listItems, loadItem, saveItem } from "./store";
import { escapeHtml } from "../format";
import { sendMessage } from "../telegram";
import { requireEnv } from "./tick";
import { Item } from "./types";

export interface PostDeps {
  now: () => number;
  loadItem: (itemId: string) => Promise<Item | null>;
  saveItem: (item: Item) => Promise<void>;
  createTrialContainer: (videoUrl: string, caption: string) => Promise<string>;
  waitForContainer: (containerId: string) => Promise<void>;
  publishContainer: (containerId: string) => Promise<string>;
  fetchPermalink: (mediaId: string) => Promise<string>;
  deleteBlobQuiet: (url: string) => Promise<void>;
  notify: (text: string, threadId: number | null) => Promise<void>;
}

export interface PostTickDeps extends PostDeps {
  listItems: () => Promise<Item[]>;
}

export function pickDue(items: Item[], nowMs: number): Item | null {
  const due = items.filter(
    (i) => i.status === "queued" && i.scheduledAt !== null && Date.parse(i.scheduledAt) <= nowMs
  );
  // Брошенный `posting` (postingAt старше TAKEOVER_MS) в работу НЕ возвращается сознательно:
  // вызов мог умереть уже после media_publish, и повторная заливка дала бы дубль рилса
  // на аккаунте. Такие задачи разбирает суточная уборка.
  return due.sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0] ?? null;
}

// Временный отказ Graph (лимит запросов, 5xx, обрыв сети) не должен стоить
// ролику слота — в отличие от постоянного (битые параметры, отозванные права),
// после которого повтор бессмыслен. Список опознаётся по тексту ошибки: живые
// коды из практики ((#4), #17) плюс общие маркеры лимита и HTTP-статусы,
// которые instagram.ts теперь пишет в сообщение явно.
const TRANSIENT_PUBLISH_ERROR_PATTERNS: RegExp[] = [
  /\(#4\)/,
  /#17\b/,
  /application request limit/i,
  /rate limit/i,
  /too many requests/i,
  // Только HTTP-статус, а не голое число: instagram.ts всегда пишет его как
  // "HTTP 429"/"HTTP 5xx" — без этого /\b429\b/ и /\b5\d\d\b/ ловили бы любое
  // трёхзначное число в тексте ошибки Graph (id, код, что угодно).
  /HTTP 429/,
  /HTTP 5\d\d/,
  /fetch failed/i,
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
];

// Сдвиг слота ретраем — размен, оправданный только пока Graph ещё может
// передумать. "IG отбраковал ролик (ERROR/EXPIRED)" — это окончательный
// вердикт про сам ролик (битый файл, протухший upload-сессия), а не про
// нагрузку на API: повтор с фиксом C иначе стоил бы до пяти бесполезных
// попыток и лишний час занятого слота.
/**
 * Отказ по токену: Graph не принял ключ доступа. Это не про конкретный ролик, а
 * про аккаунт целиком — значит и обходиться с ним надо иначе, чем с временным
 * сбоем или с браком ролика.
 *
 * На проде цена ошибки была наглядной: токен оказался нечитаемым, первый же
 * ролик ушёл в failed, а за ним стояли двадцать восемь — по одному каждые сорок
 * пять минут. Вернуть их потом нечем: /retry сознательно не трогает упавших на
 * публикации, чтобы не задвоить пост в ленте.
 */
const AUTH_ERROR_PATTERNS: RegExp[] = [
  /invalid oauth access token/i,
  /cannot parse access token/i,
  /session has been invalidated/i,
  /access token.*(expired|revoked)/i,
  /\(#190\)/,
  /\bcode.?190\b/i,
];

export function isAuthFailure(message: string): boolean {
  return AUTH_ERROR_PATTERNS.some((re) => re.test(message));
}

function isTransientPublishError(message: string): boolean {
  if (/IG отбраковал ролик \((ERROR|EXPIRED)\)/.test(message)) return false;
  return TRANSIENT_PUBLISH_ERROR_PATTERNS.some((re) => re.test(message));
}

// Раньше временный отказ оставлял scheduledAt нетронутым — pickDue снова и
// снова выбирал бы тот же залипший ролик (лимит аккаунта на часы, битый файл
// с "подходящим" текстом ошибки), и вся очередь за ним голодала бы вечно. Сдвиг
// вперёд сознательно отдаёт слот следующему queued-ролику: залипший вернётся
// через TRANSIENT_RETRY_DELAY_MS, а MAX_TRANSIENT_ATTEMPTS не даёт ему
// ретраиться бесконечно — на последней попытке уходит в failed с уведомлением.
const TRANSIENT_RETRY_DELAY_MS = 15 * 60_000;
const MAX_TRANSIENT_ATTEMPTS = 5;

// Мьютекс на itemId в пределах ОДНОГО процесса: закрывает совпадение двух
// тиков заливки детерминированно, а не вероятностно (см. п.1 в описании
// задачи). В Map кладём СИНХРОННО, до первого await — иначе конкурентный
// вызов для того же itemId не увидит цепочку и стартует параллельно с первым,
// и оба успеют прочитать "queued" до того, как кто-то из них запишет "posting".
const postLocks = new Map<string, Promise<void>>();

export async function postOne(item: Item, deps: PostDeps): Promise<void> {
  const previous = postLocks.get(item.itemId) ?? Promise.resolve();
  let settle!: () => void;
  const gate = new Promise<void>((resolve) => {
    settle = resolve;
  });
  postLocks.set(item.itemId, gate);
  await previous;
  try {
    await postOneLocked(item, deps);
  } finally {
    settle();
    // Чистим запись, только если за время нашей работы её не перезаписал
    // следующий конкурентный вызов — иначе стёрли бы чужой, ещё не готовый gate.
    if (postLocks.get(item.itemId) === gate) postLocks.delete(item.itemId);
  }
}

async function postOneLocked(item: Item, deps: PostDeps): Promise<void> {
  // В Blob нет compare-and-set, без перечитывания два тика таймера залили бы
  // один ролик дважды. Мьютекс выше закрывает это внутри процесса; здесь —
  // подстраховка на случай, если loadItem всё же увидел чужую более свежую запись.
  const fresh = await deps.loadItem(item.itemId);
  if (!fresh || fresh.status !== "queued") return;

  await deps.saveItem({ ...fresh, status: "posting", postingAt: new Date(deps.now()).toISOString() });

  const notifyQuiet = async (text: string) => {
    try {
      await deps.notify(text, fresh.threadId);
    } catch (notifyError) {
      console.error("farm post notify failed", fresh.itemId, notifyError);
    }
  };

  if (!fresh.videoUrl) {
    const message = "нет готового видео для заливки";
    await deps.saveItem({ ...fresh, status: "failed", postingAt: null, error: message });
    await notifyQuiet(`Ролик ${fresh.index}/${fresh.total} не залился: ${message}`);
    return;
  }
  const videoUrl = fresh.videoUrl;

  let mediaId: string | null = null;
  // Ссылка, которая уже сохранена в Item и о которой уже сообщили в чат — нужна catch-ветке
  // ниже, чтобы не затирать её null'ом и не слать в чат второе, противоречащее первому сообщение.
  let savedPermalink: string | null = null;
  const deleteVideoQuiet = async () => {
    try {
      await deps.deleteBlobQuiet(videoUrl);
    } catch (deleteError) {
      // deps.deleteBlobQuiet — это инжектированная зависимость, а не гарантированно
      // «тихая» store.ts-реализация: сама себя обезопасить она не обязана.
      console.error("farm deleteBlobQuiet failed", fresh.itemId, deleteError);
    }
  };
  try {
    const containerId = await deps.createTrialContainer(fresh.videoUrl, fresh.caption);
    await deps.waitForContainer(containerId);

    // Перечитываем прямо перед публикацией: мьютекс выше закрывает совпадение
    // только внутри процесса, а compare-and-set в Blob нет вовсе — за время
    // createTrialContainer + waitForContainer другой инстанс (второй тик
    // /api/farm/post, суточный добор) мог успеть пройти весь цикл сам и уже
    // опубликовать этот же ролик. "queued"/"posting" тут не повод останавливаться —
    // это либо ожидаемое (мы сами так и не увидели своей же записи), либо ещё
    // не финишировавшая параллельная попытка; тревожен только чужой "posted".
    const beforePublish = await deps.loadItem(fresh.itemId);
    if (beforePublish?.status === "posted") {
      console.error(
        "farm postOne: другой инстанс уже опубликовал этот ролик, publishContainer не вызван",
        fresh.itemId,
        beforePublish.igMediaId
      );
      return;
    }

    mediaId = await deps.publishContainer(containerId);

    // И после публикации — тем же способом: наша publishContainer могла
    // выполниться параллельно с чужой (то самое узкое межинстансное окно,
    // которое эта проверка лишь сужает, а не закрывает — compare-and-set нет).
    // Если кто-то уже успел сохранить "posted" с ДРУГИМ igMediaId, на аккаунте
    // дубль — молчать об этом нельзя.
    const afterPublish = await deps.loadItem(fresh.itemId);
    if (afterPublish?.status === "posted" && afterPublish.igMediaId && afterPublish.igMediaId !== mediaId) {
      console.error(
        "farm postOne: дубль на аккаунте — оба инстанса опубликовали один ролик",
        fresh.itemId,
        { ours: mediaId, theirs: afterPublish.igMediaId }
      );
      await notifyQuiet(
        `Внимание: ролик ${fresh.index}/${fresh.total} мог опубликоваться на аккаунте дважды — проверьте ленту`
      );
    }

    // Пишем igMediaId сразу, ДО запроса ссылки: рилс уже опубликован на аккаунте,
    // а fetchPermalink — это лишний round-trip к Graph API без таймаута. Если вызов
    // убьют во время этого запроса, id опубликованного медиа не должен потеряться.
    await deps.saveItem({ ...fresh, status: "posted", postingAt: null, igMediaId: mediaId, permalink: null });
    const permalink = await deps.fetchPermalink(mediaId).catch((permalinkError) => {
      console.error("farm fetchPermalink failed", fresh.itemId, mediaId, permalinkError);
      return "";
    });
    if (permalink) {
      await deps.saveItem({ ...fresh, status: "posted", postingAt: null, igMediaId: mediaId, permalink });
      savedPermalink = permalink;
      await notifyQuiet(`Залил ${fresh.index}/${fresh.total}: ${permalink}`);
    } else {
      await notifyQuiet(`Залил ${fresh.index}/${fresh.total}, ролик опубликован, но ссылку получить не удалось`);
    }
    await deleteVideoQuiet();
  } catch (error) {
    const message = (error as Error).message;
    if (mediaId !== null) {
      // publishContainer уже успел — ролик реально на аккаунте, пометить failed
      // и освободить слот было бы враньём и дублем при повторной публикации.
      await deps.saveItem({ ...fresh, status: "posted", postingAt: null, igMediaId: mediaId, permalink: savedPermalink });
      if (savedPermalink === null) {
        await notifyQuiet(`Залил ${fresh.index}/${fresh.total}, но ссылку не получил: ${message}`);
      } else {
        // Ссылку уже сохранили и о ней уже сообщили в чат до этого исключения —
        // второе, противоречащее первому сообщение слать не за чем.
        console.error("farm post: сбой после сохранения permalink", fresh.itemId, message);
      }
      await deleteVideoQuiet();
      return;
    }
    if (isAuthFailure(message)) {
      // Отказ по токену — беда аккаунта, а не ролика. Ролик остаётся в очереди
      // со своим временем и попытки не тратит: чинится это заменой токена, а не
      // повтором. Слот уже прошёл, поэтому первым же тиком после починки ролик
      // уйдёт в публикацию, а за ним и остальные — по порядку.
      console.error("farm postOne: отказ по токену, очередь остановлена", fresh.itemId, message);
      await deps.saveItem({ ...fresh, status: "queued", postingAt: null, error: message });
      await notifyQuiet(
        `Заливка стоит: Instagram не принимает токен — ${message}\n\n` +
          `Ролики не потеряны, они ждут в очереди и уйдут сами, как только токен заменят. ` +
          `Проверить очередь: /reels`
      );
      return;
    }
    if (isTransientPublishError(message)) {
      // Временный отказ ДО публикации (429/5xx/сеть) — ролик уже одобрен
      // человеком, терять слот из-за пятиминутного лимита Graph нельзя, но и
      // держать им всю очередь навечно тоже нельзя (см. TRANSIENT_RETRY_DELAY_MS).
      const attempts = (fresh.postAttempts ?? 0) + 1;
      if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
        console.error(
          "farm postOne: временный отказ Graph, попытки исчерпаны, ролик в failed",
          fresh.itemId,
          attempts,
          message
        );
        await deps.saveItem({ ...fresh, status: "failed", postingAt: null, error: message });
        await notifyQuiet(`Ролик ${fresh.index}/${fresh.total} не залился: ${message}`);
        return;
      }
      console.error("farm postOne: временный отказ Graph, ролик возвращён в очередь", fresh.itemId, attempts, message);
      await deps.saveItem({
        ...fresh,
        status: "queued",
        postingAt: null,
        error: message,
        postAttempts: attempts,
        scheduledAt: new Date(deps.now() + TRANSIENT_RETRY_DELAY_MS).toISOString(),
      });
      return;
    }
    await deps.saveItem({ ...fresh, status: "failed", postingAt: null, error: message });
    await notifyQuiet(`Ролик ${fresh.index}/${fresh.total} не залился: ${message}`);
  }
}

export async function runPostTick(deps: PostTickDeps, maxItems = 1): Promise<number> {
  let taken = 0;
  while (taken < maxItems) {
    const item = pickDue(await deps.listItems(), deps.now());
    if (!item) break;
    await postOne(item, deps);
    taken += 1;
  }
  return taken;
}

export function livePostTickDeps(): PostTickDeps {
  const token = requireEnv("FARM_IG_TOKEN");
  const igUserId = requireEnv("FARM_IG_ID");
  const publishDeps = { token, igUserId };
  return {
    now: () => Date.now(),
    loadItem,
    saveItem,
    createTrialContainer: (videoUrl, caption) => createTrialContainer(videoUrl, caption, publishDeps),
    waitForContainer: (containerId) => waitForContainer(containerId, publishDeps),
    publishContainer: (containerId) => publishContainer(containerId, publishDeps),
    fetchPermalink: (mediaId) => fetchPermalink(mediaId, publishDeps),
    deleteBlobQuiet,
    listItems,
    notify: (text, threadId) => sendMessage(escapeHtml(text), { thread: threadId }),
  };
}
