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
  return due.sort((a, b) => Date.parse(b.scheduledAt!) - Date.parse(a.scheduledAt!))[0] ?? null;
}

export async function postOne(item: Item, deps: PostDeps): Promise<void> {
  // В Blob нет compare-and-set, без перечитывания два тика таймера залили бы
  // один ролик дважды.
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
    mediaId = await deps.publishContainer(containerId);
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
