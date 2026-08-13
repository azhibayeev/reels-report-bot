# Telegram Dubbing Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Телеграм-бот, который принимает видео с русской речью и возвращает тот же ролик с озвучкой на индонезийском через ElevenLabs Dubbing API.

**Architecture:** Отдельный Vercel-проект из папки `dub-bot/`. Видео заходит не через бота (лимит 20 МБ), а через страницу загрузки: браузер грузит файл напрямую в Vercel Blob, ElevenLabs скачивает его по публичной ссылке. Готовность отслеживается цепочкой само-вызывающихся функций, потому что вебхука о завершении дубляжа у ElevenLabs нет, а минутный cron на Hobby недоступен.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@vercel/blob` 2.6.1, Vitest, Vercel Functions (Node.js 24).

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-13-telegram-dubbing-bot-design.md`. Расхождение с ней — повод остановиться и спросить.
- Весь новый код живёт в `dub-bot/`. Существующий проект в корне репозитория не трогаем.
- Язык исходника — `ru`, целевой — `id`. Константы, а не параметры: бот делает ровно одно направление.
- Стоимость дубляжа — **2000 кредитов на минуту** (замерено: 334 кредита за 10 секунд).
- Лимиты Telegram: скачивание ботом ≤ 20 МБ, отправка по HTTP-ссылке ≤ 20 МБ, отправка загрузкой multipart ≤ 50 МБ.
- Водяной знак не хардкодится: `watermark: tier === "free"`, тариф читается из `/v1/user/subscription`.
- Комментарии в коде — на русском, объясняют «почему», а не «что». Как в существующем `lib/`.
- Работа с Blob — по образцу `lib/storage.ts`: `put` с `addRandomSuffix: false, allowOverwrite: true`, чтение через `list` + `fetch(url + "?ts=" + Date.now())`.
- TypeScript strict. Никаких `any` в экспортируемых сигнатурах.
- Коммит после каждой задачи.

## File Structure

| Файл | Ответственность |
| --- | --- |
| `dub-bot/package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `vercel.json` | Каркас проекта |
| `dub-bot/lib/config.ts` | Доступ к env, whitelist chat_id, базовый URL |
| `dub-bot/lib/credits.ts` | Оценка кредитов, форматирование, выбор способа доставки |
| `dub-bot/lib/tokens.ts` | HMAC-токены страницы загрузки и ключ вызова tick |
| `dub-bot/lib/elevenlabs.ts` | Клиент ElevenLabs: подписка, создание, статус, скачивание |
| `dub-bot/lib/telegram.ts` | Отправка сообщений и видео тремя способами |
| `dub-bot/lib/jobs.ts` | Состояние задач в Blob |
| `dub-bot/lib/tick.ts` | Цикл опроса и доставка результата |
| `dub-bot/app/api/telegram/route.ts` | Вебхук бота: `/dub`, `/status`, `/help` |
| `dub-bot/app/api/upload/route.ts` | Выдача клиентского токена загрузки |
| `dub-bot/app/api/dub/start/route.ts` | Создание задачи в ElevenLabs |
| `dub-bot/app/api/dub/tick/route.ts` | Тонкий роут поверх `lib/tick.ts` |
| `dub-bot/app/api/cleanup/route.ts` | Суточный cron |
| `dub-bot/app/u/[token]/page.tsx`, `upload-form.tsx` | Страница загрузки |
| `dub-bot/tests/*.test.ts` | Юнит-тесты |

---

### Task 1: Каркас проекта и модуль оценки кредитов

**Files:**
- Create: `dub-bot/package.json`, `dub-bot/tsconfig.json`, `dub-bot/next.config.ts`, `dub-bot/vitest.config.ts`, `dub-bot/.gitignore`, `dub-bot/.env.example`
- Create: `dub-bot/lib/credits.ts`
- Test: `dub-bot/tests/credits.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `estimateCredits(durationSec: number): number`, `formatDuration(sec: number): string`, `pickDelivery(sizeBytes: number): "url" | "upload" | "link"`, константы `CREDITS_PER_MINUTE`, `TELEGRAM_URL_LIMIT`, `TELEGRAM_UPLOAD_LIMIT`.

- [ ] **Step 1: Создать каркас проекта**

`dub-bot/package.json`:

```json
{
  "name": "dub-bot",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run"
  },
  "dependencies": {
    "@vercel/blob": "^2.6.1",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`dub-bot/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`dub-bot/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`dub-bot/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`dub-bot/.gitignore`:

```
node_modules
.next
.env.local
.vercel
*.tsbuildinfo
```

`dub-bot/.env.example`:

```
TELEGRAM_DUB_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_WEBHOOK_SECRET=
ELEVENLABS_API_KEY=
DUB_TOKEN_SECRET=
DUB_BASE_URL=
CRON_SECRET=
BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 2: Установить зависимости**

Run: `cd dub-bot && npm install`
Expected: `node_modules` создан, ошибок нет.

- [ ] **Step 3: Написать падающий тест**

`dub-bot/tests/credits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  estimateCredits,
  formatDuration,
  pickDelivery,
  TELEGRAM_UPLOAD_LIMIT,
  TELEGRAM_URL_LIMIT,
} from "../lib/credits";

describe("estimateCredits", () => {
  it("считает 2000 кредитов за минуту", () => {
    expect(estimateCredits(60)).toBe(2000);
  });

  it("округляет вверх — ElevenLabs не даёт скидку за неполную секунду", () => {
    expect(estimateCredits(10)).toBe(334);
  });

  it("отдаёт 0 для неизвестной длительности, чтобы не блокировать загрузку", () => {
    expect(estimateCredits(0)).toBe(0);
    expect(estimateCredits(Number.NaN)).toBe(0);
    expect(estimateCredits(-5)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("форматирует минуты и секунды", () => {
    expect(formatDuration(192)).toBe("3:12");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("pickDelivery", () => {
  it("до 20 МБ отдаёт ссылкой — Telegram скачает сам", () => {
    expect(pickDelivery(TELEGRAM_URL_LIMIT)).toBe("url");
    expect(pickDelivery(1024)).toBe("url");
  });

  it("от 20 до 50 МБ грузит через нашу функцию", () => {
    expect(pickDelivery(TELEGRAM_URL_LIMIT + 1)).toBe("upload");
    expect(pickDelivery(TELEGRAM_UPLOAD_LIMIT)).toBe("upload");
  });

  it("больше 50 МБ Telegram не примет — только ссылка текстом", () => {
    expect(pickDelivery(TELEGRAM_UPLOAD_LIMIT + 1)).toBe("link");
  });
});
```

- [ ] **Step 4: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test`
Expected: FAIL — `Failed to resolve import "../lib/credits"`.

- [ ] **Step 5: Реализовать модуль**

`dub-bot/lib/credits.ts`:

```ts
// Замерено на живом API: 334 кредита за 10-секундный ролик.
export const CREDITS_PER_MINUTE = 2000;

// Telegram скачивает по ссылке максимум 20 МБ, а принимает загрузкой — 50 МБ.
export const TELEGRAM_URL_LIMIT = 20 * 1024 * 1024;
export const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024;

export type Delivery = "url" | "upload" | "link";

// Ноль означает «длительность не определилась» — тогда предварительную проверку
// баланса пропускаем, а не отказываем в загрузке.
export function estimateCredits(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.ceil((durationSec / 60) * CREDITS_PER_MINUTE);
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.round(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function pickDelivery(sizeBytes: number): Delivery {
  if (sizeBytes <= TELEGRAM_URL_LIMIT) return "url";
  if (sizeBytes <= TELEGRAM_UPLOAD_LIMIT) return "upload";
  return "link";
}
```

- [ ] **Step 6: Запустить тест и убедиться, что проходит**

Run: `cd dub-bot && npm test`
Expected: PASS, 7 тестов.

- [ ] **Step 7: Коммит**

```bash
git add dub-bot/
git commit -m "feat(dub-bot): каркас проекта и оценка стоимости дубляжа"
```

---

### Task 2: Конфигурация окружения и HMAC-токены

**Files:**
- Create: `dub-bot/lib/config.ts`, `dub-bot/lib/tokens.ts`
- Test: `dub-bot/tests/tokens.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `requireEnv(name: string): string`
  - `allowedChatIds(): number[]`
  - `baseUrl(): string`
  - `signToken(chatId: number, expiresAt: number, secret: string): string`
  - `verifyToken(token: string, secret: string, nowMs: number): { chatId: number } | null`
  - `tickKey(jobId: string, secret: string): string`
  - `UPLOAD_TOKEN_TTL_MS: number`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signToken, tickKey, verifyToken } from "../lib/tokens";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;

describe("verifyToken", () => {
  it("принимает свежий токен и возвращает chat_id", () => {
    const token = signToken(42, NOW + 60_000, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toEqual({ chatId: 42 });
  });

  it("отклоняет просроченный токен", () => {
    const token = signToken(42, NOW - 1, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it("отклоняет подделанную подпись", () => {
    const token = signToken(42, NOW + 60_000, SECRET);
    const tampered = `${token.split(".")[0]}.AAAA`;
    expect(verifyToken(tampered, SECRET, NOW)).toBeNull();
  });

  it("отклоняет токен, подписанный чужим секретом", () => {
    const token = signToken(42, NOW + 60_000, "other-secret");
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it("отклоняет мусор вместо токена", () => {
    expect(verifyToken("", SECRET, NOW)).toBeNull();
    expect(verifyToken("abc", SECRET, NOW)).toBeNull();
    expect(verifyToken("a.b.c", SECRET, NOW)).toBeNull();
  });

  it("не даёт подменить chat_id, оставив чужую подпись", () => {
    const token = signToken(42, NOW + 60_000, SECRET);
    const forged = `${Buffer.from(`99.${NOW + 60_000}`).toString("base64url")}.${token.split(".")[1]}`;
    expect(verifyToken(forged, SECRET, NOW)).toBeNull();
  });
});

describe("tickKey", () => {
  it("детерминирован для одной задачи", () => {
    expect(tickKey("job-1", SECRET)).toBe(tickKey("job-1", SECRET));
  });

  it("различается для разных задач", () => {
    expect(tickKey("job-1", SECRET)).not.toBe(tickKey("job-2", SECRET));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/tokens.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/tokens"`.

- [ ] **Step 3: Реализовать токены**

`dub-bot/lib/tokens.ts`:

```ts
import crypto from "node:crypto";

// Ссылка на страницу загрузки живёт полчаса: этого хватает, чтобы открыть её
// на телефоне и выбрать ролик, но недостаточно, чтобы она где-то осела.
export const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;

// Токен не хранится нигде: chat_id и срок годности зашиты в саму подпись.
export function signToken(chatId: number, expiresAt: number, secret: string): string {
  const payload = `${chatId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyToken(
  token: string,
  secret: string,
  nowMs: number
): { chatId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  const [chatIdRaw, expiresRaw] = payload.split(".");
  const chatId = Number(chatIdRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(chatId) || !Number.isFinite(expiresAt)) return null;
  if (nowMs > expiresAt) return null;
  return { chatId };
}

// Отдельный ключ для /api/dub/tick: роут дёргает сам себя, и он не должен быть
// открыт наружу — иначе чужой запрос запустит лишний опрос ElevenLabs.
export function tickKey(jobId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`tick.${jobId}`).digest("base64url");
}
```

- [ ] **Step 4: Реализовать конфигурацию**

`dub-bot/lib/config.ts`:

```ts
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Страница загрузки публична, а дубляж стоит денег: команды принимаем только
// от перечисленных чатов.
export function allowedChatIds(): number[] {
  return requireEnv("TELEGRAM_ALLOWED_CHAT_IDS")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id));
}

// Нужен, чтобы собрать ссылку на страницу загрузки и на само-вызов tick.
export function baseUrl(): string {
  const explicit = process.env.DUB_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (host) return `https://${host}`;
  throw new Error("DUB_BASE_URL is not set");
}
```

- [ ] **Step 5: Запустить тест и убедиться, что проходит**

Run: `cd dub-bot && npm test`
Expected: PASS, 15 тестов.

- [ ] **Step 6: Коммит**

```bash
git add dub-bot/lib/config.ts dub-bot/lib/tokens.ts dub-bot/tests/tokens.test.ts
git commit -m "feat(dub-bot): HMAC-токены загрузки и доступ к окружению"
```

---

### Task 3: Клиент ElevenLabs

**Files:**
- Create: `dub-bot/lib/elevenlabs.ts`
- Test: `dub-bot/tests/elevenlabs.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `SOURCE_LANG = "ru"`, `TARGET_LANG = "id"`
  - `interface Subscription { tier: string; used: number; limit: number; remaining: number }`
  - `getSubscription(apiKey: string): Promise<Subscription>`
  - `createDub(apiKey: string, opts: { sourceUrl: string; watermark: boolean; name: string }): Promise<string>`
  - `interface DubStatus { status: string; error: string | null; durationSec: number | null }`
  - `getDubStatus(apiKey: string, dubbingId: string): Promise<DubStatus>`
  - `downloadDub(apiKey: string, dubbingId: string): Promise<Response>`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/elevenlabs.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDub, getDubStatus, getSubscription } from "../lib/elevenlabs";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getSubscription", () => {
  it("считает остаток кредитов", async () => {
    stubFetch(
      Response.json({ tier: "free", character_count: 334, character_limit: 10000 })
    );
    await expect(getSubscription("k")).resolves.toEqual({
      tier: "free",
      used: 334,
      limit: 10000,
      remaining: 9666,
    });
  });

  it("не уходит в минус, если лимит уже превышен", async () => {
    stubFetch(
      Response.json({ tier: "free", character_count: 12000, character_limit: 10000 })
    );
    await expect(getSubscription("k")).resolves.toMatchObject({ remaining: 0 });
  });

  it("бросает понятную ошибку при отказе", async () => {
    stubFetch(new Response("nope", { status: 401 }));
    await expect(getSubscription("k")).rejects.toThrow(/401/);
  });
});

describe("createDub", () => {
  it("отправляет ru→id и возвращает dubbing_id", async () => {
    const fetchMock = stubFetch(Response.json({ dubbing_id: "abc" }));
    await expect(
      createDub("k", { sourceUrl: "https://blob/x.mov", watermark: true, name: "job-1" })
    ).resolves.toBe("abc");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/dubbing");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("source_url")).toBe("https://blob/x.mov");
    expect(form.get("source_lang")).toBe("ru");
    expect(form.get("target_lang")).toBe("id");
    expect(form.get("watermark")).toBe("true");
  });

  it("пробрасывает текст ошибки — по нему отличается отказ из-за тарифа", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ detail: { message: "Dubbing without a watermark is only available for Starter+ users." } }),
        { status: 400 }
      )
    );
    await expect(
      createDub("k", { sourceUrl: "https://blob/x.mov", watermark: false, name: "job-1" })
    ).rejects.toThrow(/Starter\+/);
  });
});

describe("getDubStatus", () => {
  it("разбирает готовый дубляж", async () => {
    stubFetch(
      Response.json({
        status: "dubbed",
        error: null,
        media_metadata: { content_type: "video/mp4", duration: 12.5 },
      })
    );
    await expect(getDubStatus("k", "abc")).resolves.toEqual({
      status: "dubbed",
      error: null,
      durationSec: 12.5,
    });
  });

  it("разбирает ошибку дубляжа", async () => {
    stubFetch(Response.json({ status: "failed", error: "no speech detected" }));
    await expect(getDubStatus("k", "abc")).resolves.toEqual({
      status: "failed",
      error: "no speech detected",
      durationSec: null,
    });
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/elevenlabs.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/elevenlabs"`.

- [ ] **Step 3: Реализовать клиент**

`dub-bot/lib/elevenlabs.ts`:

```ts
const BASE = "https://api.elevenlabs.io/v1";

// Бот делает ровно одно направление, поэтому языки — константы, а не параметры.
export const SOURCE_LANG = "ru";
export const TARGET_LANG = "id";

async function fail(action: string, res: Response): Promise<never> {
  throw new Error(`ElevenLabs ${action} failed (${res.status}): ${await res.text()}`);
}

export interface Subscription {
  tier: string;
  used: number;
  limit: number;
  remaining: number;
}

export async function getSubscription(apiKey: string): Promise<Subscription> {
  const res = await fetch(`${BASE}/user/subscription`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await fail("getSubscription", res);
  const data = (await res.json()) as {
    tier: string;
    character_count: number;
    character_limit: number;
  };
  return {
    tier: data.tier,
    used: data.character_count,
    limit: data.character_limit,
    remaining: Math.max(0, data.character_limit - data.character_count),
  };
}

export async function createDub(
  apiKey: string,
  opts: { sourceUrl: string; watermark: boolean; name: string }
): Promise<string> {
  // Файл не грузим — ElevenLabs сам скачает ролик по публичной ссылке из Blob.
  const form = new FormData();
  form.append("source_url", opts.sourceUrl);
  form.append("source_lang", SOURCE_LANG);
  form.append("target_lang", TARGET_LANG);
  form.append("num_speakers", "1");
  form.append("watermark", String(opts.watermark));
  form.append("name", opts.name);

  const res = await fetch(`${BASE}/dubbing`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) await fail("createDub", res);
  const data = (await res.json()) as { dubbing_id: string };
  return data.dubbing_id;
}

export interface DubStatus {
  status: string;
  error: string | null;
  durationSec: number | null;
}

export async function getDubStatus(apiKey: string, dubbingId: string): Promise<DubStatus> {
  const res = await fetch(`${BASE}/dubbing/${dubbingId}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await fail("getDubStatus", res);
  const data = (await res.json()) as {
    status: string;
    error?: string | null;
    media_metadata?: { duration?: number };
  };
  return {
    status: data.status,
    error: data.error ?? null,
    durationSec: data.media_metadata?.duration ?? null,
  };
}

// Отдаёт готовый MP4 потоком: наружу возвращаем сам Response, чтобы тело можно
// было перелить в Blob не буферизуя целиком.
export async function downloadDub(apiKey: string, dubbingId: string): Promise<Response> {
  const res = await fetch(`${BASE}/dubbing/${dubbingId}/audio/${TARGET_LANG}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) await fail("downloadDub", res);
  return res;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `cd dub-bot && npm test`
Expected: PASS, 22 теста.

- [ ] **Step 5: Коммит**

```bash
git add dub-bot/lib/elevenlabs.ts dub-bot/tests/elevenlabs.test.ts
git commit -m "feat(dub-bot): клиент ElevenLabs Dubbing API"
```

---

### Task 4: Отправка в Telegram

**Files:**
- Create: `dub-bot/lib/telegram.ts`
- Test: `dub-bot/tests/telegram.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `sendMessage(token: string, chatId: number, text: string): Promise<void>`
  - `sendVideoByUrl(token: string, chatId: number, videoUrl: string, caption: string): Promise<void>`
  - `sendVideoUpload(token: string, chatId: number, bytes: Uint8Array, filename: string, caption: string): Promise<void>`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/telegram.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, sendVideoByUrl, sendVideoUpload } from "../lib/telegram";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendMessage", () => {
  it("шлёт текст в нужный чат и гасит превью ссылок", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await sendMessage("TOK", 42, "привет");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOK/sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      chat_id: 42,
      text: "привет",
      link_preview_options: { is_disabled: true },
    });
  });

  it("бросает ошибку со статусом, если Telegram отказал", async () => {
    stubFetch(new Response("bad request", { status: 400 }));
    await expect(sendMessage("TOK", 42, "привет")).rejects.toThrow(/400/);
  });
});

describe("sendVideoByUrl", () => {
  it("передаёт ссылку — Telegram качает файл сам", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await sendVideoByUrl("TOK", 42, "https://blob/result.mp4", "готово");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOK/sendVideo");
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: 42,
      video: "https://blob/result.mp4",
      caption: "готово",
    });
  });
});

describe("sendVideoUpload", () => {
  it("грузит файл через multipart", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await sendVideoUpload("TOK", 42, new Uint8Array([1, 2, 3]), "dubbed.mp4", "готово");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOK/sendVideo");
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("42");
    expect(form.get("caption")).toBe("готово");
    expect(form.get("video")).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/telegram.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/telegram"`.

- [ ] **Step 3: Реализовать модуль**

`dub-bot/lib/telegram.ts`:

```ts
function api(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(url: string, body: BodyInit, headers?: HeadersInit): Promise<void> {
  const res = await fetch(url, { method: "POST", body, ...(headers ? { headers } : {}) });
  if (!res.ok) {
    const method = url.slice(url.lastIndexOf("/") + 1);
    throw new Error(`Telegram ${method} failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await call(
    api(token, "sendMessage"),
    JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    { "Content-Type": "application/json" }
  );
}

// Дешёвый путь: Telegram сам скачает файл по ссылке. Работает только до 20 МБ.
export async function sendVideoByUrl(
  token: string,
  chatId: number,
  videoUrl: string,
  caption: string
): Promise<void> {
  await call(
    api(token, "sendVideo"),
    JSON.stringify({
      chat_id: chatId,
      video: videoUrl,
      caption,
      supports_streaming: true,
    }),
    { "Content-Type": "application/json" }
  );
}

// Дорогой путь: гоним файл через нашу функцию. Зато потолок 50 МБ вместо 20.
export async function sendVideoUpload(
  token: string,
  chatId: number,
  bytes: Uint8Array,
  filename: string,
  caption: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("supports_streaming", "true");
  form.append("video", new Blob([bytes], { type: "video/mp4" }), filename);
  await call(api(token, "sendVideo"), form);
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `cd dub-bot && npm test`
Expected: PASS, 26 тестов.

- [ ] **Step 5: Коммит**

```bash
git add dub-bot/lib/telegram.ts dub-bot/tests/telegram.test.ts
git commit -m "feat(dub-bot): отправка сообщений и видео в Telegram"
```

---

### Task 5: Состояние задач в Blob

**Files:**
- Create: `dub-bot/lib/jobs.ts`
- Test: `dub-bot/tests/jobs.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `type JobStatus = "pending" | "dubbing" | "done" | "failed"`
  - `interface Job { jobId: string; chatId: number; dubbingId: string | null; sourceUrl: string; resultUrl: string | null; status: JobStatus; durationSec: number; createdAt: string; error: string | null }`
  - `jobPath(jobId: string): string`
  - `saveJob(job: Job): Promise<void>`
  - `loadJob(jobId: string): Promise<Job | null>`
  - `listJobs(): Promise<Job[]>`
  - `isActive(job: Job): boolean`
  - `deleteBlob(url: string): Promise<void>`
  - `JOBS_PREFIX`, `RESULTS_PREFIX`, `SOURCES_PREFIX`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/jobs.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const putMock = vi.fn();
const listMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: vi.fn(),
  head: vi.fn(),
}));

import type { Job } from "../lib/jobs";

const { isActive, jobPath, loadJob, saveJob } = await import("../lib/jobs");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "dubbing",
    durationSec: 60,
    createdAt: "2026-08-13T00:00:00.000Z",
    error: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("jobPath", () => {
  it("складывает задачи под общий префикс", () => {
    expect(jobPath("job-1")).toBe("dub/jobs/job-1.json");
  });
});

describe("saveJob", () => {
  it("перезаписывает файл под фиксированным именем", async () => {
    await saveJob(makeJob());
    const [pathname, body, options] = putMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(pathname).toBe("dub/jobs/job-1.json");
    expect(JSON.parse(body)).toMatchObject({ jobId: "job-1", chatId: 42 });
    expect(options).toMatchObject({ addRandomSuffix: false, allowOverwrite: true });
  });
});

describe("loadJob", () => {
  it("возвращает null, если задачи нет", async () => {
    listMock.mockResolvedValue({ blobs: [] });
    await expect(loadJob("missing")).resolves.toBeNull();
  });

  it("читает задачу по ссылке из Blob", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "dub/jobs/job-1.json", url: "https://blob/job-1.json" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(makeJob())));
    await expect(loadJob("job-1")).resolves.toMatchObject({ jobId: "job-1" });
  });

  it("возвращает null на битом JSON, а не падает", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "dub/jobs/job-1.json", url: "https://blob/job-1.json" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("не json")));
    await expect(loadJob("job-1")).resolves.toBeNull();
  });
});

describe("isActive", () => {
  it("активны только незавершённые задачи", () => {
    expect(isActive(makeJob({ status: "pending" }))).toBe(true);
    expect(isActive(makeJob({ status: "dubbing" }))).toBe(true);
    expect(isActive(makeJob({ status: "done" }))).toBe(false);
    expect(isActive(makeJob({ status: "failed" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/jobs.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/jobs"`.

- [ ] **Step 3: Реализовать модуль**

`dub-bot/lib/jobs.ts`:

```ts
import { del, list, put } from "@vercel/blob";

export type JobStatus = "pending" | "dubbing" | "done" | "failed";

export interface Job {
  jobId: string;
  chatId: number;
  dubbingId: string | null;
  sourceUrl: string;
  resultUrl: string | null;
  status: JobStatus;
  /** Ноль означает, что браузер не смог прочитать длительность файла. */
  durationSec: number;
  createdAt: string;
  error: string | null;
}

export const JOBS_PREFIX = "dub/jobs/";
export const RESULTS_PREFIX = "dub/results/";
export const SOURCES_PREFIX = "dub/sources/";

export function jobPath(jobId: string): string {
  return `${JOBS_PREFIX}${jobId}.json`;
}

export function isActive(job: Job): boolean {
  return job.status === "pending" || job.status === "dubbing";
}

export async function saveJob(job: Job): Promise<void> {
  await put(jobPath(job.jobId), JSON.stringify(job), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

// Blob кэшируется на CDN, поэтому читаем всегда с cache-busting параметром —
// иначе tick увидит устаревший статус задачи.
async function readJob(url: string): Promise<Job | null> {
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as Job;
  } catch {
    return null;
  }
}

export async function loadJob(jobId: string): Promise<Job | null> {
  const path = jobPath(jobId);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  return readJob(blob.url);
}

export async function listJobs(): Promise<Job[]> {
  const { blobs } = await list({ prefix: JOBS_PREFIX });
  const jobs: Job[] = [];
  for (const blob of blobs) {
    const job = await readJob(blob.url);
    if (job) jobs.push(job);
  }
  return jobs;
}

export async function deleteBlob(url: string): Promise<void> {
  // Исходник больше не нужен, но упасть на уборке нельзя — результат уже отправлен.
  try {
    await del(url);
  } catch (error) {
    console.error("blob delete failed", url, error);
  }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `cd dub-bot && npm test`
Expected: PASS, 32 теста.

- [ ] **Step 5: Коммит**

```bash
git add dub-bot/lib/jobs.ts dub-bot/tests/jobs.test.ts
git commit -m "feat(dub-bot): хранение состояния задач в Blob"
```

---

### Task 6: Цикл опроса и доставка результата

**Files:**
- Create: `dub-bot/lib/tick.ts`
- Create: `dub-bot/app/api/dub/tick/route.ts`
- Test: `dub-bot/tests/tick.test.ts`

**Interfaces:**
- Consumes: `Job`, `loadJob`, `saveJob`, `deleteBlob`, `RESULTS_PREFIX` (Task 5); `getDubStatus`, `downloadDub` (Task 3); `sendMessage`, `sendVideoByUrl`, `sendVideoUpload` (Task 4); `pickDelivery` (Task 1); `tickKey`, `requireEnv`, `baseUrl` (Task 2).
- Produces:
  - `triggerTick(jobId: string): Promise<void>` — дёргает `/api/dub/tick`, не дожидаясь работы
  - `runTick(jobId: string): Promise<void>` — один заход опроса
  - `INVOCATION_BUDGET_MS`, `JOB_DEADLINE_MS`, `POLL_INTERVAL_MS`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/tick.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadJobMock = vi.fn();
const saveJobMock = vi.fn();
const deleteBlobMock = vi.fn();
const getDubStatusMock = vi.fn();
const downloadDubMock = vi.fn();
const sendMessageMock = vi.fn();
const sendVideoByUrlMock = vi.fn();
const sendVideoUploadMock = vi.fn();
const putMock = vi.fn();
const headMock = vi.fn();

vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  loadJob: (...a: unknown[]) => loadJobMock(...a),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
  deleteBlob: (...a: unknown[]) => deleteBlobMock(...a),
}));
vi.mock("../lib/elevenlabs", () => ({
  getDubStatus: (...a: unknown[]) => getDubStatusMock(...a),
  downloadDub: (...a: unknown[]) => downloadDubMock(...a),
  TARGET_LANG: "id",
}));
vi.mock("../lib/telegram", () => ({
  sendMessage: (...a: unknown[]) => sendMessageMock(...a),
  sendVideoByUrl: (...a: unknown[]) => sendVideoByUrlMock(...a),
  sendVideoUpload: (...a: unknown[]) => sendVideoUploadMock(...a),
}));
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => putMock(...a),
  head: (...a: unknown[]) => headMock(...a),
  list: vi.fn(),
  del: vi.fn(),
}));

import type { Job } from "../lib/jobs";

const { runTick } = await import("../lib/tick");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "dubbing",
    durationSec: 60,
    createdAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "key";
  process.env.TELEGRAM_DUB_BOT_TOKEN = "tok";
  process.env.DUB_TOKEN_SECRET = "secret";
  process.env.DUB_BASE_URL = "https://dub.example";
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("runTick", () => {
  it("ничего не делает для уже завершённой задачи", async () => {
    loadJobMock.mockResolvedValue(makeJob({ status: "done" }));
    await runTick("job-1");
    expect(getDubStatusMock).not.toHaveBeenCalled();
  });

  it("сообщает об ошибке дубляжа и закрывает задачу", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "failed", error: "no speech", durationSec: null });

    await runTick("job-1");

    expect(sendMessageMock).toHaveBeenCalledWith("tok", 42, expect.stringContaining("no speech"));
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("маленький результат отдаёт ссылкой", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 5 * 1024 * 1024 });

    await runTick("job-1");

    expect(sendVideoByUrlMock).toHaveBeenCalledWith(
      "tok",
      42,
      "https://blob/result.mp4",
      expect.any(String)
    );
    expect(deleteBlobMock).toHaveBeenCalledWith("https://blob/source.mov");
    expect(saveJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", resultUrl: "https://blob/result.mp4" })
    );
  });

  it("результат между 20 и 50 МБ грузит через функцию", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 30 * 1024 * 1024 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));

    await runTick("job-1");

    expect(sendVideoUploadMock).toHaveBeenCalled();
    expect(sendVideoByUrlMock).not.toHaveBeenCalled();
  });

  it("слишком большой результат отдаёт ссылкой текстом", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 80 * 1024 * 1024 });

    await runTick("job-1");

    expect(sendMessageMock).toHaveBeenCalledWith(
      "tok",
      42,
      expect.stringContaining("https://blob/result.mp4")
    );
    expect(sendVideoUploadMock).not.toHaveBeenCalled();
  });

  it("сдаётся, если задача висит дольше получаса", async () => {
    loadJobMock.mockResolvedValue(
      makeJob({ createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() })
    );

    await runTick("job-1");

    expect(getDubStatusMock).not.toHaveBeenCalled();
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/tick.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/tick"`.

- [ ] **Step 3: Реализовать цикл**

`dub-bot/lib/tick.ts`:

```ts
import { head, put } from "@vercel/blob";
import { baseUrl, requireEnv } from "./config";
import { pickDelivery } from "./credits";
import { downloadDub, getDubStatus } from "./elevenlabs";
import { deleteBlob, Job, loadJob, RESULTS_PREFIX, saveJob } from "./jobs";
import { sendMessage, sendVideoByUrl, sendVideoUpload } from "./telegram";
import { tickKey } from "./tokens";

export const POLL_INTERVAL_MS = 10_000;
// Лимит функции — 300 с. Оставляем запас на доставку результата.
export const INVOCATION_BUDGET_MS = 240_000;
// Дольше получаса ждать нечего: либо ElevenLabs завис, либо ролик неподъёмный.
export const JOB_DEADLINE_MS = 30 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Роут возвращает 202 сразу, поэтому вызов дешёвый: он лишь запускает
// следующее звено цепочки опроса.
export async function triggerTick(jobId: string): Promise<void> {
  const key = tickKey(jobId, requireEnv("DUB_TOKEN_SECRET"));
  const url = `${baseUrl()}/api/dub/tick?job=${encodeURIComponent(jobId)}&key=${key}`;
  await fetch(url, { method: "POST", cache: "no-store" });
}

async function failJob(job: Job, message: string): Promise<void> {
  await sendMessage(requireEnv("TELEGRAM_DUB_BOT_TOKEN"), job.chatId, message);
  await saveJob({ ...job, status: "failed", error: message });
}

async function deliver(job: Job): Promise<void> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const botToken = requireEnv("TELEGRAM_DUB_BOT_TOKEN");

  // Тело ElevenLabs переливаем в Blob потоком: держать 100+ МБ в памяти незачем.
  const dubbed = await downloadDub(apiKey, job.dubbingId as string);
  const result = await put(`${RESULTS_PREFIX}${job.jobId}.mp4`, dubbed.body as ReadableStream, {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
  });

  const { size } = await head(result.url);
  const caption = "Готово — дубляж на индонезийском";

  switch (pickDelivery(size)) {
    case "url":
      await sendVideoByUrl(botToken, job.chatId, result.url, caption);
      break;
    case "upload": {
      const res = await fetch(result.url, { cache: "no-store" });
      const bytes = new Uint8Array(await res.arrayBuffer());
      await sendVideoUpload(botToken, job.chatId, bytes, `${job.jobId}.mp4`, caption);
      break;
    }
    case "link": {
      const mb = Math.round(size / 1024 / 1024);
      await sendMessage(
        botToken,
        job.chatId,
        `${caption}. Файл ${mb} МБ — это больше лимита Telegram, забирай по ссылке:\n${result.url}`
      );
      break;
    }
  }

  await deleteBlob(job.sourceUrl);
  await saveJob({ ...job, status: "done", resultUrl: result.url });
}

export async function runTick(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job || job.status === "done" || job.status === "failed") return;
  if (!job.dubbingId) return;

  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const startedAt = Date.now();

  while (Date.now() - startedAt < INVOCATION_BUDGET_MS) {
    if (Date.now() - Date.parse(job.createdAt) > JOB_DEADLINE_MS) {
      await failJob(job, "Дубляж не уложился в 30 минут. Попробуй ещё раз через /dub.");
      return;
    }

    const status = await getDubStatus(apiKey, job.dubbingId);
    if (status.status === "failed") {
      await failJob(job, `ElevenLabs не справился: ${status.error ?? "без деталей"}`);
      return;
    }
    if (status.status === "dubbed") {
      await deliver(job);
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Бюджет вызова исчерпан — продлеваем цепочку новым вызовом.
  await triggerTick(jobId);
}
```

- [ ] **Step 4: Реализовать роут**

`dub-bot/app/api/dub/tick/route.ts`:

```ts
import { after, NextRequest, NextResponse } from "next/server";
import { requireEnv } from "../../../../lib/config";
import { runTick } from "../../../../lib/tick";
import { tickKey } from "../../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const jobId = req.nextUrl.searchParams.get("job") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!jobId || key !== tickKey(jobId, requireEnv("DUB_TOKEN_SECRET"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Отвечаем сразу, а опрос крутим после ответа: вызывающая сторона не должна
  // висеть все четыре минуты.
  after(() => runTick(jobId).catch((error) => console.error("tick failed", jobId, error)));
  return NextResponse.json({ ok: true }, { status: 202 });
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `cd dub-bot && npm test`
Expected: PASS, 38 тестов.

- [ ] **Step 6: Коммит**

```bash
git add dub-bot/lib/tick.ts dub-bot/app/api/dub/tick/route.ts dub-bot/tests/tick.test.ts
git commit -m "feat(dub-bot): опрос ElevenLabs цепочкой вызовов и доставка результата"
```

---

### Task 7: Вебхук бота

**Files:**
- Create: `dub-bot/lib/commands.ts`, `dub-bot/app/api/telegram/route.ts`
- Test: `dub-bot/tests/commands.test.ts`

**Interfaces:**
- Consumes: `signToken`, `UPLOAD_TOKEN_TTL_MS` (Task 2); `listJobs`, `isActive` (Task 5); `triggerTick` (Task 6); `formatDuration` (Task 1).
- Produces:
  - `parseCommand(text: string): "dub" | "status" | "help" | null`
  - `handleCommand(command, chatId, deps): Promise<string>` где `deps: { uploadUrl: (chatId: number) => string; listJobs: () => Promise<Job[]>; triggerTick: (jobId: string) => Promise<void> }`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/commands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleCommand, parseCommand } from "../lib/commands";
import type { Job } from "../lib/jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "dubbing",
    durationSec: 90,
    createdAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("распознаёт команды, в том числе с упоминанием бота", () => {
    expect(parseCommand("/dub")).toBe("dub");
    expect(parseCommand("/dub@my_bot")).toBe("dub");
    expect(parseCommand("  /status  ")).toBe("status");
    expect(parseCommand("/help")).toBe("help");
    expect(parseCommand("/start")).toBe("help");
  });

  it("игнорирует всё остальное", () => {
    expect(parseCommand("привет")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("handleCommand", () => {
  const deps = {
    uploadUrl: (chatId: number) => `https://dub.example/u/token-${chatId}`,
    listJobs: vi.fn(),
    triggerTick: vi.fn(),
  };

  it("на /dub отдаёт ссылку загрузки", async () => {
    const text = await handleCommand("dub", 42, { ...deps, listJobs: vi.fn() });
    expect(text).toContain("https://dub.example/u/token-42");
  });

  it("на /status сообщает, что задач нет", async () => {
    const listJobs = vi.fn().mockResolvedValue([]);
    const text = await handleCommand("status", 42, { ...deps, listJobs });
    expect(text).toContain("нет");
  });

  it("на /status перечисляет активные задачи и пинает их", async () => {
    const listJobs = vi.fn().mockResolvedValue([makeJob()]);
    const triggerTick = vi.fn();
    const text = await handleCommand("status", 42, { ...deps, listJobs, triggerTick });
    expect(text).toContain("1:30");
    expect(triggerTick).toHaveBeenCalledWith("job-1");
  });

  it("на /status не показывает чужие и завершённые задачи", async () => {
    const listJobs = vi.fn().mockResolvedValue([
      makeJob({ jobId: "other", chatId: 99 }),
      makeJob({ jobId: "finished", status: "done" }),
    ]);
    const triggerTick = vi.fn();
    const text = await handleCommand("status", 42, { ...deps, listJobs, triggerTick });
    expect(text).toContain("нет");
    expect(triggerTick).not.toHaveBeenCalled();
  });

  it("на /help перечисляет команды", async () => {
    const text = await handleCommand("help", 42, { ...deps, listJobs: vi.fn() });
    expect(text).toContain("/dub");
    expect(text).toContain("/status");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/commands.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/commands"`.

- [ ] **Step 3: Реализовать команды**

`dub-bot/lib/commands.ts`:

```ts
import { formatDuration } from "./credits";
import { isActive, Job } from "./jobs";

export type Command = "dub" | "status" | "help";

export interface CommandDeps {
  uploadUrl: (chatId: number) => string;
  listJobs: () => Promise<Job[]>;
  triggerTick: (jobId: string) => Promise<void>;
}

export function parseCommand(text: string): Command | null {
  // В группах Telegram дописывает к команде имя бота: /dub@my_bot.
  const word = text.trim().split(/\s+/)[0]?.split("@")[0];
  switch (word) {
    case "/dub":
      return "dub";
    case "/status":
      return "status";
    case "/help":
    case "/start":
      return "help";
    default:
      return null;
  }
}

const HELP = [
  "Дубляж видео с русского на индонезийский.",
  "",
  "/dub — получить ссылку для загрузки ролика",
  "/status — проверить задачи в работе",
  "/help — эта справка",
].join("\n");

export async function handleCommand(
  command: Command,
  chatId: number,
  deps: CommandDeps
): Promise<string> {
  if (command === "help") return HELP;

  if (command === "dub") {
    return [
      "Открой ссылку и выбери видео — она живёт 30 минут:",
      deps.uploadUrl(chatId),
      "",
      "Готовый ролик пришлю сюда же.",
    ].join("\n");
  }

  const mine = (await deps.listJobs()).filter((job) => job.chatId === chatId && isActive(job));
  if (mine.length === 0) return "Задач в работе нет. Отправь /dub, чтобы начать.";

  // Заодно подталкиваем задачи: если цепочка опроса оборвалась, /status её оживит.
  await Promise.all(mine.map((job) => deps.triggerTick(job.jobId)));

  const lines = mine.map((job) => `• ${formatDuration(job.durationSec)} — ${job.status}`);
  return [`В работе: ${mine.length}`, ...lines, "", "Пришлю, как будет готово."].join("\n");
}
```

- [ ] **Step 4: Реализовать роут вебхука**

`dub-bot/app/api/telegram/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { allowedChatIds, baseUrl, requireEnv } from "../../../lib/config";
import { handleCommand, parseCommand } from "../../../lib/commands";
import { listJobs } from "../../../lib/jobs";
import { sendMessage } from "../../../lib/telegram";
import { triggerTick } from "../../../lib/tick";
import { signToken, UPLOAD_TOKEN_TTL_MS } from "../../../lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Секрет проверяем до разбора тела: вебхук открыт наружу.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== requireEnv("TELEGRAM_WEBHOOK_SECRET")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = (await req.json()) as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (typeof chatId !== "number" || !text) return NextResponse.json({ ok: true });

  const botToken = requireEnv("TELEGRAM_DUB_BOT_TOKEN");
  if (!allowedChatIds().includes(chatId)) {
    await sendMessage(botToken, chatId, "Этот бот приватный.");
    return NextResponse.json({ ok: true });
  }

  const command = parseCommand(text);
  if (!command) {
    await sendMessage(botToken, chatId, "Не понял. Отправь /dub или /help.");
    return NextResponse.json({ ok: true });
  }

  try {
    const reply = await handleCommand(command, chatId, {
      uploadUrl: (id) => {
        const token = signToken(id, Date.now() + UPLOAD_TOKEN_TTL_MS, requireEnv("DUB_TOKEN_SECRET"));
        return `${baseUrl()}/u/${token}`;
      },
      listJobs,
      triggerTick,
    });
    await sendMessage(botToken, chatId, reply);
  } catch (error) {
    console.error("command failed", command, error);
    await sendMessage(botToken, chatId, `Сломалось: ${(error as Error).message}`);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `cd dub-bot && npm test`
Expected: PASS, 45 тестов.

- [ ] **Step 6: Коммит**

```bash
git add dub-bot/lib/commands.ts dub-bot/app/api/telegram/route.ts dub-bot/tests/commands.test.ts
git commit -m "feat(dub-bot): вебхук бота с командами /dub, /status, /help"
```

---

### Task 8: Страница загрузки

**Files:**
- Create: `dub-bot/app/layout.tsx`, `dub-bot/app/u/[token]/page.tsx`, `dub-bot/app/u/[token]/upload-form.tsx`, `dub-bot/app/api/upload/route.ts`

**Interfaces:**
- Consumes: `verifyToken` (Task 2), `estimateCredits`, `formatDuration` (Task 1).
- Путь `dub/sources/…` в клиентском компоненте задаётся строкой, а не импортом из
  `lib/jobs.ts`: тот тянет `@vercel/blob` и не должен попасть в браузерный бандл.
- Produces: страница `/u/<token>`, роут `POST /api/upload`, вызывающий `POST /api/dub/start` с телом `{ token, blobUrl, durationSec }`.

- [ ] **Step 1: Создать корневой layout**

`dub-bot/app/layout.tsx`:

```tsx
export const metadata = { title: "Дубляж" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: "24px",
          maxWidth: 560,
        }}
      >
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Создать страницу**

`dub-bot/app/u/[token]/page.tsx`:

```tsx
import { requireEnv } from "../../../lib/config";
import { verifyToken } from "../../../lib/tokens";
import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claim = verifyToken(token, requireEnv("DUB_TOKEN_SECRET"), Date.now());

  if (!claim) {
    return (
      <main>
        <h1>Ссылка недействительна</h1>
        <p>Отправь боту /dub, чтобы получить новую.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Дубляж на индонезийский</h1>
      <UploadForm token={token} />
    </main>
  );
}
```

- [ ] **Step 3: Создать форму загрузки**

`dub-bot/app/u/[token]/upload-form.tsx`:

```tsx
"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { estimateCredits, formatDuration } from "../../../lib/credits";

type Stage = "idle" | "uploading" | "starting" | "done" | "error";

// Длительность нужна, чтобы показать цену до запуска. На части .MOV браузер её
// не отдаёт — тогда просто не показываем оценку, а не блокируем загрузку.
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(0);
    };
    video.src = URL.createObjectURL(file);
  });
}

export default function UploadForm({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");

  async function onPick(picked: File | null) {
    setFile(picked);
    setStage("idle");
    setMessage("");
    setDurationSec(picked ? await readDuration(picked) : 0);
  }

  async function onSubmit() {
    if (!file) return;
    try {
      setStage("uploading");
      const blob = await upload(`dub/sources/${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: token,
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });

      setStage("starting");
      const res = await fetch("/api/dub/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, blobUrl: blob.url, durationSec }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "не вышло");

      setStage("done");
    } catch (error) {
      setStage("error");
      setMessage((error as Error).message);
    }
  }

  const credits = estimateCredits(durationSec);

  return (
    <div>
      <input
        type="file"
        accept="video/*"
        onChange={(event) => void onPick(event.target.files?.[0] ?? null)}
        disabled={stage === "uploading" || stage === "starting"}
      />

      {file && durationSec > 0 && (
        <p>
          Длительность {formatDuration(durationSec)} — примерно {credits} кредитов.
        </p>
      )}
      {file && durationSec === 0 && <p>Длительность не определилась — посчитаю на сервере.</p>}

      <button
        onClick={() => void onSubmit()}
        disabled={!file || stage === "uploading" || stage === "starting" || stage === "done"}
      >
        Дублировать
      </button>

      {stage === "uploading" && <p>Загрузка: {progress}%</p>}
      {stage === "starting" && <p>Отправляю в обработку…</p>}
      {stage === "done" && <p>Готово. Ролик придёт в Telegram — вкладку можно закрыть.</p>}
      {stage === "error" && <p style={{ color: "crimson" }}>Ошибка: {message}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Создать роут выдачи токена загрузки**

`dub-bot/app/api/upload/route.ts`:

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "../../../lib/config";
import { verifyToken } from "../../../lib/tokens";

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
        const claim = verifyToken(
          clientPayload ?? "",
          requireEnv("DUB_TOKEN_SECRET"),
          Date.now()
        );
        if (!claim) throw new Error("Ссылка просрочена — запроси новую через /dub");

        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ chatId: claim.chatId }),
        };
      },
      onUploadCompleted: async () => {
        // Задачу запускает страница через /api/dub/start — здесь делать нечего.
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 5: Проверить сборку**

Run: `cd dub-bot && npm run build`
Expected: сборка проходит, роуты `/u/[token]`, `/api/upload`, `/api/telegram`, `/api/dub/tick` перечислены в выводе.

- [ ] **Step 6: Коммит**

```bash
git add dub-bot/app/
git commit -m "feat(dub-bot): страница загрузки видео напрямую в Blob"
```

---

### Task 9: Запуск задачи дубляжа

**Files:**
- Create: `dub-bot/app/api/dub/start/route.ts`, `dub-bot/lib/start.ts`
- Test: `dub-bot/tests/start.test.ts`

**Interfaces:**
- Consumes: `verifyToken` (Task 2); `estimateCredits` (Task 1); `getSubscription`, `createDub` (Task 3); `saveJob`, `Job` (Task 5); `triggerTick` (Task 6); `sendMessage` (Task 4).
- Produces: `startDub(input: { token: string; blobUrl: string; durationSec: number }): Promise<{ jobId: string }>`, `isOwnBlobUrl(url: string): boolean`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/start.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSubscriptionMock = vi.fn();
const createDubMock = vi.fn();
const saveJobMock = vi.fn();
const sendMessageMock = vi.fn();
const triggerTickMock = vi.fn();

vi.mock("../lib/elevenlabs", () => ({
  getSubscription: (...a: unknown[]) => getSubscriptionMock(...a),
  createDub: (...a: unknown[]) => createDubMock(...a),
}));
vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
}));
vi.mock("../lib/telegram", () => ({ sendMessage: (...a: unknown[]) => sendMessageMock(...a) }));
vi.mock("../lib/tick", () => ({ triggerTick: (...a: unknown[]) => triggerTickMock(...a) }));

const { isOwnBlobUrl, startDub } = await import("../lib/start");
const { signToken } = await import("../lib/tokens");

const SECRET = "secret";
const BLOB = "https://abc123.public.blob.vercel-storage.com/dub/sources/1-video.mov";

beforeEach(() => {
  process.env.DUB_TOKEN_SECRET = SECRET;
  process.env.ELEVENLABS_API_KEY = "key";
  process.env.TELEGRAM_DUB_BOT_TOKEN = "tok";
  getSubscriptionMock.mockResolvedValue({ tier: "free", used: 0, limit: 10000, remaining: 10000 });
  createDubMock.mockResolvedValue("dub-1");
});

afterEach(() => {
  vi.clearAllMocks();
});

function freshToken(chatId = 42) {
  return signToken(chatId, Date.now() + 60_000, SECRET);
}

describe("isOwnBlobUrl", () => {
  it("принимает только публичные ссылки Vercel Blob", () => {
    expect(isOwnBlobUrl(BLOB)).toBe(true);
    expect(isOwnBlobUrl("https://evil.example/video.mp4")).toBe(false);
    expect(isOwnBlobUrl("http://abc.public.blob.vercel-storage.com/x.mov")).toBe(false);
  });
});

describe("startDub", () => {
  it("создаёт задачу и запускает опрос", async () => {
    const { jobId } = await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });

    expect(createDubMock).toHaveBeenCalledWith("key", expect.objectContaining({ sourceUrl: BLOB }));
    expect(saveJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, chatId: 42, dubbingId: "dub-1", status: "dubbing" })
    );
    expect(triggerTickMock).toHaveBeenCalledWith(jobId);
    expect(sendMessageMock).toHaveBeenCalled();
  });

  it("на free-тарифе включает водяной знак", async () => {
    await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(createDubMock).toHaveBeenCalledWith("key", expect.objectContaining({ watermark: true }));
  });

  it("на платном тарифе водяной знак снимает", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "creator", used: 0, limit: 121000, remaining: 121000 });
    await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(createDubMock).toHaveBeenCalledWith("key", expect.objectContaining({ watermark: false }));
  });

  it("отказывает по просроченному токену", async () => {
    const stale = signToken(42, Date.now() - 1, SECRET);
    await expect(startDub({ token: stale, blobUrl: BLOB, durationSec: 60 })).rejects.toThrow(/ссылк/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("отказывает по чужой ссылке — иначе дубляжу скормят что угодно", async () => {
    await expect(
      startDub({ token: freshToken(), blobUrl: "https://evil.example/v.mp4", durationSec: 60 })
    ).rejects.toThrow(/ссылк/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("отказывает, когда кредитов не хватает", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "free", used: 9800, limit: 10000, remaining: 200 });
    await expect(
      startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 })
    ).rejects.toThrow(/кредит/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("не блокирует запуск, если длительность не определилась", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "free", used: 9800, limit: 10000, remaining: 200 });
    await expect(
      startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 0 })
    ).resolves.toMatchObject({ jobId: expect.any(String) });
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/start.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/start"`.

- [ ] **Step 3: Реализовать запуск**

`dub-bot/lib/start.ts`:

```ts
import crypto from "node:crypto";
import { requireEnv } from "./config";
import { estimateCredits, formatDuration } from "./credits";
import { createDub, getSubscription } from "./elevenlabs";
import { Job, saveJob } from "./jobs";
import { sendMessage } from "./telegram";
import { triggerTick } from "./tick";
import { verifyToken } from "./tokens";

// Ссылку в ElevenLabs подставляет клиент, поэтому принимаем только наш Blob:
// иначе через бота можно было бы дублировать произвольное чужое видео.
export function isOwnBlobUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(url);
}

export async function startDub(input: {
  token: string;
  blobUrl: string;
  durationSec: number;
}): Promise<{ jobId: string }> {
  const claim = verifyToken(input.token, requireEnv("DUB_TOKEN_SECRET"), Date.now());
  if (!claim) throw new Error("Ссылка просрочена — запроси новую через /dub");
  if (!isOwnBlobUrl(input.blobUrl)) throw new Error("Ссылка на файл не из нашего хранилища");

  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const subscription = await getSubscription(apiKey);

  // При неизвестной длительности оценка равна нулю — проверку пропускаем,
  // ограничение всё равно применит сам ElevenLabs.
  const needed = estimateCredits(input.durationSec);
  if (needed > subscription.remaining) {
    throw new Error(
      `Нужно ${needed} кредитов на ${formatDuration(input.durationSec)}, а осталось ${subscription.remaining}`
    );
  }

  const jobId = crypto.randomUUID();
  const dubbingId = await createDub(apiKey, {
    sourceUrl: input.blobUrl,
    watermark: subscription.tier === "free",
    name: jobId,
  });

  const job: Job = {
    jobId,
    chatId: claim.chatId,
    dubbingId,
    sourceUrl: input.blobUrl,
    resultUrl: null,
    status: "dubbing",
    durationSec: input.durationSec,
    createdAt: new Date().toISOString(),
    error: null,
  };
  await saveJob(job);

  const note = subscription.tier === "free" ? " Тариф free — будет водяной знак." : "";
  await sendMessage(
    requireEnv("TELEGRAM_DUB_BOT_TOKEN"),
    claim.chatId,
    `Взял в работу: ${formatDuration(input.durationSec)}.${note} Пришлю готовый ролик сюда.`
  );

  await triggerTick(jobId);
  return { jobId };
}
```

- [ ] **Step 4: Реализовать роут**

`dub-bot/app/api/dub/start/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { startDub } from "../../../../lib/start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { token?: string; blobUrl?: string; durationSec?: number };
  if (!body.token || !body.blobUrl) {
    return NextResponse.json({ error: "token и blobUrl обязательны" }, { status: 400 });
  }

  try {
    const result = await startDub({
      token: body.token,
      blobUrl: body.blobUrl,
      durationSec: Number(body.durationSec) || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `cd dub-bot && npm test`
Expected: PASS, 53 теста.

- [ ] **Step 6: Коммит**

```bash
git add dub-bot/lib/start.ts dub-bot/app/api/dub/start/ dub-bot/tests/start.test.ts
git commit -m "feat(dub-bot): запуск задачи дубляжа с проверкой кредитов"
```

---

### Task 10: Суточная уборка

**Files:**
- Create: `dub-bot/app/api/cleanup/route.ts`, `dub-bot/lib/cleanup.ts`, `dub-bot/vercel.json`
- Test: `dub-bot/tests/cleanup.test.ts`

**Interfaces:**
- Consumes: `listJobs`, `deleteBlob`, `jobPath`, `isActive`, `Job` (Task 5).
- Produces: `staleJobs(jobs: Job[], nowMs: number): Job[]`, `RETENTION_MS`

- [ ] **Step 1: Написать падающий тест**

`dub-bot/tests/cleanup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RETENTION_MS, staleJobs } from "../lib/cleanup";
import type { Job } from "../lib/jobs";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: "https://blob/result.mp4",
    status: "done",
    durationSec: 60,
    createdAt: new Date(NOW).toISOString(),
    error: null,
    ...overrides,
  };
}

describe("staleJobs", () => {
  it("не трогает свежие задачи", () => {
    expect(staleJobs([makeJob()], NOW)).toEqual([]);
  });

  it("забирает завершённые задачи старше суток", () => {
    const old = makeJob({ createdAt: new Date(NOW - RETENTION_MS - 1).toISOString() });
    expect(staleJobs([old], NOW)).toHaveLength(1);
  });

  it("не удаляет активную задачу, даже если она старая — её добьёт дедлайн", () => {
    const stuck = makeJob({
      status: "dubbing",
      createdAt: new Date(NOW - RETENTION_MS - 1).toISOString(),
    });
    expect(staleJobs([stuck], NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd dub-bot && npm test tests/cleanup.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/cleanup"`.

- [ ] **Step 3: Реализовать уборку**

`dub-bot/lib/cleanup.ts`:

```ts
import { del } from "@vercel/blob";
import { isActive, Job, jobPath, listJobs } from "./jobs";

// Сутки: готовый ролик к этому времени уже забран из Telegram.
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export function staleJobs(jobs: Job[], nowMs: number): Job[] {
  return jobs.filter(
    (job) => !isActive(job) && nowMs - Date.parse(job.createdAt) > RETENTION_MS
  );
}

export async function cleanup(nowMs: number): Promise<number> {
  const stale = staleJobs(await listJobs(), nowMs);
  for (const job of stale) {
    const targets = [job.sourceUrl, job.resultUrl].filter((url): url is string => Boolean(url));
    for (const url of targets) {
      try {
        await del(url);
      } catch (error) {
        console.error("cleanup delete failed", url, error);
      }
    }
    try {
      await del(jobPath(job.jobId));
    } catch (error) {
      console.error("cleanup delete job failed", job.jobId, error);
    }
  }
  return stale.length;
}
```

- [ ] **Step 4: Реализовать роут и cron**

`dub-bot/app/api/cleanup/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cleanup } from "../../../lib/cleanup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Vercel подписывает вызовы cron этим заголовком.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const removed = await cleanup(Date.now());
  return NextResponse.json({ ok: true, removed });
}
```

`dub-bot/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cleanup", "schedule": "0 4 * * *" }]
}
```

- [ ] **Step 5: Запустить тесты и сборку**

Run: `cd dub-bot && npm test && npm run build`
Expected: PASS, 56 тестов; сборка проходит.

- [ ] **Step 6: Коммит**

```bash
git add dub-bot/lib/cleanup.ts dub-bot/app/api/cleanup/ dub-bot/vercel.json dub-bot/tests/cleanup.test.ts
git commit -m "feat(dub-bot): суточная уборка старых задач и файлов"
```

---

### Task 11: Деплой, подключение вебхука и смоук-тест

**Files:**
- Create: `dub-bot/README.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: работающий бот в проде.

- [ ] **Step 1: Создать бота в Telegram**

В `@BotFather`: `/newbot`, имя на выбор. Сохранить токен — это `TELEGRAM_DUB_BOT_TOKEN`.

Узнать свой `chat_id`: написать боту любое сообщение, затем открыть
`https://api.telegram.org/bot<TOKEN>/getUpdates` и взять `message.chat.id`.

- [ ] **Step 2: Создать проект на Vercel**

```bash
cd dub-bot
vercel link --yes --project dub-bot
vercel blob store add dub-bot-store
```

Если команда создания стора недоступна в текущей версии CLI — создать Blob store
через дашборд Vercel (Storage → Create → Blob) и подключить к проекту `dub-bot`
для окружений Production, Preview и Development.

- [ ] **Step 3: Прописать переменные окружения**

```bash
cd dub-bot
printf '%s' "<токен бота>"                  | vercel env add TELEGRAM_DUB_BOT_TOKEN production
printf '%s' "<твой chat_id>"                | vercel env add TELEGRAM_ALLOWED_CHAT_IDS production
printf '%s' "$(openssl rand -hex 32)"       | vercel env add TELEGRAM_WEBHOOK_SECRET production
printf '%s' "<ключ ElevenLabs>"             | vercel env add ELEVENLABS_API_KEY production
printf '%s' "$(openssl rand -hex 32)"       | vercel env add DUB_TOKEN_SECRET production
printf '%s' "$(openssl rand -hex 32)"       | vercel env add CRON_SECRET production
```

`DUB_BASE_URL` добавить после первого деплоя, когда станет известен прод-домен:

```bash
printf '%s' "https://<домен>" | vercel env add DUB_BASE_URL production
```

- [ ] **Step 4: Задеплоить**

Run: `cd dub-bot && vercel deploy --prod`
Expected: деплой успешен, в выводе — прод-URL.

- [ ] **Step 5: Подключить вебхук**

```bash
curl -sS -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<домен>/api/telegram","secret_token":"<TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message"]}'
```

Проверить: `curl -sS "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
Expected: `"url"` совпадает, `"last_error_message"` отсутствует.

- [ ] **Step 6: Смоук-тест на коротком ролике**

Записать 15 секунд русской речи на телефон и пройти путь целиком:

1. Отправить боту `/dub` → должна прийти ссылка.
2. Открыть ссылку на телефоне, выбрать ролик → увидеть длительность и оценку в кредитах.
3. Нажать «Дублировать» → прогресс загрузки доходит до 100%.
4. В Telegram приходит «Взял в работу».
5. Через несколько минут приходит готовое видео.

Проверить главное: **звучит ли в ответе твой голос**. На free-тарифе
`can_use_instant_voice_cloning: false`, и если голос чужой — вопрос закрывается
переходом на Starter, код менять не нужно.

Если что-то зависло: отправить `/status` — он оживит цепочку опроса.

При разборе ошибок смотреть логи: `vercel logs <домен> --follow`.

- [ ] **Step 7: Написать README**

`dub-bot/README.md` — коротко: назначение, команды бота, список переменных
окружения, как переподключить вебхук, где смотреть логи, ссылка на спеку
`docs/superpowers/specs/2026-08-13-telegram-dubbing-bot-design.md`.

- [ ] **Step 8: Перевыпустить ключ ElevenLabs**

Ключ засветился в переписке. В кабинете ElevenLabs выпустить новый, обновить
переменную и передеплоить:

```bash
cd dub-bot
vercel env rm ELEVENLABS_API_KEY production --yes
printf '%s' "<новый ключ>" | vercel env add ELEVENLABS_API_KEY production
vercel deploy --prod
```

- [ ] **Step 9: Коммит**

```bash
git add dub-bot/README.md
git commit -m "docs(dub-bot): описание проекта и настройки"
```
