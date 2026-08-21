import { createTrialContainer, fetchPermalink, publishContainer, waitForContainer } from "./instagram";
import { deleteBlobQuiet, listItems, loadItem, saveItem } from "./store";
import { escapeHtml } from "../format";
import { sendMessage } from "../telegram";
import { requireEnv } from "./tick";
import { resolveFarmToken } from "./token-store";
import { Cooldown, formatCooldown, isPaused, loadCooldown, nextCooldown, saveCooldown } from "./cooldown";
import { loadRhythm } from "./style";
import { slotConfigFromEnv } from "./slots";
import { PublicationRecord, recordPublication, toRecord } from "./journal";
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
  /**
   * Чат обязателен третьим аргументом: пачку заводят в личке, и сыпать
   * сообщениями о заливке в общий чат команды — шум для всех и молчание для
   * того, кто её загрузил.
   */
  notify: (text: string, threadId: number | null, chatId?: number) => Promise<void>;
  /**
   * Запись в вечный журнал. Отдельной зависимостью, а не прямым вызовом:
   * postOne обязан оставаться тестируемым без сети, а журнал ходит в Blob.
   */
  recordPublication: (rec: PublicationRecord) => Promise<void>;
  /** Пауза заливки, объявленная Instagram — см. lib/farm/cooldown.ts. */
  loadCooldown: () => Promise<Cooldown | null>;
  saveCooldown: (cooldown: Cooldown) => Promise<void>;
}

export interface PostTickDeps extends PostDeps {
  listItems: () => Promise<Item[]>;
  /**
   * Минимум времени между двумя публикациями. В обычном ритме не срабатывает
   * никогда: слоты и так разнесены. Смысл — в доборе просрочки, см. runPostTick.
   */
  minGapMs?: number;
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

/**
 * Ограничение по частоте действий на самом аккаунте. Третий род отказа, и
 * обходиться с ним надо иначе, чем с двумя прежними: это не брак ролика (повтор
 * бесполезен) и не пятиминутная икота Graph (повтор через четверть часа помог
 * бы). Instagram сказал аккаунту «слишком часто» и держит это часами.
 *
 * Цену узнали на проде 21.08.2026: HTTP 400 «User is performing too many
 * actions» не подходил ни под один шаблон ниже — ни 429, ни «rate limit», ни
 * «too many requests», — и ролик уходил в failed по общей ветке. Следующий
 * приходил в свой слот через сорок пять минут, получал то же самое и умирал
 * так же. Шесть роликов за три часа, вернуть их нечем.
 *
 * Поэтому отдельная ветка: пауза объявляется на всю ферму сразу (см.
 * lib/farm/cooldown.ts), а ролик остаётся в очереди и попыток не тратит —
 * он ни в чём не виноват.
 */
const RATE_BLOCK_PATTERNS: RegExp[] = [
  /performing too many actions/i,
  // Код 9 в отказе Graph — тот же блок; в тексте он приходит и как "(#9)", и
  // как "code: 9". Оба написания встречаются в ответах v23.0.
  /\(#9\)/,
  /\bcode\W{0,3}9\b/i,
  // Формулировки того же семейства «действие ограничено» из ответов Instagram.
  /action blocked/i,
  /temporarily blocked/i,
  // Общего "please try again later" здесь сознательно нет: Graph отвечает так и
  // на разовую пятисотку, а цена ошибки несимметрична — лишний час простоя всей
  // фермы против одного ролика, ушедшего в повтор через пятнадцать минут.
];

export function isRateBlock(message: string): boolean {
  return RATE_BLOCK_PATTERNS.some((re) => re.test(message));
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
      await deps.notify(text, fresh.threadId, fresh.chatId);
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
    // postedAt нужен уборке: она считает срок хранения записи от публикации, а
    // не от создания — пачка создаётся вся разом, а выходит растянуто на дни.
    const postedAt = new Date(deps.now()).toISOString();
    await deps.saveItem({ ...fresh, status: "posted", postingAt: null, postedAt, igMediaId: mediaId, permalink: null });
    const permalink = await deps.fetchPermalink(mediaId).catch((permalinkError) => {
      console.error("farm fetchPermalink failed", fresh.itemId, mediaId, permalinkError);
      return "";
    });
    if (permalink) {
      await deps.saveItem({ ...fresh, status: "posted", postingAt: null, postedAt, igMediaId: mediaId, permalink });
      savedPermalink = permalink;
      await notifyQuiet(`Залил ${fresh.index}/${fresh.total}: ${permalink}`);
    } else {
      await notifyQuiet(`Залил ${fresh.index}/${fresh.total}, ролик опубликован, но ссылку получить не удалось`);
    }
    // Журнал пишем ПОСЛЕ запроса ссылки: иначе в нём навсегда останется null
    // там, где человек глазами проверяет ролик. Путь записи детерминированный и
    // перезаписываемый, так что повтор безопасен.
    const record = toRecord(
      { ...fresh, status: "posted", postedAt, igMediaId: mediaId, permalink: savedPermalink },
      postedAt
    );
    if (record) {
      try {
        await deps.recordPublication(record);
      } catch (journalError) {
        // Ролик уже на аккаунте — падать нельзя. Но и молчать нельзя: без записи
        // связь «хук → рилс» потеряется, когда уборка снесёт farm/items/.
        console.error("farm postOne: публикация не записана в журнал", fresh.itemId, mediaId, journalError);
      }
    }
    await deleteVideoQuiet();
  } catch (error) {
    const message = (error as Error).message;
    if (mediaId !== null) {
      // publishContainer уже успел — ролик реально на аккаунте, пометить failed
      // и освободить слот было бы враньём и дублем при повторной публикации.
      await deps.saveItem({
        ...fresh,
        status: "posted",
        postingAt: null,
        postedAt: fresh.postedAt ?? new Date(deps.now()).toISOString(),
        igMediaId: mediaId,
        permalink: savedPermalink,
      });
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
    if (isRateBlock(message)) {
      // Блок по частоте действий держится часами и накрывает аккаунт целиком:
      // следующий ролик получит ровно тот же отказ. Поэтому решение общее —
      // пауза для всей заливки, а не приговор этому ролику.
      let previous: Cooldown | null = null;
      try {
        previous = await deps.loadCooldown();
      } catch (cooldownError) {
        // Непрочитанная пауза значит лишь «серия начинается заново»: хуже было
        // бы уронить обработку и оставить ролик в posting навсегда.
        console.error("farm postOne: пауза не прочиталась", fresh.itemId, cooldownError);
      }
      // Пауза ещё идёт, а ролик всё равно дошёл до Graph (другой инстанс не
      // увидел записи в Blob) — шаг не растим и в чат второй раз не пишем.
      const running = isPaused(previous, deps.now());
      const cooldown = running ? (previous as Cooldown) : nextCooldown(previous, deps.now(), message);
      if (!running) {
        try {
          await deps.saveCooldown(cooldown);
        } catch (cooldownError) {
          // Ролик мы всё равно отодвинем ниже, так что бесконечного долбления
          // не будет; но остальную очередь без записи ничто не остановит.
          console.error("farm postOne: пауза не записана, очередь не остановлена", fresh.itemId, cooldownError);
        }
      }
      // Ролик встаёт первым на выход после паузы, а не остаётся в прошлом со
      // своим просроченным слотом: иначе pickDue вернул бы его в ту же секунду,
      // когда пауза кончится, вперемешку с другими просроченными.
      const resumeAt = Date.parse(cooldown.until);
      const scheduledAt = Number.isFinite(resumeAt)
        ? new Date(resumeAt).toISOString()
        : fresh.scheduledAt;
      console.error("farm postOne: Instagram ограничил частоту, заливка на паузе", fresh.itemId, cooldown.until, message);
      // Попытку не тратим: ролик ни в чём не виноват, виновата частота.
      await deps.saveItem({ ...fresh, status: "queued", postingAt: null, error: message, scheduledAt });
      if (!running) {
        await notifyQuiet(
          `Instagram ограничил частоту публикаций: «${message}»\n\n` +
            `Заливка встала на ${formatCooldown(cooldown, deps.now())}. ` +
            `Ролики не потеряны — они ждут в очереди и пойдут сами, когда пауза кончится. ` +
            `Проверить очередь: /reels`
        );
      }
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

/**
 * Момент последней заливки: и завершённой, и той, что прямо сейчас в работе.
 * Заливка «в работе» считается наравне с завершённой сознательно — иначе два
 * инстанса, стартовав в одну минуту, разогнали бы темп вдвое именно тогда,
 * когда его надо сбавить. Брошенный posting перестанет мешать сам, как только
 * выйдет за окно паузы между публикациями.
 */
export function lastPostedAt(items: Item[]): number | null {
  let last: number | null = null;
  for (const item of items) {
    for (const stamp of [item.postedAt, item.postingAt]) {
      if (!stamp) continue;
      const at = Date.parse(stamp);
      if (Number.isFinite(at) && (last === null || at > last)) last = at;
    }
  }
  return last;
}

export async function runPostTick(deps: PostTickDeps, maxItems = 1): Promise<number> {
  // Пауза после блока по частоте — первое, что проверяем: ходить в Graph, зная,
  // что он откажет, значит продлевать блок, Instagram считает и отказы тоже.
  let cooldown: Cooldown | null = null;
  try {
    cooldown = await deps.loadCooldown();
  } catch (error) {
    console.error("farm postTick: пауза не прочиталась, работаем как обычно", error);
  }
  if (isPaused(cooldown, deps.now())) {
    console.error("farm postTick: заливка на паузе до", (cooldown as Cooldown).until);
    return 0;
  }

  let taken = 0;
  // Заливка, случившаяся в этом же проходе: запись в Blob читается не мгновенно,
  // и без собственной памяти второй виток цикла не увидел бы первого.
  let postedHere: number | null = null;
  while (taken < maxItems) {
    const items = await deps.listItems();
    const gap = deps.minGapMs ?? 0;
    if (gap > 0) {
      const fromBlob = lastPostedAt(items);
      const last = postedHere !== null && (fromBlob === null || postedHere > fromBlob) ? postedHere : fromBlob;
      // Разгон после паузы — это то, обо что ферма и споткнулась: просроченных
      // роликов накапливается несколько, внешний таймер дёргает заливку каждые
      // пятнадцать минут, и очередь пошла бы втрое быстрее задуманного ритма
      // сразу после того, как аккаунт наказали именно за частоту.
      if (last !== null && deps.now() - last < gap) break;
    }
    const item = pickDue(items, deps.now());
    if (!item) break;
    await postOne(item, deps);
    postedHere = deps.now();
    taken += 1;
  }
  return taken;
}

// Потолок паузы между публикациями. Половина ритма, но не больше получаса:
// брать сам ритм нельзя — заливка занимает минуты, и следующий слот оказывался
// бы «слишком рано» каждый раз, отставание копилось бы и уводило расписание.
export const MAX_PUBLISH_GAP_MS = 25 * 60_000;

export function publishGapMs(rhythmMinutes: number): number {
  if (!Number.isFinite(rhythmMinutes) || rhythmMinutes <= 0) return 0;
  return Math.min(Math.round((rhythmMinutes * 60_000) / 2), MAX_PUBLISH_GAP_MS);
}

// Асинхронна, потому что ключ теперь не из переменной окружения, а из
// шифрованного хранилища: его надо прочитать и расшифровать.
export async function livePostTickDeps(): Promise<PostTickDeps> {
  const token = await resolveFarmToken();
  const igUserId = requireEnv("FARM_IG_ID");
  const publishDeps = { token, igUserId };
  // Ритм из состояния, как и везде: команда /rhythm переживает деплой, а
  // переменные окружения — только начальное значение.
  const rhythm = await loadRhythm();
  return {
    minGapMs: publishGapMs(rhythm?.minutes ?? slotConfigFromEnv().minutes),
    loadCooldown,
    saveCooldown,
    now: () => Date.now(),
    loadItem,
    saveItem,
    createTrialContainer: (videoUrl, caption) => createTrialContainer(videoUrl, caption, publishDeps),
    waitForContainer: (containerId) => waitForContainer(containerId, publishDeps),
    publishContainer: (containerId) => publishContainer(containerId, publishDeps),
    fetchPermalink: (mediaId) => fetchPermalink(mediaId, publishDeps),
    deleteBlobQuiet,
    listItems,
    notify: (text, threadId, chatId) =>
      sendMessage(escapeHtml(text), { thread: threadId, ...(chatId ? { chat: chatId } : {}) }),
    recordPublication,
  };
}
