# Ферма рилсов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Телеграм-бот принимает пачку подложек и текстов, накладывает хуки через ffmpeg, спрашивает апрув по каждому ролику и сам публикует одобренное в Trial Reels `@daristeppe` по расписанию.

**Architecture:** Всё живёт в существующем проекте `reels-report-bot` (корень репозитория) и в существующем боте отчётов: у бота Telegram может быть только один вебхук, а отдельный проект потребовал бы второй копии IG-токена. Новый код изолирован в `lib/farm/*` и `app/api/farm/*`, существующие модули не переписываются — единственная правка живого кода — вынос диспетчера команд из `app/api/telegram/route.ts`. Состояние хранится файлами в Blob под префиксом `farm/`, без БД, по образцу `dub-bot`. Долгая работа режется на цепочки самовызовов с бюджетом на вызов.

**Tech Stack:** Next.js 16 (App Router, runtime nodejs), TypeScript, `@vercel/blob` v2, vitest, `ffmpeg-static` + `ffprobe-static`, Instagram Graph API через Facebook Login (`graph.facebook.com`) для публикации, Telegram Bot API. Отчётный бот при этом остаётся на Instagram Login (`graph.instagram.com`) — ферма его токен не трогает.

**Spec:** `docs/superpowers/specs/2026-08-19-reels-farm-bot-design.md`

## Global Constraints

Требования спеки, действующие во всех задачах:

- Тест-команда проекта: `npm test` (vitest, `include: ["tests/**/*.test.ts"]`, environment node). Тесты фермы лежат в `tests/farm-*.test.ts`.
- Ни ffmpeg, ни Instagram, ни Telegram, ни Blob в тестах не вызываются по-настоящему: раннеры и `fetch` инжектируются или мокаются.
- Комментарии — на русском и только там, где объясняют неочевидное решение (стиль `dub-bot` и корневого проекта). Комментарии-подписи к очевидным строкам не пишем.
- Валидация входа: блоков текста = числу файлов; хук ≤ 3 строк по ≤ 20 знаков; описание ≤ 2200 знаков; файл ≤ 60 МБ; пачка ≤ 1 ГБ; файлов ≤ 50.
- Подпись к видео в Telegram: лимит 1024 знака, описание в подписи обрезается до 700.
- Слоты публикации: старт 09:00, интервал 45 минут, 15 слотов в день, зона `Asia/Jakarta`, ближайший слот не раньше чем через 5 минут.
- Бюджет вызова рендера: 240 000 мс, резерв на один ролик 150 000 мс, `maxDuration = 300`.
- Брошенной считается работа с отметкой `renderingAt`/`postingAt` старше 300 000 мс.
- ffmpeg: `-t 90`, `libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 30`, `-c:a aac -b:a 128k`, `-movflags +faststart`, кадр `1080×1920` через `scale=...:force_original_aspect_ratio=increase` + `crop`.
- Стиль хука: `fontsize=64`, `fontcolor=white`, `borderw=6`, `bordercolor=black@0.9`, `line_spacing=12`, `x=(w-text_w)/2`, `y=h*0.18`. Значения предварительные, калибруются по эталонному ролику.
- Текст хука передаётся в `drawtext` через `textfile=`, не в строке фильтра.
- Исходник удаляется сразу после успешного рендера; готовый ролик — после успешной публикации.
- Trial: контейнер `media_type=REELS` + `trial_params={"graduation_strategy":"MANUAL"}` на `https://graph.facebook.com/v23.0` (проверено 19.08.2026), токен `FARM_IG_TOKEN`, аккаунт `FARM_IG_ID`.
- Заливка, оборвавшаяся после `media_publish`, **не повторяется** — ролик уходит в `failed` с просьбой проверить ленту.
- Уборка: `posted`/`rejected`/`failed` старше 3 дней; `review`/`editing` старше 7 дней; застрявшие `rendering`/`posting` старше 30 минут.
- Никаких `git commit`/`push` внутри задач сверх шагов «Commit», описанных в плане. Коммит — по одному на задачу.

## File Structure

Создаётся:

| Файл | Ответственность |
|---|---|
| `lib/farm/types.ts` | `Item`, `ItemStatus`, `Batch`, `Pair` — общие типы |
| `lib/farm/parse.ts` | разбор блоков текста в пары «хук + описание» и валидация |
| `lib/farm/wrap.ts` | перенос хука по словам под кадр |
| `lib/farm/tokens.ts` | HMAC-подпись ссылки на пачку и ключи тиков |
| `lib/farm/store.ts` | item/batch файлы в Blob, префикс `farm/` |
| `lib/farm/slots.ts` | назначение слота публикации в `Asia/Jakarta` |
| `lib/farm/render.ts` | аргументы ffmpeg и рендер через инжектируемый раннер |
| `lib/farm/telegram.ts` | видео с кнопками, правка подписи, ответ на callback, `force_reply` |
| `lib/farm/instagram.ts` | контейнер Trial → опрос → публикация → permalink |
| `lib/farm/commands.ts` | `/batch`, `/reels`, разбор `callback_data`, текст очереди |
| `lib/farm/tick.ts` | цепочка рендера пачки |
| `lib/farm/approve.ts` | обработка нажатий кнопок и правки описания |
| `lib/farm/post.ts` | заливка одного ролика по наступившему слоту |
| `lib/farm/daily.ts` | уборка, снятие застрявших, добор просроченных |
| `app/api/farm/upload/route.ts` | выдача токена прямой загрузки в Blob |
| `app/api/farm/start/route.ts` | приём пачки, создание задач |
| `app/api/farm/render/route.ts` | тик рендера |
| `app/api/farm/post/route.ts` | тик заливки для внешнего таймера |
| `app/api/farm/daily/route.ts` | суточный крон |
| `app/farm/[token]/page.tsx` | страница пачки |
| `app/farm/[token]/batch-form.tsx` | клиентская форма загрузки |
| `assets/hook.ttf` | шрифт хука |

Модифицируется: `app/api/telegram/route.ts` (диспетчер команд + `callback_query`), `next.config.ts` (`outputFileTracingIncludes`), `vercel.json` (второй крон), `package.json` (ffmpeg-static, ffprobe-static).

---

### Task 0: Проверка `trial_params` — ВЫПОЛНЕНО 19.08.2026

Выход задачи — ответ, а не код. Ответ получен, задача закрыта.

**Что сделано.** На `graph.facebook.com/v23.0/17841413773053161/media` (аккаунт
`daristeppe`, связанная страница Facebook — «Видео из Фото») создано два контейнера:
A без `trial_params`, B с `{"graduation_strategy":"MANUAL"}`. Оба вернули `id`
(`18163114942459102` и `18163114945459102`). `media_publish` не вызывался — контейнеры
истекли сами, на аккаунте ничего не появилось.

**Токен проверки** — User Token из Graph API Explorer, приложение `1732393271246702`,
среди прав присутствует `instagram_content_publish`. App Review не потребовался:
публикация идёт на собственный аккаунт при роли админа приложения.

**Следствия для плана:**

- Task 8 пишется под `graph.facebook.com`, а не `graph.instagram.com`.
- Ферма получает собственный токен `FARM_IG_TOKEN` и `FARM_IG_ID`; `IG_ACCESS_TOKEN`
  и `IG_USER_ID` остаются отчётному боту нетронутыми.
- Добавлена Task 8b: обмен короткого токена на долгоживущий и его хранение.
- ~~Проверка Instagram Login~~ не нужна: путь Facebook Login работает.

- [x] Проверка выполнена
- [x] Результат записан в спеку (раздел «Открытые пункты»)

---

### Task 1: Типы и разбор входа

**Files:**
- Create: `lib/farm/types.ts`, `lib/farm/parse.ts`
- Test: `tests/farm-parse.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `ItemStatus`, `Item`, `Batch`, `Pair` из `lib/farm/types.ts`; `parseBlocks(raw: string): { pairs: Pair[]; errors: string[] }`, константы `MAX_CAPTION = 2200`, `BLOCK_SEPARATOR = "---"` из `lib/farm/parse.ts`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-parse.test.ts
import { describe, expect, it } from "vitest";
import { parseBlocks } from "../lib/farm/parse";

describe("parseBlocks", () => {
  it("первая строка блока — хук, остальное — описание", () => {
    const { pairs, errors } = parseBlocks("Хук один\nОписание раз\nвторая строка\n---\nХук два\nОписание два");
    expect(errors).toEqual([]);
    expect(pairs).toEqual([
      { hook: "Хук один", caption: "Описание раз\nвторая строка" },
      { hook: "Хук два", caption: "Описание два" },
    ]);
  });

  it("переносит \\r\\n и терпит лишние разделители и пустые блоки", () => {
    const { pairs, errors } = parseBlocks("Хук\r\nОписание\r\n---\n---\n\n---\nХук два\nОписание два\n");
    expect(errors).toEqual([]);
    expect(pairs).toHaveLength(2);
  });

  it("блок без описания — ошибка с номером блока", () => {
    const { pairs, errors } = parseBlocks("Только хук");
    expect(pairs).toHaveLength(0);
    expect(errors).toEqual(["блок 1: есть хук, но нет описания"]);
  });

  it("описание длиннее 2200 знаков — ошибка", () => {
    const { errors } = parseBlocks(`Хук\n${"я".repeat(2201)}`);
    expect(errors).toEqual(["блок 1: описание 2201 знаков, лимит 2200"]);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-parse.test.ts`
Expected: FAIL — `Cannot find module '../lib/farm/parse'`.

- [ ] **Step 3: Написать типы**

```ts
// lib/farm/types.ts
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
  createdAt: string;
}
```

- [ ] **Step 4: Написать разбор**

```ts
// lib/farm/parse.ts
import { Pair } from "./types";

export const BLOCK_SEPARATOR = "---";
export const MAX_CAPTION = 2200;

export interface ParseResult {
  pairs: Pair[];
  errors: string[];
}

// Описания многострочные, поэтому «одна строка — один ролик» не годится: блоки
// разделяются строкой ---, а первая строка блока считается хуком.
export function parseBlocks(raw: string): ParseResult {
  const blocks = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce<string[][]>(
      (acc, line) => {
        if (line.trim() === BLOCK_SEPARATOR) acc.push([]);
        else acc[acc.length - 1].push(line);
        return acc;
      },
      [[]]
    )
    .map((lines) => lines.join("\n").trim())
    .filter((block) => block.length > 0);

  const pairs: Pair[] = [];
  const errors: string[] = [];

  blocks.forEach((block, i) => {
    const lines = block.split("\n");
    const hook = lines[0].trim();
    const caption = lines.slice(1).join("\n").trim();
    if (!caption) {
      errors.push(`блок ${i + 1}: есть хук, но нет описания`);
      return;
    }
    if (caption.length > MAX_CAPTION) {
      errors.push(`блок ${i + 1}: описание ${caption.length} знаков, лимит ${MAX_CAPTION}`);
      return;
    }
    pairs.push({ hook, caption });
  });

  return { pairs, errors };
}
```

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS, существующие тесты корневого проекта не тронуты.

```bash
git add lib/farm/types.ts lib/farm/parse.ts tests/farm-parse.test.ts
git commit -m "feat(farm): типы фермы и разбор блоков хук+описание"
```

---

### Task 2: Перенос хука под кадр

**Files:**
- Create: `lib/farm/wrap.ts`
- Test: `tests/farm-wrap.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `wrapHook(hook: string, maxChars?: number, maxLines?: number): string[] | null`, константы `HOOK_LINE_CHARS = 20`, `HOOK_MAX_LINES = 3`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-wrap.test.ts
import { describe, expect, it } from "vitest";
import { HOOK_LINE_CHARS, wrapHook } from "../lib/farm/wrap";

describe("wrapHook", () => {
  it("режет по словам, не превышая лимит строки", () => {
    const lines = wrapHook("Jangan tunggu Ramadan untuk mulai");
    expect(lines).toEqual(["Jangan tunggu", "Ramadan untuk mulai"]);
    for (const line of lines!) expect(line.length).toBeLessThanOrEqual(HOOK_LINE_CHARS);
  });

  it("не влезающий в 3 строки хук отвергается", () => {
    expect(wrapHook("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh")).toBeNull();
  });

  it("слово длиннее строки отвергается: в кадре оно всё равно вылезет", () => {
    expect(wrapHook("Assalamualaikumwarahmatullahi")).toBeNull();
  });

  it("схлопывает лишние пробелы и переносы", () => {
    expect(wrapHook("  Kamu   sibuk?\n Justru itu  ")).toEqual(["Kamu sibuk?", "Justru itu"]);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-wrap.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/wrap.ts
export const HOOK_LINE_CHARS = 20;
export const HOOK_MAX_LINES = 3;

// drawtext сам не переносит: длинный хук уехал бы за кадр. Считаем перенос здесь,
// а страница загрузки не пропускает хук, для которого перенос невозможен.
export function wrapHook(
  hook: string,
  maxChars: number = HOOK_LINE_CHARS,
  maxLines: number = HOOK_MAX_LINES
): string[] | null {
  const words = hook.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.some((w) => w.length > maxChars)) return null;

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);

  return lines.length <= maxLines ? lines : null;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/wrap.ts tests/farm-wrap.test.ts
git commit -m "feat(farm): перенос хука по словам под кадр"
```

---

### Task 3: Токены ссылки и ключи тиков

**Files:**
- Create: `lib/farm/tokens.ts`
- Test: `tests/farm-tokens.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `BATCH_TOKEN_TTL_MS`, `signBatchToken(chatId, threadId, expiresAt, secret)`, `verifyBatchToken(token, secret, nowMs): { chatId: number; threadId: number | null } | null`, `tickKey(scope: string, secret: string): string`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-tokens.test.ts
import { describe, expect, it } from "vitest";
import { signBatchToken, tickKey, verifyBatchToken } from "../lib/farm/tokens";

const SECRET = "s3cret";
const NOW = 1_760_000_000_000;

describe("batch token", () => {
  it("возвращает чат и тему", () => {
    const token = signBatchToken(-100123, 42, NOW + 1000, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toEqual({ chatId: -100123, threadId: 42 });
  });

  it("тема может отсутствовать", () => {
    const token = signBatchToken(-100123, null, NOW + 1000, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toEqual({ chatId: -100123, threadId: null });
  });

  it("просроченный не принимается", () => {
    const token = signBatchToken(1, null, NOW - 1, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toBeNull();
  });

  it("чужая подпись не принимается", () => {
    const token = signBatchToken(1, null, NOW + 1000, "other");
    expect(verifyBatchToken(token, SECRET, NOW)).toBeNull();
  });

  it("подделка полезной нагрузки не принимается", () => {
    const token = signBatchToken(1, null, NOW + 1000, SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from("999.-.99999999999999").toString("base64url")}.${sig}`;
    expect(verifyBatchToken(forged, SECRET, NOW)).toBeNull();
  });
});

describe("tickKey", () => {
  it("детерминирован и различает области", () => {
    expect(tickKey("render:abc", SECRET)).toBe(tickKey("render:abc", SECRET));
    expect(tickKey("render:abc", SECRET)).not.toBe(tickKey("post", SECRET));
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-tokens.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/tokens.ts
import crypto from "node:crypto";

// Ссылка на страницу пачки живёт полчаса: хватает выбрать файлы и вставить текст,
// но недостаточно, чтобы она где-то осела.
export const BATCH_TOKEN_TTL_MS = 30 * 60 * 1000;

// Токен нигде не хранится: чат, тема и срок годности зашиты в саму подпись.
export function signBatchToken(
  chatId: number,
  threadId: number | null,
  expiresAt: number,
  secret: string
): string {
  const payload = `${chatId}.${threadId ?? ""}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyBatchToken(
  token: string,
  secret: string,
  nowMs: number
): { chatId: number; threadId: number | null } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  const [chatRaw, threadRaw, expiresRaw] = payload.split(".");
  const chatId = Number(chatRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(chatId) || !Number.isFinite(expiresAt)) return null;
  if (nowMs > expiresAt) return null;
  return { chatId, threadId: threadRaw === "" ? null : Number(threadRaw) };
}

// Роуты тиков дёргают сами себя и внешний таймер, поэтому наружу они закрыты
// отдельным ключом: чужой запрос иначе запускал бы рендер и заливку.
export function tickKey(scope: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`tick.${scope}`).digest("base64url");
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/tokens.ts tests/farm-tokens.test.ts
git commit -m "feat(farm): подписанные ссылки на пачку и ключи тиков"
```

---

### Task 4: Хранилище задач в Blob

**Files:**
- Create: `lib/farm/store.ts`
- Test: `tests/farm-store.test.ts`

**Interfaces:**
- Consumes: `Item`, `Batch` из `lib/farm/types.ts`.
- Produces: `ITEMS_PREFIX`, `BATCHES_PREFIX`, `SOURCES_PREFIX`, `OUT_PREFIX`, `itemPath(itemId)`, `saveItem(item)`, `loadItem(itemId)`, `listItems()`, `saveBatch(batch)`, `deleteBlobQuiet(url)`, `isActive(item)`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const list = vi.fn();
const del = vi.fn();
vi.mock("@vercel/blob", () => ({ put, list, del }));

import { isActive, itemPath, loadItem, saveItem } from "../lib/farm/store";
import { Item } from "../lib/farm/types";

const item: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 2,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};

beforeEach(() => {
  put.mockReset();
  list.mockReset();
  del.mockReset();
  vi.unstubAllGlobals();
});

describe("saveItem", () => {
  it("пишет по стабильному пути с перезаписью", async () => {
    await saveItem(item);
    expect(put).toHaveBeenCalledWith(
      "farm/items/i1.json",
      JSON.stringify(item),
      expect.objectContaining({ addRandomSuffix: false, allowOverwrite: true })
    );
  });
});

describe("loadItem", () => {
  it("читает с cache-busting: без него тик увидел бы устаревший статус", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: itemPath("i1"), url: "https://blob/i1.json" }] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...item, status: "review" })));
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadItem("i1");

    expect(loaded?.status).toBe("review");
    expect(String(fetchMock.mock.calls[0][0])).toContain("?ts=");
  });

  it("нет блоба — null", async () => {
    list.mockResolvedValue({ blobs: [] });
    expect(await loadItem("nope")).toBeNull();
  });
});

describe("isActive", () => {
  it("активны все промежуточные статусы, включая заливку", () => {
    for (const status of ["pending", "rendering", "review", "editing", "queued", "posting"] as const) {
      expect(isActive({ ...item, status })).toBe(true);
    }
    for (const status of ["rejected", "posted", "failed"] as const) {
      expect(isActive({ ...item, status })).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-store.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/store.ts
import { del, list, put } from "@vercel/blob";
import { Batch, Item } from "./types";

export const ITEMS_PREFIX = "farm/items/";
export const BATCHES_PREFIX = "farm/batches/";
export const SOURCES_PREFIX = "farm/sources/";
export const OUT_PREFIX = "farm/out/";

export function itemPath(itemId: string): string {
  return `${ITEMS_PREFIX}${itemId}.json`;
}

// Уборка и /reels обязаны считать активными и правку, и заливку: иначе первая
// удалит файлы у ролика, который человек как раз редактирует.
export function isActive(item: Item): boolean {
  return !["rejected", "posted", "failed"].includes(item.status);
}

export async function saveItem(item: Item): Promise<void> {
  await put(itemPath(item.itemId), JSON.stringify(item), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function saveBatch(batch: Batch): Promise<void> {
  await put(`${BATCHES_PREFIX}${batch.batchId}.json`, JSON.stringify(batch), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

// Blob кэшируется на CDN, поэтому читаем всегда с cache-busting: иначе тик
// увидит устаревший статус и отправит ролик или опубликует его дважды.
async function readJson<T>(url: string): Promise<T | null> {
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadItem(itemId: string): Promise<Item | null> {
  const path = itemPath(itemId);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  return readJson<Item>(blob.url);
}

export async function listItems(): Promise<Item[]> {
  const { blobs } = await list({ prefix: ITEMS_PREFIX });
  const items: Item[] = [];
  for (const blob of blobs) {
    const item = await readJson<Item>(blob.url);
    if (item) items.push(item);
  }
  return items;
}

export async function deleteBlobQuiet(url: string): Promise<void> {
  // Упасть на уборке нельзя: ролик уже отправлен или опубликован.
  try {
    await del(url);
  } catch (error) {
    console.error("farm blob delete failed", url, error);
  }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/store.ts tests/farm-store.test.ts
git commit -m "feat(farm): хранилище задач и пачек в Blob"
```

---

### Task 5: Слоты публикации

**Files:**
- Create: `lib/farm/slots.ts`
- Test: `tests/farm-slots.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `SlotConfig`, `DEFAULT_SLOTS: SlotConfig`, `slotConfigFromEnv()`, `nextFreeSlot(taken: string[], nowMs: number, cfg?: SlotConfig, leadMs?: number): string`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-slots.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SLOTS, nextFreeSlot } from "../lib/farm/slots";

// 19 августа 2026, 02:00 UTC = 09:00 в Джакарте (UTC+7).
const AT_0900_JKT = Date.parse("2026-08-19T02:00:00.000Z");

describe("nextFreeSlot", () => {
  it("первый свободный слот дня, с учётом упреждения 5 минут", () => {
    // 08:30 по Джакарте — слот 09:00 ещё впереди.
    const slot = nextFreeSlot([], AT_0900_JKT - 30 * 60_000, DEFAULT_SLOTS);
    expect(slot).toBe("2026-08-19T02:00:00.000Z");
  });

  it("занятые слоты пропускаются", () => {
    const slot = nextFreeSlot(["2026-08-19T02:00:00.000Z"], AT_0900_JKT - 30 * 60_000, DEFAULT_SLOTS);
    expect(slot).toBe("2026-08-19T02:45:00.000Z");
  });

  it("слот, до которого меньше 5 минут, не берётся", () => {
    const slot = nextFreeSlot([], AT_0900_JKT - 60_000, DEFAULT_SLOTS);
    expect(slot).toBe("2026-08-19T02:45:00.000Z");
  });

  it("кончились 15 слотов дня — переходит на 09:00 завтра", () => {
    const taken = Array.from({ length: DEFAULT_SLOTS.perDay }, (_, i) =>
      new Date(AT_0900_JKT + i * DEFAULT_SLOTS.minutes * 60_000).toISOString()
    );
    expect(nextFreeSlot(taken, AT_0900_JKT - 30 * 60_000, DEFAULT_SLOTS)).toBe("2026-08-20T02:00:00.000Z");
  });

  it("вечером после последнего слота — сразу утро следующего дня", () => {
    const atNight = Date.parse("2026-08-19T15:00:00.000Z"); // 22:00 в Джакарте
    expect(nextFreeSlot([], atNight, DEFAULT_SLOTS)).toBe("2026-08-20T02:00:00.000Z");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-slots.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/slots.ts
export interface SlotConfig {
  startHHMM: string;
  minutes: number;
  perDay: number;
  tz: string;
}

export const DEFAULT_SLOTS: SlotConfig = {
  startHHMM: "09:00",
  minutes: 45,
  perDay: 15,
  tz: "Asia/Jakarta",
};

export function slotConfigFromEnv(): SlotConfig {
  return {
    startHHMM: process.env.FARM_SLOT_START || DEFAULT_SLOTS.startHHMM,
    minutes: Number(process.env.FARM_SLOT_MINUTES) || DEFAULT_SLOTS.minutes,
    perDay: Number(process.env.FARM_SLOTS_PER_DAY) || DEFAULT_SLOTS.perDay,
    tz: process.env.FARM_TZ || DEFAULT_SLOTS.tz,
  };
}

// Смещение зоны в минутах на конкретный момент. Считаем через Intl, а не константой:
// Джакарта без переходов, но правило не должно врать при смене зоны в настройках.
function offsetMinutes(tz: string, atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atUtcMs));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"));
  return (asUtc - atUtcMs) / 60_000;
}

// Момент локального времени в UTC. Смещение зависит от самого момента, поэтому
// уточняем его вторым проходом — иначе на границе перехода зоны ошиблись бы на час.
function localToUtcMs(tz: string, dayKey: string, hhmm: string): number {
  const naive = Date.parse(`${dayKey}T${hhmm}:00.000Z`);
  let guess = naive - offsetMinutes(tz, naive) * 60_000;
  guess = naive - offsetMinutes(tz, guess) * 60_000;
  return guess;
}

function dayKey(tz: string, atUtcMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atUtcMs));
}

export function nextFreeSlot(
  taken: string[],
  nowMs: number,
  cfg: SlotConfig = DEFAULT_SLOTS,
  leadMs: number = 5 * 60_000
): string {
  const busy = new Set(taken);
  const earliest = nowMs + leadMs;

  // 60 дней вперёд — с запасом: при 15 слотах в день это 900 роликов, больше
  // любой реальной очереди, а бесконечный цикл здесь недопустим.
  for (let dayOffset = 0; dayOffset < 60; dayOffset += 1) {
    const key = dayKey(cfg.tz, nowMs + dayOffset * 86_400_000);
    const first = localToUtcMs(cfg.tz, key, cfg.startHHMM);
    for (let i = 0; i < cfg.perDay; i += 1) {
      const at = first + i * cfg.minutes * 60_000;
      if (at < earliest) continue;
      const iso = new Date(at).toISOString();
      if (!busy.has(iso)) return iso;
    }
  }
  throw new Error("Свободных слотов не нашлось на 60 дней вперёд");
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS. Если тест на переход суток красный — сверить, что `dayKey` берётся от `nowMs + смещение дней`, а не от UTC-полуночи.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/slots.ts tests/farm-slots.test.ts
git commit -m "feat(farm): назначение слотов публикации в Asia/Jakarta"
```

---

### Task 6: Аргументы ffmpeg и рендер

**Files:**
- Create: `lib/farm/render.ts`
- Modify: `package.json` (зависимости `ffmpeg-static`, `ffprobe-static`), `next.config.ts`
- Test: `tests/farm-render.test.ts`

**Interfaces:**
- Consumes: `wrapHook` из `lib/farm/wrap.ts`.
- Produces: `RenderSpec`, `ffmpegArgs(spec: RenderSpec): string[]`, `Runner`, `renderHook(spec, deps: { runner: Runner; writeText: (path: string, text: string) => Promise<void>; ffmpegPath: string }): Promise<void>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-render.test.ts
import { describe, expect, it, vi } from "vitest";
import { ffmpegArgs, renderHook } from "../lib/farm/render";

const spec = {
  sourcePath: "/tmp/src.mp4",
  textPath: "/tmp/hook.txt",
  outPath: "/tmp/out.mp4",
  fontPath: "/app/assets/hook.ttf",
  hookLines: ["Jangan tunggu", "Ramadan"],
  hasAudio: true,
};

describe("ffmpegArgs", () => {
  it("кадрирует в 1080x1920 и берёт текст из файла, а не из строки фильтра", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(args).toContain("crop=1080:1920");
    expect(args).toContain("textfile=/tmp/hook.txt");
    expect(args).not.toContain("text=");
  });

  it("держит параметры стиля и потолок длительности", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("fontsize=64");
    expect(args).toContain("borderw=6");
    expect(args).toContain("y=h*0.18");
    expect(args).toContain("-t 90");
    expect(args).toContain("-movflags +faststart");
  });

  it("без звука в исходнике подмешивает тишину: IG надёжнее принимает ролик со звуковой дорожкой", () => {
    const args = ffmpegArgs({ ...spec, hasAudio: false }).join(" ");
    expect(args).toContain("anullsrc");
    expect(args).toContain("-shortest");
  });
});

describe("renderHook", () => {
  it("пишет текст хука в файл перед запуском", async () => {
    const writeText = vi.fn(async () => {});
    const runner = vi.fn(async () => ({ code: 0, stderr: "" }));

    await renderHook(spec, { runner, writeText, ffmpegPath: "/bin/ffmpeg" });

    expect(writeText).toHaveBeenCalledWith("/tmp/hook.txt", "Jangan tunggu\nRamadan");
    expect(runner).toHaveBeenCalledWith("/bin/ffmpeg", expect.arrayContaining(["-i", "/tmp/src.mp4"]));
  });

  it("ненулевой код возврата — ошибка с хвостом stderr", async () => {
    const runner = vi.fn(async () => ({ code: 1, stderr: "x".repeat(900) + "boom" }));
    await expect(
      renderHook(spec, { runner, writeText: async () => {}, ffmpegPath: "/bin/ffmpeg" })
    ).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-render.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/render.ts
export interface RenderSpec {
  sourcePath: string;
  textPath: string;
  outPath: string;
  fontPath: string;
  hookLines: string[];
  hasAudio: boolean;
}

export type Runner = (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>;

export interface RenderDeps {
  runner: Runner;
  writeText: (path: string, text: string) => Promise<void>;
  ffmpegPath: string;
}

const STYLE = "fontsize=64:fontcolor=white:borderw=6:bordercolor=black@0.9:line_spacing=12";

export function ffmpegArgs(spec: RenderSpec): string[] {
  // Текст отдаём файлом: в строке фильтра символы : ' % \ и запятая ломают разбор,
  // а апострофы в индонезийском (Qur'an) встречаются постоянно.
  const filter = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    `drawtext=fontfile=${spec.fontPath}:textfile=${spec.textPath}:${STYLE}:x=(w-text_w)/2:y=h*0.18`,
  ].join(",");

  return [
    "-y",
    "-i",
    spec.sourcePath,
    ...(spec.hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]),
    "-vf",
    filter,
    ...(spec.hasAudio ? [] : ["-shortest"]),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    "90",
    spec.outPath,
  ];
}

export async function renderHook(spec: RenderSpec, deps: RenderDeps): Promise<void> {
  await deps.writeText(spec.textPath, spec.hookLines.join("\n"));
  const { code, stderr } = await deps.runner(deps.ffmpegPath, ffmpegArgs(spec));
  if (code !== 0) throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-600)}`);
}
```

- [ ] **Step 4: Поставить бинарники и включить их в бандл**

```bash
npm install ffmpeg-static ffprobe-static
```

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Бинарники ffmpeg лежат в node_modules и не попадают в трассировку сами:
  // без этого рендер на Vercel падает с ENOENT.
  outputFileTracingIncludes: {
    "/api/farm/render": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
      "./assets/hook.ttf",
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add lib/farm/render.ts tests/farm-render.test.ts next.config.ts package.json package-lock.json
git commit -m "feat(farm): аргументы ffmpeg и рендер хука через инжектируемый раннер"
```

---

### Task 7: Telegram-примитивы фермы

**Files:**
- Create: `lib/farm/telegram.ts`
- Test: `tests/farm-telegram.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `approvalKeyboard(itemId: string)`, `sendVideoWithButtons({ chatId, threadId, videoUrl, caption, itemId }): Promise<number>`, `editCaption(chatId, messageId, caption)`, `dropKeyboard(chatId, messageId)`, `answerCallback(callbackId, text)`, `askForReply({ chatId, threadId, text }): Promise<number>`, `farmCaption(index, total, hook, caption): string`, `CAPTION_BODY_LIMIT = 700`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-telegram.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalKeyboard, farmCaption, sendVideoWithButtons } from "../lib/farm/telegram";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "T";
  vi.unstubAllGlobals();
});

describe("approvalKeyboard", () => {
  it("три кнопки, callback_data влезает в лимит 64 байта", () => {
    const kb = approvalKeyboard("6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f");
    const buttons = kb.inline_keyboard[0];
    expect(buttons.map((b) => b.callback_data)).toEqual([
      "a:6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f",
      "r:6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f",
      "e:6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f",
    ]);
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});

describe("farmCaption", () => {
  it("режет описание до 700 знаков: лимит подписи Telegram 1024", () => {
    const caption = farmCaption(7, 30, "Хук", "я".repeat(2000));
    expect(caption).toContain("7/30");
    expect(caption).toContain("…");
    expect(caption.length).toBeLessThanOrEqual(1024);
  });

  it("короткое описание не трогает", () => {
    expect(farmCaption(1, 2, "Хук", "Описание")).toBe("1/2\n\nХук\n\nОписание");
  });
});

describe("sendVideoWithButtons", () => {
  it("возвращает message_id и передаёт тему форума", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 555 } })));
    vi.stubGlobal("fetch", fetchMock);

    const id = await sendVideoWithButtons({
      chatId: -100, threadId: 42, videoUrl: "https://blob/out.mp4",
      caption: "1/1", itemId: "i1",
    });

    expect(id).toBe(555);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.message_thread_id).toBe(42);
    expect(body.reply_markup.inline_keyboard[0]).toHaveLength(3);
  });

  it("отказ Telegram — исключение с текстом ответа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too big", { status: 400 })));
    await expect(
      sendVideoWithButtons({ chatId: -100, threadId: null, videoUrl: "u", caption: "c", itemId: "i" })
    ).rejects.toThrow(/too big/);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-telegram.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/telegram.ts
export const CAPTION_BODY_LIMIT = 700;

interface Button {
  text: string;
  callback_data: string;
}

export interface Keyboard {
  inline_keyboard: Button[][];
}

function api(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Telegram ${method} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

export function approvalKeyboard(itemId: string): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Залить", callback_data: `a:${itemId}` },
        { text: "❌ Выкинуть", callback_data: `r:${itemId}` },
        { text: "✏️ Текст", callback_data: `e:${itemId}` },
      ],
    ],
  };
}

// Подпись к видео в Telegram ограничена 1024 знаками против 2200 в Instagram,
// поэтому описание здесь урезано: полный текст всё равно уходит в публикацию.
export function farmCaption(index: number, total: number, hook: string, caption: string): string {
  const body = caption.length > CAPTION_BODY_LIMIT ? `${caption.slice(0, CAPTION_BODY_LIMIT)}…` : caption;
  return `${index}/${total}\n\n${hook}\n\n${body}`;
}

export async function sendVideoWithButtons(args: {
  chatId: number;
  threadId: number | null;
  videoUrl: string;
  caption: string;
  itemId: string;
}): Promise<number> {
  const result = await call("sendVideo", {
    chat_id: args.chatId,
    ...(args.threadId ? { message_thread_id: args.threadId } : {}),
    video: args.videoUrl,
    caption: args.caption,
    supports_streaming: true,
    reply_markup: approvalKeyboard(args.itemId),
  });
  return (result.result as { message_id: number }).message_id;
}

export async function editCaption(chatId: number, messageId: number, caption: string): Promise<void> {
  await call("editMessageCaption", { chat_id: chatId, message_id: messageId, caption });
}

export async function dropKeyboard(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

// Без ответа на callback у человека в клиенте крутится вечный спиннер.
export async function answerCallback(callbackId: string, text: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, text });
}

export async function askForReply(args: { chatId: number; threadId: number | null; text: string }): Promise<number> {
  const result = await call("sendMessage", {
    chat_id: args.chatId,
    ...(args.threadId ? { message_thread_id: args.threadId } : {}),
    text: args.text,
    reply_markup: { force_reply: true },
  });
  return (result.result as { message_id: number }).message_id;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/telegram.ts tests/farm-telegram.test.ts
git commit -m "feat(farm): видео с кнопками, правка подписи и ответы на callback"
```

---

### Task 8: Публикация в Trial Reels

Task 0 закрыта: базовый URL — **`https://graph.facebook.com/v23.0`**, токен — `FARM_IG_TOKEN`, id аккаунта — `FARM_IG_ID`. Проверено на живом аккаунте, `trial_params` принимается.

**Files:**
- Create: `lib/farm/instagram.ts`
- Test: `tests/farm-instagram.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `PublishDeps { token: string; igUserId: string; sleep?: (ms: number) => Promise<void> }`, `createTrialContainer(videoUrl, caption, deps): Promise<string>`, `waitForContainer(containerId, deps, opts?): Promise<void>`, `publishContainer(containerId, deps): Promise<string>`, `fetchPermalink(mediaId, deps): Promise<string>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-instagram.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTrialContainer, publishContainer, waitForContainer } from "../lib/farm/instagram";

const deps = { token: "TK", igUserId: "17841400000000000", sleep: async () => {} };

beforeEach(() => vi.unstubAllGlobals());

describe("createTrialContainer", () => {
  it("отправляет media_type=REELS и trial_params с ручным выпуском", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "C1" })));
    vi.stubGlobal("fetch", fetchMock);

    const id = await createTrialContainer("https://blob/out.mp4", "описание", deps);

    expect(id).toBe("C1");
    const body = String(fetchMock.mock.calls[0][1]!.body);
    expect(body).toContain("media_type=REELS");
    expect(body).toContain(encodeURIComponent('{"graduation_strategy":"MANUAL"}'));
    expect(body).toContain("video_url=");
  });

  it("отказ по правам или параметру отдаёт текст ответа наружу", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "(#3) Application does not have permission", code: 3 },
    }), { status: 400 })));

    await expect(createTrialContainer("u", "c", deps)).rejects.toThrow(/does not have permission/);
  });
});

describe("waitForContainer", () => {
  it("ждёт IN_PROGRESS и выходит на FINISHED", async () => {
    const codes = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: codes.shift() }))));
    await expect(waitForContainer("C1", deps)).resolves.toBeUndefined();
    expect(codes).toHaveLength(0);
  });

  it("ERROR — исключение, повторять нечего", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: "ERROR" }))));
    await expect(waitForContainer("C1", deps)).rejects.toThrow(/ERROR/);
  });

  it("не ждёт дольше отведённого времени", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: "IN_PROGRESS" }))));
    await expect(waitForContainer("C1", deps, { timeoutMs: 0 })).rejects.toThrow(/не дождался/);
  });
});

describe("publishContainer", () => {
  it("возвращает id опубликованного медиа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "M1" }))));
    expect(await publishContainer("C1", deps)).toBe("M1");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-instagram.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/instagram.ts
// Facebook Login, а не graph.instagram.com: trial_params живёт здесь — проверено
// на живом аккаунте 19.08.2026, оба контейнера создались.
const G = "https://graph.facebook.com/v23.0";

export interface PublishDeps {
  token: string;
  igUserId: string;
  sleep?: (ms: number) => Promise<void>;
}

const POLL_INTERVAL_MS = 10_000;
const CONTAINER_TIMEOUT_MS = 4 * 60_000;

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message || text;
  } catch {
    return text;
  }
}

export async function createTrialContainer(
  videoUrl: string,
  caption: string,
  deps: PublishDeps
): Promise<string> {
  const body = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    // Ролик уходит только не-подписчикам; выпуск в ленту остаётся ручным
    // решением в приложении.
    trial_params: JSON.stringify({ graduation_strategy: "MANUAL" }),
    access_token: deps.token,
  });

  const res = await fetch(`${G}/${deps.igUserId}/media`, { method: "POST", body });
  if (!res.ok) throw new Error(`IG контейнер не создан: ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("IG контейнер не создан: в ответе нет id");
  return id;
}

export async function waitForContainer(
  containerId: string,
  deps: PublishDeps,
  opts?: { timeoutMs?: number }
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts?.timeoutMs ?? CONTAINER_TIMEOUT_MS);

  for (;;) {
    const res = await fetch(
      `${G}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(deps.token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`IG не отдал статус контейнера: ${await readError(res)}`);
    const { status_code: code, status } = (await res.json()) as { status_code?: string; status?: string };

    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`IG отбраковал ролик (${code}): ${status ?? "без деталей"}`);
    }
    if (Date.now() >= deadline) throw new Error("IG не дождался готовности контейнера");
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function publishContainer(containerId: string, deps: PublishDeps): Promise<string> {
  const body = new URLSearchParams({ creation_id: containerId, access_token: deps.token });
  const res = await fetch(`${G}/${deps.igUserId}/media_publish`, { method: "POST", body });
  if (!res.ok) throw new Error(`IG не опубликовал ролик: ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("IG не опубликовал ролик: в ответе нет id");
  return id;
}

export async function fetchPermalink(mediaId: string, deps: PublishDeps): Promise<string> {
  const res = await fetch(
    `${G}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(deps.token)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return "";
  const { permalink } = (await res.json()) as { permalink?: string };
  return permalink ?? "";
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/instagram.ts tests/farm-instagram.test.ts
git commit -m "feat(farm): публикация ролика в Trial Reels через контейнер"
```

---

### Task 8b: Долгоживущий токен публикации

Токен из Graph API Explorer живёт час-два. Ферме нужен постоянный, иначе заливка встанет в первый же вечер.

**Files:**
- Create: `lib/farm/token.ts`
- Test: `tests/farm-token.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `exchangeForLongLived(shortToken, appId, appSecret): Promise<string>`, `fetchPageToken(userToken, igId): Promise<string>`, `checkToken(token): Promise<{ valid: boolean; expiresAt: number | null; scopes: string[] }>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-token.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkToken, exchangeForLongLived, fetchPageToken } from "../lib/farm/token";

beforeEach(() => vi.unstubAllGlobals());

describe("exchangeForLongLived", () => {
  it("меняет короткий токен на 60-дневный", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "LONG", expires_in: 5184000 })));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeForLongLived("SHORT", "APP", "SECRET")).toBe("LONG");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("grant_type=fb_exchange_token");
    expect(url).toContain("fb_exchange_token=SHORT");
  });

  it("отказ отдаёт текст ошибки наружу", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad secret" } }), { status: 400 })));
    await expect(exchangeForLongLived("S", "A", "X")).rejects.toThrow(/bad secret/);
  });
});

describe("fetchPageToken", () => {
  it("берёт токен той страницы, к которой привязан нужный IG-аккаунт", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        { name: "Другая", access_token: "PT_OTHER", instagram_business_account: { id: "111" } },
        { name: "Видео из Фото", access_token: "PT_RIGHT", instagram_business_account: { id: "17841413773053161" } },
      ],
    }))));

    expect(await fetchPageToken("LONG", "17841413773053161")).toBe("PT_RIGHT");
  });

  it("нужного аккаунта нет среди страниц — внятная ошибка, а не пустая строка", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    await expect(fetchPageToken("LONG", "17841413773053161")).rejects.toThrow(/не найден/);
  });
});

describe("checkToken", () => {
  it("возвращает срок и права", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { is_valid: true, expires_at: 1766000000, scopes: ["instagram_basic", "instagram_content_publish"] },
    }))));

    const info = await checkToken("T");
    expect(info.valid).toBe(true);
    expect(info.scopes).toContain("instagram_content_publish");
  });

  it("бессрочный Page-токен отдаёт expires_at = 0 — это не «истёк»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { is_valid: true, expires_at: 0, scopes: [] } }))));
    const info = await checkToken("T");
    expect(info.valid).toBe(true);
    expect(info.expiresAt).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-token.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/token.ts
const G = "https://graph.facebook.com/v23.0";

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message || text;
  } catch {
    return text;
  }
}

export async function exchangeForLongLived(
  shortToken: string,
  appId: string,
  appSecret: string
): Promise<string> {
  const url =
    `${G}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Обмен токена не прошёл: ${await readError(res)}`);
  const { access_token: token } = (await res.json()) as { access_token?: string };
  if (!token) throw new Error("Обмен токена не прошёл: в ответе нет access_token");
  return token;
}

// Page-токен, полученный по долгоживущему пользовательскому, не истекает вовсе —
// это и есть то, что кладётся в FARM_IG_TOKEN.
export async function fetchPageToken(userToken: string, igId: string): Promise<string> {
  const res = await fetch(
    `${G}/me/accounts?fields=name,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(userToken)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Список страниц не пришёл: ${await readError(res)}`);
  const { data } = (await res.json()) as {
    data?: { access_token?: string; instagram_business_account?: { id?: string } }[];
  };
  const page = (data ?? []).find((p) => p.instagram_business_account?.id === igId);
  if (!page?.access_token) throw new Error(`Аккаунт ${igId} не найден среди страниц этого токена`);
  return page.access_token;
}

export async function checkToken(token: string): Promise<{
  valid: boolean;
  expiresAt: number | null;
  scopes: string[];
}> {
  const res = await fetch(
    `${G}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return { valid: false, expiresAt: null, scopes: [] };
  const { data } = (await res.json()) as {
    data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] };
  };
  // expires_at = 0 у бессрочных токенов: это не «истёк вчера», а «не истекает».
  const expires = data?.expires_at;
  return {
    valid: Boolean(data?.is_valid),
    expiresAt: expires ? expires * 1000 : null,
    scopes: data?.scopes ?? [],
  };
}
```

- [ ] **Step 4: Встроить проверку в суточную уборку**

В `runDaily` (Task 13) добавить вызов `checkToken(process.env.FARM_IG_TOKEN)`: невалидный токен или срок меньше 7 дней — сообщение в чат. Молча умерший токен останавливает заливку навсегда, и узнать об этом через неделю — худший из сценариев.

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add lib/farm/token.ts tests/farm-token.test.ts
git commit -m "feat(farm): обмен на долгоживущий токен публикации и проверка срока"
```

---

### Task 9: Приём пачки — загрузка и создание задач

**Files:**
- Create: `app/api/farm/upload/route.ts`, `app/api/farm/start/route.ts`, `lib/farm/start.ts`, `app/farm/[token]/page.tsx`, `app/farm/[token]/batch-form.tsx`
- Test: `tests/farm-start.test.ts`

**Interfaces:**
- Consumes: `verifyBatchToken` (Task 3), `parseBlocks` (Task 1), `wrapHook` (Task 2), `saveItem`/`saveBatch`/`deleteBlobQuiet`/`SOURCES_PREFIX` (Task 4).
- Produces: `MAX_FILE_BYTES = 60 * 1024 * 1024`, `MAX_BATCH_BYTES = 1024 ** 3`, `MAX_FILES = 50`, `validateBatch({ pairs, files }): string[]`, `startBatch(input, deps): Promise<{ batchId: string; total: number }>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-start.test.ts
import { describe, expect, it, vi } from "vitest";
import { startBatch, validateBatch } from "../lib/farm/start";

const files = [
  { url: "https://blob.public.blob.vercel-storage.com/farm/sources/1.mp4", bytes: 10 },
  { url: "https://blob.public.blob.vercel-storage.com/farm/sources/2.mp4", bytes: 10 },
];
const pairs = [
  { hook: "Хук один", caption: "Описание" },
  { hook: "Хук два", caption: "Описание" },
];

describe("validateBatch", () => {
  it("несовпадение числа блоков и файлов — ошибка", () => {
    expect(validateBatch({ pairs: pairs.slice(0, 1), files })).toEqual([
      "блоков текста 1, а файлов 2 — должно совпадать",
    ]);
  });

  it("не переносимый хук — ошибка с номером", () => {
    const bad = [{ hook: "Assalamualaikumwarahmatullahi", caption: "Описание" }, pairs[1]];
    expect(validateBatch({ pairs: bad, files })).toEqual([
      "блок 1: хук не влезает в 3 строки по 20 знаков",
    ]);
  });

  it("тяжёлый файл и перегруженная пачка — ошибки", () => {
    const heavy = [{ url: files[0].url, bytes: 70 * 1024 * 1024 }, files[1]];
    expect(validateBatch({ pairs, files: heavy })).toContain("файл 1: 70 МБ, лимит 60 МБ");
  });
});

describe("startBatch", () => {
  it("создаёт задачи по числу пар и запускает рендер", async () => {
    const saveItem = vi.fn(async () => {});
    const saveBatch = vi.fn(async () => {});
    const triggerRender = vi.fn(async () => {});

    const out = await startBatch(
      { chatId: -100, threadId: 7, pairs, files },
      { saveItem, saveBatch, triggerRender, deleteBlobQuiet: async () => {}, now: () => new Date("2026-08-19T00:00:00Z"), newId: (() => { let n = 0; return () => `id${++n}`; })() }
    );

    expect(out.total).toBe(2);
    expect(saveItem).toHaveBeenCalledTimes(2);
    const first = saveItem.mock.calls[0][0];
    expect(first).toMatchObject({ index: 1, total: 2, status: "pending", chatId: -100, threadId: 7 });
    expect(triggerRender).toHaveBeenCalledWith(out.batchId);
  });

  it("сорванное создание удаляет уже залитые файлы: иначе они висят в хранилище навсегда", async () => {
    const deleteBlobQuiet = vi.fn(async () => {});
    const saveItem = vi.fn(async () => {
      throw new Error("blob down");
    });

    await expect(
      startBatch(
        { chatId: -100, threadId: null, pairs, files },
        { saveItem, saveBatch: async () => {}, triggerRender: async () => {}, deleteBlobQuiet, now: () => new Date(), newId: () => "id" }
      )
    ).rejects.toThrow(/blob down/);

    expect(deleteBlobQuiet).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-start.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать проверку и создание задач**

```ts
// lib/farm/start.ts
import { HOOK_LINE_CHARS, HOOK_MAX_LINES, wrapHook } from "./wrap";
import { Batch, Item, Pair } from "./types";

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
  input: { chatId: number; threadId: number | null; pairs: Pair[]; files: UploadedFile[] },
  deps: StartDeps
): Promise<{ batchId: string; total: number }> {
  const errors = validateBatch(input);
  if (errors.length) throw new Error(errors.join("; "));

  const batchId = deps.newId();
  const createdAt = deps.now().toISOString();
  const total = input.pairs.length;

  // Файлы уже целиком в Blob, а записей о задачах ещё нет: любой отказ ниже без
  // явного удаления оставил бы до гигабайта висеть в хранилище навсегда.
  try {
    await deps.saveBatch({ batchId, chatId: input.chatId, threadId: input.threadId, total, createdAt });
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
      });
    }
  } catch (error) {
    for (const file of input.files) await deps.deleteBlobQuiet(file.url);
    throw error;
  }

  await deps.triggerRender(batchId);
  return { batchId, total };
}
```

- [ ] **Step 4: Написать роуты и страницу**

```ts
// app/api/farm/upload/route.ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { verifyBatchToken } from "../../../../lib/farm/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Без этой проверки в наш Blob мог бы залить кто угодно.
        const claim = verifyBatchToken(clientPayload ?? "", requireSecret(), Date.now());
        if (!claim) throw new Error("Ссылка просрочена — запроси новую через /batch");
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
          addRandomSuffix: true,
          maximumSizeInBytes: 60 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // Задачи создаёт страница через /api/farm/start — здесь делать нечего.
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

function requireSecret(): string {
  const secret = process.env.FARM_TOKEN_SECRET;
  if (!secret) throw new Error("FARM_TOKEN_SECRET is not set");
  return secret;
}
```

```tsx
// app/farm/[token]/page.tsx
import BatchForm from "./batch-form";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Пачка роликов</h1>
      <p>
        Выберите видео-подложки и вставьте текст: блоки разделены строкой <code>---</code>, первая
        строка блока — хук, остальное — описание.
      </p>
      <BatchForm token={token} />
    </main>
  );
}
```

Клиентская форма `app/farm/[token]/batch-form.tsx`: `useState` для файлов и текста; на каждое изменение считает `parseBlocks(text).pairs.length` и сравнивает с числом файлов, показывая счётчик «блоков 30 / файлов 30» и сумму размеров; кнопка заблокирована, пока `validateBatch` возвращает ошибки; отправка — `upload()` из `@vercel/blob/client` с `handleUploadUrl: "/api/farm/upload"`, `clientPayload: token`, `multipart: true`, по 3 файла параллельно с прогрессом «12/30»; затем один `POST /api/farm/start` с токеном, массивом `{ url, bytes }` и текстом.

```ts
// app/api/farm/start/route.ts — тело
const { token, files, text } = (await req.json()) as { token: string; files: UploadedFile[]; text: string };
const claim = verifyBatchToken(token, requireSecret(), Date.now());
if (!claim) return NextResponse.json({ error: "Ссылка просрочена" }, { status: 400 });

const { pairs, errors } = parseBlocks(text);
if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });

// Файл может быть залит в чужой Blob или не залит вовсе: проверяем каждый.
for (const file of files) {
  if (!/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(file.url)) {
    return NextResponse.json({ error: "Ссылка на файл не из нашего хранилища" }, { status: 400 });
  }
  await head(file.url);
}

const { total } = await startBatch({ chatId: claim.chatId, threadId: claim.threadId, pairs, files }, deps);
await sendMessage(`Взял пачку: ${total} роликов. Пришлю по одному с кнопками.`, { thread: claim.threadId });
return NextResponse.json({ ok: true, total });
```

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add lib/farm/start.ts app/api/farm/upload/route.ts app/api/farm/start/route.ts "app/farm/[token]/page.tsx" "app/farm/[token]/batch-form.tsx" tests/farm-start.test.ts
git commit -m "feat(farm): страница пачки, прямая загрузка в Blob и создание задач"
```

---

### Task 10: Цепочка рендера

**Files:**
- Create: `lib/farm/tick.ts`, `app/api/farm/render/route.ts`
- Test: `tests/farm-tick.test.ts`

**Interfaces:**
- Consumes: `renderHook`/`ffmpegArgs` (Task 6), `loadItem`/`listItems`/`saveItem`/`deleteBlobQuiet`/`OUT_PREFIX` (Task 4), `wrapHook` (Task 2), `sendVideoWithButtons`/`farmCaption` (Task 7), `tickKey` (Task 3).
- Produces: `INVOCATION_BUDGET_MS = 240_000`, `ITEM_RESERVE_MS = 150_000`, `TAKEOVER_MS = 300_000`, `isAbandoned(at: string | null, nowMs: number): boolean`, `pickNext(items: Item[], batchId: string, nowMs: number): Item | null`, `runRenderTick(batchId, deps): Promise<void>`, `triggerRender(batchId): Promise<void>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-tick.test.ts
import { describe, expect, it, vi } from "vitest";
import { isAbandoned, pickNext, TAKEOVER_MS } from "../lib/farm/tick";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 3,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T01:00:00.000Z");

describe("isAbandoned", () => {
  it("нет отметки — считаем брошенной: иначе статус залипнет навсегда", () => {
    expect(isAbandoned(null, NOW)).toBe(true);
  });

  it("свежая отметка — работа живая", () => {
    expect(isAbandoned(new Date(NOW - 1000).toISOString(), NOW)).toBe(false);
  });

  it("старше времени жизни вызова — брошена", () => {
    expect(isAbandoned(new Date(NOW - TAKEOVER_MS - 1).toISOString(), NOW)).toBe(true);
  });

  it("битая отметка — брошена", () => {
    expect(isAbandoned("не дата", NOW)).toBe(true);
  });
});

describe("pickNext", () => {
  it("берёт pending по порядку номеров", () => {
    const items = [
      { ...base, itemId: "i2", index: 2 },
      { ...base, itemId: "i1", index: 1 },
    ];
    expect(pickNext(items, "b1", NOW)?.itemId).toBe("i1");
  });

  it("чужую пачку не трогает", () => {
    expect(pickNext([{ ...base, batchId: "other" }], "b1", NOW)).toBeNull();
  });

  it("перехватывает брошенный rendering, живой — не трогает", () => {
    const abandoned = { ...base, itemId: "dead", status: "rendering" as const, renderingAt: new Date(NOW - TAKEOVER_MS - 1).toISOString() };
    const alive = { ...base, itemId: "alive", status: "rendering" as const, renderingAt: new Date(NOW - 1000).toISOString() };
    expect(pickNext([alive], "b1", NOW)).toBeNull();
    expect(pickNext([alive, abandoned], "b1", NOW)?.itemId).toBe("dead");
  });

  it("готовые и отвергнутые не берёт", () => {
    expect(pickNext([{ ...base, status: "review" }, { ...base, status: "rejected" }], "b1", NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-tick.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать выбор и цепочку**

```ts
// lib/farm/tick.ts — ключевые части
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

export async function runRenderTick(batchId: string, deps: RenderTickDeps): Promise<void> {
  const startedAt = deps.now();
  for (;;) {
    if (deps.now() - startedAt > INVOCATION_BUDGET_MS - ITEM_RESERVE_MS) {
      await deps.triggerRender(batchId);
      return;
    }

    const item = pickNext(await deps.listItems(), batchId, deps.now());
    if (!item) return;

    await deps.saveItem({ ...item, status: "rendering", renderingAt: new Date(deps.now()).toISOString() });
    try {
      const videoUrl = await deps.renderItem(item);
      const caption = farmCaption(item.index, item.total, item.hook, item.caption);
      const messageId = await deps.sendVideoWithButtons({ ...item, videoUrl, caption });
      await deps.saveItem({ ...item, status: "review", videoUrl, messageId, renderingAt: null });
      // Исходник больше не нужен: публикуется готовый ролик, а квота Blob на Hobby
      // при превышении отключает хранилище на 30 дней.
      await deps.deleteBlobQuiet(item.sourceUrl);
    } catch (error) {
      const message = (error as Error).message;
      await deps.saveItem({ ...item, status: "failed", renderingAt: null, error: message });
      await deps.notify(`Ролик ${item.index}/${item.total} не собрался: ${message}`, item.threadId);
    }
  }
}
```

`renderItem` в проде: скачивает `sourceUrl` в `/tmp`, определяет наличие звука через `ffprobe-static`, зовёт `renderHook` с `ffmpegPath` из `ffmpeg-static`, кладёт результат в Blob по `${OUT_PREFIX}${itemId}.mp4` и возвращает публичный URL. Роут `app/api/farm/render/route.ts`: `maxDuration = 300`, `runtime = "nodejs"`, проверка `key` через `tickKey(\`render:${batchId}\`, secret)`, ответ 202 сразу, работа — в `runRenderTick`.

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/tick.ts app/api/farm/render/route.ts tests/farm-tick.test.ts
git commit -m "feat(farm): цепочка рендера с бюджетом вызова и перехватом брошенных"
```

---

### Task 11: Апрув — команды, кнопки, правка описания

**Files:**
- Create: `lib/farm/commands.ts`, `lib/farm/approve.ts`
- Modify: `app/api/telegram/route.ts` (вынос диспетчера, обработка `callback_query` и ответов на `force_reply`)
- Test: `tests/farm-commands.test.ts`, `tests/farm-approve.test.ts`

**Interfaces:**
- Consumes: `Item` (Task 1), `loadItem`/`saveItem`/`listItems`/`deleteBlobQuiet` (Task 4), `nextFreeSlot`/`slotConfigFromEnv` (Task 5), `answerCallback`/`dropKeyboard`/`editCaption`/`askForReply` (Task 7), `signBatchToken` (Task 3).
- Produces: `parseFarmCommand(text): "batch" | "reels" | null`, `parseCallback(data): { action: "approve" | "reject" | "edit"; itemId: string } | null`, `formatQueue(items, nowMs): string`, `handleCallback(cb, deps): Promise<void>`, `handleEditReply(msg, deps): Promise<boolean>`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/farm-commands.test.ts
import { describe, expect, it } from "vitest";
import { formatQueue, parseCallback, parseFarmCommand } from "../lib/farm/commands";
import { Item } from "../lib/farm/types";

const base = { batchId: "b", chatId: -1, threadId: null, total: 3, hook: "Х", caption: "О",
  sourceUrl: "s", videoUrl: "v", messageId: 1, editPromptId: null, renderingAt: null,
  postingAt: null, igMediaId: null, permalink: null, error: null,
  createdAt: "2026-08-19T00:00:00.000Z" } as const;

describe("parseFarmCommand", () => {
  it("понимает команду с упоминанием бота в группе", () => {
    expect(parseFarmCommand("/batch@MyReelsBot")).toBe("batch");
    expect(parseFarmCommand("/reels")).toBe("reels");
    expect(parseFarmCommand("/otchet")).toBeNull();
  });
});

describe("parseCallback", () => {
  it("разбирает действие и id", () => {
    expect(parseCallback("a:i1")).toEqual({ action: "approve", itemId: "i1" });
    expect(parseCallback("r:i1")).toEqual({ action: "reject", itemId: "i1" });
    expect(parseCallback("e:i1")).toEqual({ action: "edit", itemId: "i1" });
  });

  it("мусор отвергает", () => {
    expect(parseCallback("x:i1")).toBeNull();
    expect(parseCallback("a:")).toBeNull();
  });
});

describe("formatQueue", () => {
  it("показывает ожидающих апрува, очередь и ближайший слот", () => {
    const items = [
      { ...base, itemId: "1", index: 1, status: "review", scheduledAt: null } as Item,
      { ...base, itemId: "2", index: 2, status: "queued", scheduledAt: "2026-08-19T02:00:00.000Z" } as Item,
      { ...base, itemId: "3", index: 3, status: "failed", error: "ffmpeg упал" } as Item,
    ];
    const text = formatQueue(items, Date.parse("2026-08-19T01:00:00.000Z"));
    expect(text).toContain("ждут апрува: 1");
    expect(text).toContain("в очереди: 1");
    expect(text).toContain("ffmpeg упал");
  });
});
```

```ts
// tests/farm-approve.test.ts — существенные случаи
it("апрув ставит слот и снимает кнопки", async () => { /* status queued, scheduledAt из nextFreeSlot, dropKeyboard вызван */ });
it("повторное нажатие по не-review отвечает «уже обработано» и не меняет статус", async () => { /* saveItem не вызван */ });
it("отказ удаляет готовый ролик из Blob", async () => { /* deleteBlobQuiet(videoUrl) */ });
it("правка переводит в editing и присылает force_reply", async () => { /* editPromptId сохранён */ });
it("ответ на force_reply меняет описание и возвращает ролик в review с кнопками", async () => {});
it("ответ на чужое сообщение не считается правкой", async () => { /* handleEditReply вернул false */ });
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-commands.test.ts tests/farm-approve.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Реализовать разбор и обработку**

```ts
// lib/farm/commands.ts
export type FarmCommand = "batch" | "reels";

export function parseFarmCommand(text: string): FarmCommand | null {
  // В группах Telegram дописывает к команде имя бота: /batch@my_bot.
  const word = text.trim().split(/\s+/)[0]?.split("@")[0];
  if (word === "/batch") return "batch";
  if (word === "/reels") return "reels";
  return null;
}

const ACTIONS = { a: "approve", r: "reject", e: "edit" } as const;

export function parseCallback(data: string): { action: "approve" | "reject" | "edit"; itemId: string } | null {
  const [prefix, itemId] = data.split(":");
  const action = ACTIONS[prefix as keyof typeof ACTIONS];
  if (!action || !itemId) return null;
  return { action, itemId };
}
```

```ts
// lib/farm/approve.ts — ядро
export async function handleCallback(
  cb: { id: string; data: string; chatId: number },
  deps: ApproveDeps
): Promise<void> {
  const parsed = parseCallback(cb.data);
  if (!parsed) return deps.answerCallback(cb.id, "Не понял кнопку");

  const item = await deps.loadItem(parsed.itemId);
  if (!item) return deps.answerCallback(cb.id, "Ролик не найден");

  // Листать чат вверх и жать по второму разу — норма, а не ошибка: отвечаем и
  // снимаем кнопки, но статус не трогаем.
  if (item.status !== "review") {
    await deps.answerCallback(cb.id, `Уже обработано: ${item.status}`);
    if (item.messageId) await deps.dropKeyboard(item.chatId, item.messageId);
    return;
  }

  if (parsed.action === "approve") {
    const taken = (await deps.listItems())
      .filter((i) => i.scheduledAt && ["queued", "posting", "posted"].includes(i.status))
      .map((i) => i.scheduledAt as string);
    const slot = deps.nextFreeSlot(taken, deps.now());
    await deps.saveItem({ ...item, status: "queued", scheduledAt: slot });
    await deps.answerCallback(cb.id, "В очередь");
    if (item.messageId) {
      await deps.dropKeyboard(item.chatId, item.messageId);
      await deps.editCaption(item.chatId, item.messageId, `✅ ${item.index}/${item.total} — в очереди на ${deps.formatSlot(slot)}`);
    }
    return;
  }

  if (parsed.action === "reject") {
    await deps.saveItem({ ...item, status: "rejected" });
    if (item.videoUrl) await deps.deleteBlobQuiet(item.videoUrl);
    await deps.answerCallback(cb.id, "Выкинул");
    if (item.messageId) {
      await deps.dropKeyboard(item.chatId, item.messageId);
      await deps.editCaption(item.chatId, item.messageId, `❌ ${item.index}/${item.total} — выкинут`);
    }
    return;
  }

  // Правка меняет только описание: хук вжарен в пиксели, его правка — новый рендер.
  const promptId = await deps.askForReply({
    chatId: item.chatId,
    threadId: item.threadId,
    text: `Ответьте на это сообщение новым описанием для ролика ${item.index}/${item.total}. Хук останется прежним.`,
  });
  await deps.saveItem({ ...item, status: "editing", editPromptId: promptId });
  await deps.answerCallback(cb.id, "Жду новое описание");
}
```

`handleEditReply` ищет среди задач `editing` ту, у которой `editPromptId` совпал с `message.reply_to_message.message_id`; при совпадении подменяет `caption`, возвращает `status: "review"`, заново отправляет видео с кнопками и возвращает `true`, иначе — `false` (тогда вебхук обрабатывает сообщение как обычно).

- [ ] **Step 4: Встроить в вебхук**

В `app/api/telegram/route.ts`: существующие 11 команд переехали в `handleReportCommand`, новый диспетчер по порядку пробует `parseFarmCommand`, затем прежние команды; добавлены ветки `update.callback_query` → `handleCallback` и «сообщение является ответом на force_reply» → `handleEditReply`. Проверка чата по `TELEGRAM_CHAT_ID` остаётся и применяется и к `callback_query`.

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS, включая существующие тесты отчётного бота.

```bash
git add lib/farm/commands.ts lib/farm/approve.ts app/api/telegram/route.ts tests/farm-commands.test.ts tests/farm-approve.test.ts
git commit -m "feat(farm): апрув кнопками, правка описания и диспетчер команд"
```

---

### Task 12: Заливка по слоту

**Files:**
- Create: `lib/farm/post.ts`, `app/api/farm/post/route.ts`
- Test: `tests/farm-post.test.ts`

**Interfaces:**
- Consumes: `createTrialContainer`/`waitForContainer`/`publishContainer`/`fetchPermalink` (Task 8), `listItems`/`saveItem`/`loadItem`/`deleteBlobQuiet` (Task 4), `isAbandoned` (Task 10), `FARM_IG_TOKEN`/`FARM_IG_ID` из env (Task 8b).
- Produces: `pickDue(items: Item[], nowMs: number): Item | null`, `postOne(item, deps): Promise<void>`, `runPostTick(deps): Promise<void>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-post.test.ts
import { describe, expect, it, vi } from "vitest";
import { pickDue, postOne } from "../lib/farm/post";
import { TAKEOVER_MS } from "../lib/farm/tick";

const NOW = Date.parse("2026-08-19T02:00:00.000Z");
const item = { /* как в других тестах */ status: "queued", scheduledAt: "2026-08-19T02:00:00.000Z", videoUrl: "https://blob/out.mp4" } as any;

describe("pickDue", () => {
  it("берёт самый ранний наступивший слот", () => {
    const later = { ...item, itemId: "late", scheduledAt: "2026-08-19T02:45:00.000Z" };
    const now = { ...item, itemId: "now" };
    expect(pickDue([later, now], NOW)?.itemId).toBe("now");
  });

  it("не наступивший слот не берёт", () => {
    expect(pickDue([{ ...item, scheduledAt: "2026-08-19T03:00:00.000Z" }], NOW)).toBeNull();
  });

  it("брошенный posting в работу не возвращает — он мог быть уже опубликован", () => {
    const abandoned = { ...item, status: "posting", postingAt: new Date(NOW - TAKEOVER_MS - 1).toISOString() };
    expect(pickDue([abandoned], NOW)).toBeNull();
  });
});

describe("postOne", () => {
  it("контейнер → ожидание → публикация → permalink в чат, ролик удалён", async () => {
    const deleteBlobQuiet = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    await postOne(item, {
      loadItem: async () => item,
      saveItem: async () => {},
      createTrialContainer: async () => "C1",
      waitForContainer: async () => {},
      publishContainer: async () => "M1",
      fetchPermalink: async () => "https://instagram.com/reel/X",
      deleteBlobQuiet, notify, now: () => NOW,
    } as any);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("https://instagram.com/reel/X"), null);
    expect(deleteBlobQuiet).toHaveBeenCalledWith("https://blob/out.mp4");
  });

  it("статус изменился между чтениями — второй заливки не будет", async () => {
    const publishContainer = vi.fn(async () => "M1");
    await postOne(item, { loadItem: async () => ({ ...item, status: "posted" }), publishContainer } as any);
    expect(publishContainer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-post.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать**

```ts
// lib/farm/post.ts — ядро
export function pickDue(items: Item[], nowMs: number): Item | null {
  // Брошенный posting сюда не попадает сознательно: вызов мог умереть уже после
  // media_publish, и повторная заливка дала бы дубль рилса на аккаунте. Такие
  // задачи разбирает суточная уборка, переводя их в failed с просьбой проверить ленту.
  return items
    .filter((i) => i.status === "queued" && i.scheduledAt && Date.parse(i.scheduledAt) <= nowMs)
    .sort((a, b) => Date.parse(a.scheduledAt as string) - Date.parse(b.scheduledAt as string))[0] ?? null;
}

export async function postOne(item: Item, deps: PostDeps): Promise<void> {
  // Перечитываем перед работой: в Blob нет compare-and-set, и без этой проверки
  // два тика таймера залили бы один ролик дважды.
  const fresh = await deps.loadItem(item.itemId);
  if (!fresh || fresh.status !== "queued") return;
  await deps.saveItem({ ...fresh, status: "posting", postingAt: new Date(deps.now()).toISOString() });

  try {
    const containerId = await deps.createTrialContainer(fresh.videoUrl as string, fresh.caption);
    await deps.waitForContainer(containerId);
    const mediaId = await deps.publishContainer(containerId);
    const permalink = await deps.fetchPermalink(mediaId);
    await deps.saveItem({ ...fresh, status: "posted", postingAt: null, igMediaId: mediaId, permalink });
    await deps.notify(`Залил ${fresh.index}/${fresh.total}: ${permalink || "ссылка не пришла"}`, fresh.threadId);
    if (fresh.videoUrl) await deps.deleteBlobQuiet(fresh.videoUrl);
  } catch (error) {
    const message = (error as Error).message;
    await deps.saveItem({ ...fresh, status: "failed", postingAt: null, error: message });
    await deps.notify(`Ролик ${fresh.index}/${fresh.total} не залился: ${message}`, fresh.threadId);
  }
}
```

Роут `app/api/farm/post/route.ts`: `maxDuration = 300`, проверка `key` через `tickKey("post", secret)`, берёт `pickDue`, зовёт `postOne` — **не больше одного ролика за тик**, потому что опрос контейнера занимает минуты, а слоты разнесены на 45.

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/farm/post.ts app/api/farm/post/route.ts tests/farm-post.test.ts
git commit -m "feat(farm): заливка ролика по наступившему слоту"
```

---

### Task 13: Уборка, крон и настройка

**Files:**
- Create: `lib/farm/daily.ts`, `app/api/farm/daily/route.ts`, `assets/hook.ttf`
- Modify: `vercel.json`, `SETUP.md`
- Test: `tests/farm-daily.test.ts`

**Interfaces:**
- Consumes: `listItems`/`saveItem`/`deleteBlobQuiet`/`isActive`/`SOURCES_PREFIX` (Task 4), `isAbandoned` (Task 10), `pickDue`/`postOne` (Task 12), `checkToken` (Task 8b).
- Produces: `classifyForCleanup(items, nowMs): { purge: Item[]; expire: Item[]; unstick: Item[] }`, `runDaily(deps): Promise<{ purged: number; expired: number; unstuck: number; caughtUp: number }>`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/farm-daily.test.ts
import { describe, expect, it } from "vitest";
import { classifyForCleanup } from "../lib/farm/daily";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("classifyForCleanup", () => {
  it("удаляет завершённые старше 3 дней и не трогает свежие", () => {
    const items = [
      { itemId: "old", status: "posted", createdAt: days(4) },
      { itemId: "fresh", status: "posted", createdAt: days(1) },
    ] as any[];
    const { purge } = classifyForCleanup(items, NOW);
    expect(purge.map((i) => i.itemId)).toEqual(["old"]);
  });

  it("неотвеченные review старше 7 дней уходят в rejected", () => {
    const items = [{ itemId: "stale", status: "review", createdAt: days(8) }] as any[];
    expect(classifyForCleanup(items, NOW).expire.map((i) => i.itemId)).toEqual(["stale"]);
  });

  it("застрявшие rendering и posting старше 30 минут снимаются", () => {
    const items = [
      { itemId: "r", status: "rendering", renderingAt: new Date(NOW - 31 * 60_000).toISOString(), createdAt: days(0) },
      { itemId: "p", status: "posting", postingAt: new Date(NOW - 31 * 60_000).toISOString(), createdAt: days(0) },
      { itemId: "ok", status: "rendering", renderingAt: new Date(NOW - 60_000).toISOString(), createdAt: days(0) },
    ] as any[];
    expect(classifyForCleanup(items, NOW).unstick.map((i) => i.itemId)).toEqual(["r", "p"]);
  });

  it("активные задачи в purge не попадают никогда", () => {
    const items = [{ itemId: "q", status: "queued", createdAt: days(30) }] as any[];
    expect(classifyForCleanup(items, NOW).purge).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/farm-daily.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать уборку**

```ts
// lib/farm/daily.ts
export const PURGE_AFTER_MS = 3 * 86_400_000;
export const REVIEW_EXPIRY_MS = 7 * 86_400_000;
export const STUCK_AFTER_MS = 30 * 60_000;

export function classifyForCleanup(items: Item[], nowMs: number): {
  purge: Item[];
  expire: Item[];
  unstick: Item[];
} {
  const age = (item: Item) => nowMs - Date.parse(item.createdAt);
  return {
    purge: items.filter((i) => !isActive(i) && age(i) > PURGE_AFTER_MS),
    // Неотвеченные ролики иначе копили бы по 15 МБ и висели в /reels вечно.
    // Неделя — запас на отпуск; хук, не одобренный за это время, неактуален.
    expire: items.filter((i) => ["review", "editing"].includes(i.status) && age(i) > REVIEW_EXPIRY_MS),
    unstick: items.filter(
      (i) =>
        (i.status === "rendering" && nowMs - Date.parse(i.renderingAt ?? i.createdAt) > STUCK_AFTER_MS) ||
        (i.status === "posting" && nowMs - Date.parse(i.postingAt ?? i.createdAt) > STUCK_AFTER_MS)
    ),
  };
}
```

`runDaily` дополнительно: проверяет токен публикации через `checkToken` и при невалидности или сроке меньше 7 дней пишет в чат (молча умерший токен останавливает заливку навсегда); для `unstick` со статусом `posting` сообщение прямо просит проверить ленту; удаляет подложки под `farm/sources/`, у которых нет живой задачи; добирает просроченные `queued` через `pickDue`/`postOne`.

- [ ] **Step 4: Крон, шрифт и документация**

```json
// vercel.json
{
  "crons": [
    { "path": "/api/report", "schedule": "45 5 * * *" },
    { "path": "/api/farm/daily", "schedule": "0 20 * * *" }
  ]
}
```

Положить `assets/hook.ttf` (жирный sans с латиницей: Montserrat ExtraBold или Inter Bold). В `SETUP.md` добавить раздел «Ферма рилсов»: получение токена публикации через Graph API Explorer с обменом на бессрочный Page-токен (Task 8b), новые переменные `FARM_TOKEN_SECRET`, `FARM_IG_TOKEN`, `FARM_IG_ID`, `FARM_FB_APP_ID`, `FARM_FB_APP_SECRET`, `FARM_SLOT_START`, `FARM_SLOT_MINUTES`, `FARM_SLOTS_PER_DAY`, `FARM_TZ`, настройка внешнего таймера на `/api/farm/post?key=...` раз в 15 минут и напоминание, что оба слота крона Hobby после этого заняты.

- [ ] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add lib/farm/daily.ts app/api/farm/daily/route.ts vercel.json SETUP.md assets/hook.ttf tests/farm-daily.test.ts
git commit -m "feat(farm): суточная уборка, крон и документация настройки"
```

---

## Самопроверка плана

**Покрытие спеки.** Схема — Task 9–12; данные и статусы — Task 1, 4; вход и валидация — Task 1, 2, 9; рендер — Task 6, 10; апрув и правка — Task 11; слоты — Task 5; таймер — Task 12 плюс настройка в Task 13; заливка и запрет повторной публикации — Task 8, 12; ошибки — распределены по задачам, где возникают; уборка — Task 13; тесты — в каждой задаче; переменные и настройка руками — Task 13; открытый пункт про `trial_params` — Task 0.

**Не закрыто планом сознательно:** калибровка стиля хука (нужен эталонный ролик от человека — правится константа `STYLE` в `lib/farm/render.ts` после Task 6) и проверка кодового слова по дампу комментов (вне периметра фермы).

**Согласованность имён.** `Item`/`Batch`/`Pair` из Task 1 используются везде; `isAbandoned` и `TAKEOVER_MS` определены в Task 10 и переиспользованы в Task 12–13; `nextFreeSlot` из Task 5 вызывается только в Task 11; `farmCaption` из Task 7 — в Task 10; `deleteBlobQuiet` из Task 4 — в Task 9, 10, 11, 12, 13.
