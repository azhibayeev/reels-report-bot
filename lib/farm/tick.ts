import { farmCaption } from "./telegram";
import { tickKey } from "./tokens";
import { Item } from "./types";

// Нет отдельного lib/farm/config.ts — так что requireEnv и baseUrl живут здесь,
// как единственном месте, где нужен само-вызов.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function baseUrl(): string {
  const explicit = process.env.FARM_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (host) return `https://${host}`;
  throw new Error("FARM_BASE_URL is not set");
}

export const INVOCATION_BUDGET_MS = 240_000;
// Запас на один ролик. 150 с закладывались под подложку в полторы минуты, но
// ролики теперь не длиннее пятнадцати секунд и собираются за 30-45 с — старый
// резерв просто дробил работу: вызов трудился 90 с из 240 и передавал эстафету.
// Каждая передача это ещё одно звено само-вызова, а их Vercel и обрывает
// пятьсот восьмым (см. lib/farm/sweep.ts). Меньше звеньев — реже обрыв.
// 90 с всё ещё вдвое больше наблюдаемого времени сборки, и худший случай
// (звено начато на 150-й секунде и длится 90) укладывается в maxDuration 300.
export const ITEM_RESERVE_MS = 90_000;
// Ни один вызов не живёт дольше 300 с, значит работа с более старой отметкой
// точно мертва — её можно перехватить, а живую этот порог не перехватит никогда.
export const TAKEOVER_MS = 300_000;

export function isAbandoned(at: string | null, nowMs: number): boolean {
  if (!at) return true;
  const started = Date.parse(at);
  if (Number.isNaN(started)) return true;
  return nowMs - started > TAKEOVER_MS;
}

export function pickNext(items: Item[], batchId: string, nowMs: number): Item | null {
  const mine = items.filter((i) => i.batchId === batchId);
  const pending = mine.filter((i) => i.status === "pending");
  const stuck = mine.filter((i) => i.status === "rendering" && isAbandoned(i.renderingAt, nowMs));
  return [...pending, ...stuck].sort((a, b) => a.index - b.index)[0] ?? null;
}

// В Blob нет compare-and-set, а перечитывание после записи ненадёжно по
// таймингу (стор в тестах отвечает не мгновенно, и оба тика успевают увидеть
// один и тот же pending). Set — на уровне процесса: id роликов, которые прямо
// сейчас рендерит ЭТОТ вызов функции. Двум параллельным invocation'ам одного
// serverless-инстанса (или двум вызовам в одном dev-процессе) это не даёт
// выбрать один и тот же ролик; между разными инстансами гонку не закрывает —
// там спасает только TAKEOVER_MS.
const renderingNow = new Set<string>();

/**
 * Кому исходник ещё нужен. Очевидные — ждущие и рендерящиеся. Неочевидный, и
 * ровно на нём мы обожглись: сбойный ролик, до видео так и не дошедший. Его
 * возвращает в работу /retry, и без подложки возвращать некуда.
 *
 * На проде это стоило тридцати четырёх роликов. Подложки раздаются по кругу,
 * одна на десяток хуков; пока пачка молола, часть роликов упала. Когда
 * дорендерился последний ждущий, «ждущих не осталось» стало правдой — и
 * исходники снесло. Следом /retry вернул сбойные в очередь, и все они легли с
 * 404. Доделать пачку буквально означало лишить её возможности пересобраться.
 *
 * Провалившийся на публикации сюда не попадает: видео у него есть, рендерить
 * заново нечего. Держать подложку вечно тоже не выйдет — суточная уборка
 * сносит ничьи исходники, а сами сбойные задачи чистит через трое суток
 * (PURGE_AFTER_MS в lib/farm/daily.ts).
 */
function needsSource(item: Item): boolean {
  if (item.status === "pending" || item.status === "rendering") return true;
  return item.status === "failed" && !item.videoUrl;
}

export interface RenderTickDeps {
  now: () => number;
  listItems: () => Promise<Item[]>;
  saveItem: (item: Item) => Promise<void>;
  renderItem: (item: Item) => Promise<string>;
  sendVideoWithButtons: (args: {
    chatId: number;
    threadId: number | null;
    videoUrl: string;
    caption: string;
    itemId: string;
  }) => Promise<number>;
  deleteBlobQuiet: (url: string) => Promise<void>;
  notify: (text: string, threadId: number | null, chatId?: number) => Promise<void>;
  triggerRender: (batchId: string) => Promise<void>;
}

// Три одинаковых сбоя подряд — это не невезение, а сломанная среда: битый
// бинарник, отвалившееся хранилище, кончившаяся квота. Дальше молоть пачку
// бессмысленно и вредно: каждый ролик стоит скачивания исходника и сообщения в
// чат, а человек получает шестьдесят одинаковых писем вместо одного.
export const FAILURE_STREAK_LIMIT = 3;

export async function runRenderTick(batchId: string, deps: RenderTickDeps): Promise<void> {
  const startedAt = deps.now();
  let streak = 0;
  let lastError = "";
  for (;;) {
    if (deps.now() - startedAt > INVOCATION_BUDGET_MS - ITEM_RESERVE_MS) {
      await deps.triggerRender(batchId);
      return;
    }
    let listed: Item[];
    try {
      listed = await deps.listItems();
    } catch (listError) {
      // Непрочитанный список Blob не должен обрывать пачку молча: роут
      // оборачивает весь тик в .catch(console.error), и без уведомления здесь
      // человек просто не узнает, что цепочка встала. triggerRender отсюда не
      // зовём — тот же самовызов по кругу, что и в ветке отказа saveItem
      // выше: следующий вызов снова упрётся в тот же нечитаемый список.
      console.error("farm listItems failed", listError);
      try {
        await deps.notify(
          "Не смог прочитать список задач: цепочка сборки пачки остановлена. К ней вернётся суточная уборка.",
          null
        );
      } catch (notifyError) {
        console.error("farm notify failed", notifyError);
      }
      return;
    }
    // Отфильтровываем ролики, которые уже рендерит этот же процесс: второй
    // параллельный тик иначе выберет тот же pending, пока первый ещё не
    // записал rendering в Blob (см. renderingNow выше).
    const item = pickNext(
      listed.filter((i) => !renderingNow.has(i.itemId)),
      batchId,
      deps.now()
    );
    if (!item) return;

    // Застолбить id нужно СИНХРОННО, до первого await — иначе между выбором
    // кандидата и записью в Set второй тик успеет выбрать того же.
    renderingNow.add(item.itemId);
    try {
      try {
        await deps.saveItem({ ...item, status: "rendering", renderingAt: new Date(deps.now()).toISOString() });
      } catch (writeError) {
        // saveItem мог упасть на самой первой записи (Blob 429 и т.п.). Наивный
        // continue тут зациклил бы процесс: listItems на следующем витке снова
        // отдаст тот же pending. Сообщаем и выходим — эстафету подхватит
        // следующий вызов цепочки (либо по triggerRender, либо по крону).
        const message = (writeError as Error).message;
        try {
          await deps.notify(
            `Не смог отметить ролик ${item.index}/${item.total} в работе: ${message}`,
            item.threadId,
            item.chatId
          );
        } catch (notifyError) {
          console.error("farm notify failed", item.itemId, notifyError);
        }
        // triggerRender отсюда звать нельзя: запись не прошла, значит задача
        // осталась pending, и следующий вызов /api/farm/render снова выберет
        // её же и снова упадёт на том же saveItem — самовызов уходит в
        // бесконечный цикл функций Vercel. Восстановление отдано суточному
        // крону (lib/farm/daily.ts): он подбирает pending старше STUCK_AFTER_MS
        // и пинает цепочку один раз на пачку — второго пинка отсюда не нужно.
        return;
      }

      let renderedUrl: string | null = null;
      try {
        const videoUrl = await deps.renderItem(item);
        renderedUrl = videoUrl;
        const caption = farmCaption(item.index, item.total, item.hook, item.caption);
        const messageId = await deps.sendVideoWithButtons({
          chatId: item.chatId,
          threadId: item.threadId,
          videoUrl,
          caption,
          itemId: item.itemId,
        });
        await deps.saveItem({ ...item, status: "review", videoUrl, messageId, renderingAt: null });

        // Раньше здесь задачи с тем же sourceUrl помечались сбойными: подложка
        // считалась личной, и повторная ссылка означала чужую пачку. Теперь
        // подложки раздаются по кругу, и одна обслуживает десяток хуков —
        // «двойник» стал нормой, а не аварией. Удаление исходника ниже само
        // ждёт, пока ждущих не останется.

        // Исходник больше не нужен — но только если он больше никому не нужен:
        // одна подложка раздаётся нескольким хукам по кругу, и удалить её сразу
        // значило бы оставить остальные ролики пачки с мёртвой ссылкой. Квота
        // Blob на Hobby при превышении отключает хранилище на 30 дней, поэтому
        // держать лишнее тоже нельзя: удаляем, когда ждущих не осталось.
        const stillNeeded = (await deps.listItems()).some(
          (other) => other.itemId !== item.itemId && other.sourceUrl === item.sourceUrl && needsSource(other)
        );
        if (!stillNeeded) await deps.deleteBlobQuiet(item.sourceUrl);
      } catch (error) {
        const message = (error as Error).message;
        if (renderedUrl) {
          // Ролик уже собран и залит в farm/out/, но что-то дальше упало
          // (отправка в Telegram и т.п.) — без явного удаления файл повиснет
          // в Blob навсегда, ведь ссылки на него не будет ни у кого.
          try {
            await deps.deleteBlobQuiet(renderedUrl);
          } catch (deleteError) {
            console.error("farm cleanup failed", item.itemId, deleteError);
          }
        }
        await deps.saveItem({ ...item, status: "failed", renderingAt: null, error: message, videoUrl: null });

        streak = message === lastError ? streak + 1 : 1;
        lastError = message;
        if (streak >= FAILURE_STREAK_LIMIT) {
          try {
            await deps.notify(
              `Остановил сборку: ${streak} ролика подряд упали с одной ошибкой — ${message}\n\n` +
                `Остальные ждут в очереди. Когда причина устранена, пните сборку командой /reels.`,
              item.threadId,
              item.chatId
            );
          } catch (notifyError) {
            console.error("farm notify failed", item.itemId, notifyError);
          }
          return;
        }

        try {
          await deps.notify(
            `Ролик ${item.index}/${item.total} не собрался: ${message}`,
            item.threadId,
            item.chatId
          );
        } catch (notifyError) {
          // Отвалившийся Telegram не должен обрывать пачку: остальные ролики важнее письма.
          console.error("farm notify failed", item.itemId, notifyError);
        }
      }
    } finally {
      renderingNow.delete(item.itemId);
    }
  }
}

// Паузы между попытками пинка. Первая подлиннее не из вежливости: осечка,
// которую мы лечим, — это именно не уложившаяся в лимит инициализация функции,
// и повтору нужно дать ей время подняться, а не долбиться в тот же холодный старт.
export const TRIGGER_BACKOFF_MS = [1000, 3000] as const;
export const TRIGGER_ATTEMPTS = TRIGGER_BACKOFF_MS.length + 1;

export interface TriggerDeps {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Запускает следующее звено цепочки рендера. Роут отвечает 202 сразу, поэтому
 * вызов дешёвый.
 *
 * Повторы здесь не перестраховка. Через эту функцию проходят все пинки — и
 * /reels, и запуск пачки, и само-вызов тика между инвокациями, и суточный крон,
 * — а цепочка держится ровно на них: один потерянный пинок останавливает всю
 * пачку до следующего крона, то есть до завтра. На проде так и вышло: свежий
 * деплой, первый запрос к /api/farm/render не уложился в лимит инициализации,
 * вернул 500, и тринадцать готовых к сборке роликов просто повисли.
 */
export async function triggerRender(batchId: string, deps: TriggerDeps = {}): Promise<void> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const key = tickKey(`render:${batchId}`, requireEnv("FARM_TOKEN_SECRET"));
  const url = `${baseUrl()}/api/farm/render?batch=${encodeURIComponent(batchId)}&key=${key}`;

  let reason = "";
  let made = 0;
  for (let attempt = 0; attempt < TRIGGER_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(TRIGGER_BACKOFF_MS[attempt - 1]);
    made += 1;
    try {
      // fetch не падает на 4xx/5xx: кривой FARM_BASE_URL или чужой ключ без
      // явной проверки выглядели бы как успех, а цепочка молча умирала бы.
      const res = await doFetch(url, { method: "POST", cache: "no-store" });
      if (res.ok) return;
      reason = `вернул ${res.status}`;
      // Отказ по существу (403 с чужим ключом, 404 на кривом адресе) повтором
      // не лечится: тот же запрос даст тот же ответ. Исключения — 408 и 429,
      // это «позже», а не «нельзя».
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (error) {
      // Оборванное соединение неотличимо от перегрузки и лечится тем же повтором.
      reason = (error as Error).message;
    }
  }
  throw new Error(
    `Не удалось запустить рендер: /api/farm/render ${reason} (попыток: ${made} из ${TRIGGER_ATTEMPTS})`
  );
}
