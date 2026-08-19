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
// Ролик на 90 секунд занимает до 120 с процессорного времени: с меньшим резервом
// он упёрся бы в лимит вызова уже с отметкой rendering.
export const ITEM_RESERVE_MS = 150_000;
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

// Статусы, которым исходник ещё нужен: только эти задачи-двойники реально
// упадут при следующем тике на удалённом sourceUrl. Ролик, уже прошедший
// рендер (review/queued/editing/posting/posted), свой videoUrl давно получил
// и трогать его из-за чужого sourceUrl незачем.
const NEEDS_SOURCE_STATUSES = new Set<string>(["pending", "rendering"]);

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
  notify: (text: string, threadId: number | null) => Promise<void>;
  triggerRender: (batchId: string) => Promise<void>;
}

export async function runRenderTick(batchId: string, deps: RenderTickDeps): Promise<void> {
  const startedAt = deps.now();
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
            item.threadId
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

        // Задача-двойник из другой пачки могла ссылаться на тот же sourceUrl:
        // список уже получен этой итерацией (listed) — повторный вызов
        // listItems() здесь сломал бы соседний тест, где второй заход цикла
        // нарочно отдаёт пустой список.
        const twins = listed.filter(
          (i) =>
            i.itemId !== item.itemId &&
            i.sourceUrl === item.sourceUrl &&
            NEEDS_SOURCE_STATUSES.has(i.status)
        );
        for (const twin of twins) {
          try {
            await deps.saveItem({
              ...twin,
              status: "failed",
              sourceUrl: "",
              error: "исходник удалён вместе с задачей-двойником из другой пачки",
            });
          } catch (twinSaveError) {
            console.error("farm twin save failed", twin.itemId, twinSaveError);
            continue;
          }
          try {
            await deps.notify(
              `Ролик ${twin.index}/${twin.total} потерял исходник: тот же файл собрала другая пачка`,
              twin.threadId
            );
          } catch (notifyError) {
            console.error("farm notify failed", twin.itemId, notifyError);
          }
        }

        // Исходник больше не нужен — но только если он больше никому не нужен:
        // одна подложка раздаётся нескольким хукам по кругу, и удалить её сразу
        // значило бы оставить остальные ролики пачки с мёртвой ссылкой. Квота
        // Blob на Hobby при превышении отключает хранилище на 30 дней, поэтому
        // держать лишнее тоже нельзя: удаляем, когда ждущих не осталось.
        const stillNeeded = (await deps.listItems()).some(
          (other) =>
            other.itemId !== item.itemId &&
            other.sourceUrl === item.sourceUrl &&
            (other.status === "pending" || other.status === "rendering")
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
        try {
          await deps.notify(`Ролик ${item.index}/${item.total} не собрался: ${message}`, item.threadId);
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

// Роут возвращает 202 сразу, поэтому вызов дешёвый: он лишь запускает
// следующее звено цепочки рендера.
export async function triggerRender(batchId: string): Promise<void> {
  const key = tickKey(`render:${batchId}`, requireEnv("FARM_TOKEN_SECRET"));
  const url = `${baseUrl()}/api/farm/render?batch=${encodeURIComponent(batchId)}&key=${key}`;
  const res = await fetch(url, { method: "POST", cache: "no-store" });
  // fetch не падает на 4xx/5xx: кривой FARM_BASE_URL или чужой ключ без этой
  // проверки выглядели бы как успех, а цепочка рендера молча умирала бы.
  if (!res.ok) throw new Error(`Не удалось запустить рендер: /api/farm/render вернул ${res.status}`);
}
