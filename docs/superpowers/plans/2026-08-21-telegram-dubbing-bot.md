# Телеграм-бот дубляжа RU → Bahasa Indonesia: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Телеграм-бот, который принимает ролик до 61 секунды с русской речью и возвращает тот же ролик с индонезийской озвучкой поверх приглушённого оригинала.

**Architecture:** Проект Next.js на Vercel в папке `dub-bot/`. Видео грузится браузером напрямую в Vercel Blob мимо лимитов Telegram; конвейер (ffprobe → Scribe v2 → GPT-5.1 → ElevenLabs TTS → ffmpeg) исполняется одним вызовом функции с бюджетом 800 секунд. Каркас переносится из `sub-bot` (ветка `worktree-sub-bot`), задняя половина — вшивание субтитров — заменяется на синтез речи и сведение звука.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@vercel/blob`, `ffmpeg-static` (ffmpeg 7.0.2), `ffprobe-static`, Vitest, ElevenLabs Scribe v2 + Flash v2.5, OpenAI GPT-5.1.

**Spec:** `docs/superpowers/specs/2026-08-21-telegram-dubbing-bot-design.md`

## Global Constraints

Значения скопированы из спеки дословно. Требования каждой задачи неявно включают этот раздел.

- Потолок длительности ролика: `MAX_DURATION_SEC = 61.0` — не 60.0, телефонные экспорты дают 60.03–60.5 с.
- Граница реплики: пауза `PAUSE_BREAK_SEC = 0.3` секунды или конец предложения.
- Темп индонезийской синтетической речи: `CHARS_PER_SEC = 15` — оценка, калибруется на смоуке (Задача 10).
- Потолок ускорения: `MAX_TEMPO = 1.15`, применяется фильтром `atempo`.
- Приглушение оригинала: `DUB_DUCK_LEVEL`, по умолчанию `0.13` (−18 dB).
- Модель синтеза: `eleven_flash_v2_5`, `language_code: "id"` передаётся явно.
- Одновременных запросов к TTS: `DUB_TTS_CONCURRENCY`, по умолчанию `2` (потолок бесплатного тарифа ElevenLabs).
- Модель распознавания: `scribe_v2`, `language_code: "rus"`, `timestamps_granularity: "word"`.
- Модель перевода: `gpt-5.1`, ответ по `json_schema` со `strict: true`.
- Дедлайн задачи: 30 минут. Порог перехвата брошенной стадии: 5 минут.
- Переменные окружения: `TELEGRAM_DUB_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `DUB_VOICE_ID`, `DUB_DUCK_LEVEL`, `DUB_TTS_CONCURRENCY`, `DUB_TOKEN_SECRET`, `DUB_BASE_URL`, `BLOB_READ_WRITE_TOKEN`.
- Функция конвейера: `memory: 4096`, `maxDuration: 800` (доступно на плане pro команды `alanalmas82-6453s-projects`).
- Язык кода и сообщений: комментарии и тексты в чат по-русски, как в остальном репозитории.

## Файловая структура

Всё внутри `dub-bot/`. Пути ниже даны относительно этой папки.

| Файл | Ответственность | Судьба |
| --- | --- | --- |
| `lib/config.ts` | `requireEnv`, `allowedChatIds`, `baseUrl` | перенос, префикс `DUB_` |
| `lib/binaries.ts` | Пути к ffmpeg/ffprobe, сверка SHA256 | перенос, `fontPath` удаляется |
| `lib/proc.ts` | `spawnRunner`, `createCollector` | перенос без изменений |
| `lib/media.ts` | `probeMedia`: длительность и наличие звука | перенос без изменений |
| `lib/storage.ts` | `downloadToTmp` | перенос без изменений |
| `lib/telegram.ts` | `sendMessage`, `sendVideoByUrl`, `sendVideoUpload` | перенос без изменений |
| `lib/tokens.ts` | HMAC-токены загрузки и самовызова | перенос без изменений |
| `lib/scribe.ts` | Scribe v2 → слова с таймкодами | перенос без изменений |
| `lib/glossary.ts` | Термины ислама, поиск по целому слову | перенос без изменений |
| `lib/jobs.ts` | Состояние задачи в Blob | Задача 1: новая машина стадий |
| `lib/cleanup.ts` | Суточный cron | Задача 1: правка под новые стадии |
| `lib/cues.ts` | Слова → реплики, длина слота | Задача 1 (типы) + Задача 2 (логика) |
| `lib/fit.ts` | Бюджет знаков, темп, раскладка | Задача 3, новый |
| `lib/validate.ts` | Сверка терминологии перевода | Задача 4: геометрия снята |
| `lib/translate.ts` | Посегментный перевод с бюджетом знаков | Задача 4 |
| `lib/tts.ts` | Синтез реплик, пул параллелизма | Задача 5, новый |
| `lib/mix.ts` | Сборка filter_complex и запуск ffmpeg | Задача 6, новый |
| `lib/pipeline.ts` | Конвейер от исходника до готового файла | Задача 7 |
| `lib/commands.ts` | `/dub`, `/status`, `/help` | Задача 8 |
| `lib/deliver.ts` | Выбор ветки доставки, текст отчёта | Задача 8 |
| `lib/probe.ts` | Самопроверка окружения | Задача 9 |
| `app/api/telegram/route.ts` | Вебхук бота | Задача 8 |
| `app/api/upload/route.ts` | Токен клиентской загрузки | перенос |
| `app/u/[token]/page.tsx`, `upload-form.tsx` | Страница загрузки | перенос |
| `app/api/dub/start/route.ts` | Создание задачи и запуск конвейера | Задача 7 |
| `app/api/cleanup/route.ts` | Cron | перенос |
| `app/api/probe/route.ts` | Самопроверка | Задача 9 |

Удаляются насовсем: `lib/ass.ts`, `lib/textwidth.ts`, `lib/render.ts`, `lib/escape.ts`, `lib/sacred.ts`, `assets/PlusJakartaSans-ExtraBold.ttf`, `assets/PlusJakartaSans.LICENSE.txt` и их тесты.

---

### Задача 1: Каркас проекта и машина стадий задачи

Перенос кода из `sub-bot`, вычистка субтитрового слоя и новая машина состояний. По итогам задачи `npm test` и `npm run build` проходят на урезанном дереве.

**Files:**
- Create: `dub-bot/**` (перенос из ветки `worktree-sub-bot`)
- Rewrite: `dub-bot/lib/jobs.ts`, `dub-bot/lib/cues.ts` (только типы), `dub-bot/lib/cleanup.ts`
- Test: `dub-bot/tests/jobs.test.ts`, `dub-bot/tests/cleanup.test.ts`

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces: `Job`, `JobStage`, `Cue`, `Word`, `saveJob`, `loadJob`, `listJobs`, `deleteBlob`, `jobPath`, `isActive`, `isExpired`, `isStale`, `WORK_DEADLINE_MS`, `STAGE_STALE_MS`, `JOBS_PREFIX`, `RESULTS_PREFIX`, `SOURCES_PREFIX`.

- [ ] **Шаг 1: Завести ветку и перенести дерево**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git checkout main
git checkout -b feat/dub-bot-v2
git rm -r --quiet dub-bot
git checkout worktree-sub-bot -- sub-bot
git mv sub-bot dub-bot
```

- [ ] **Шаг 2: Удалить субтитровый слой**

```bash
cd /Users/alanalmassuly/Desktop/qurany/dub-bot
git rm --quiet lib/ass.ts lib/textwidth.ts lib/render.ts lib/escape.ts lib/sacred.ts lib/probe.ts
git rm --quiet tests/ass.test.ts tests/textwidth.test.ts tests/render.test.ts tests/escape.test.ts tests/sacred.test.ts tests/probe.test.ts
git rm --quiet assets/PlusJakartaSans-ExtraBold.ttf assets/PlusJakartaSans.LICENSE.txt
git rm --quiet -r app/api/sub app/api/probe
git rm --quiet lib/pipeline.ts lib/deliver.ts lib/commands.ts lib/translate.ts lib/validate.ts
git rm --quiet tests/pipeline.test.ts tests/deliver.test.ts tests/commands.test.ts tests/translate.test.ts tests/validate.test.ts tests/cues.test.ts
git rm --quiet -r app/api/telegram
```

Роуты `app/api/telegram` и `app/api/sub` удаляются вместе с модулями, на которые опирались; они возвращаются в Задачах 7 и 8. Остаются рабочими `app/api/upload`, `app/api/cleanup` и страница загрузки.

- [ ] **Шаг 3: Переименовать префиксы окружения и имя проекта**

```bash
cd /Users/alanalmassuly/Desktop/qurany/dub-bot
grep -rl 'SUB_\|TELEGRAM_SUB_BOT_TOKEN\|sub-bot\|"sub/' lib app tests package.json \
  | xargs sed -i '' -e 's/TELEGRAM_SUB_BOT_TOKEN/TELEGRAM_DUB_BOT_TOKEN/g' \
                    -e 's/SUB_TOKEN_SECRET/DUB_TOKEN_SECRET/g' \
                    -e 's/SUB_BASE_URL/DUB_BASE_URL/g' \
                    -e 's/SUB_FFMPEG_PATH/DUB_FFMPEG_PATH/g' \
                    -e 's/SUB_FFPROBE_PATH/DUB_FFPROBE_PATH/g' \
                    -e 's/sub-bot/dub-bot/g'
sed -i '' -e 's/"name": "dub-bot"/"name": "dub-bot"/' package.json
```

Проверить глазами, что `SUB_FONT_PATH` в `lib/binaries.ts` исчез вместе с функцией `fontPath` (её удаляем следующим шагом), а `grep -rn 'SUB_' lib app tests` пуст.

- [ ] **Шаг 4: Вычистить шрифт из `lib/binaries.ts`**

Удалить функцию `fontPath` целиком (вместе с комментарием про Plus Jakarta Sans) и убрать `fontPath` из экспортов. Остальное — `FFMPEG_SHA256`, `ffmpegPath`, `ffprobePath`, `ffmpegHash`, `assertFfmpegHash`, `resolvePath` — не трогать.

`lib/media.ts` импортирует тип `Runner` из удалённого `./render` — переставить импорт на `./proc`:

```ts
import type { Runner } from "./proc";
```

`app/u/[token]/upload-form.tsx` шлёт задачу на старый адрес — заменить путь:

```bash
cd /Users/alanalmassuly/Desktop/qurany/dub-bot
grep -rl '/api/sub/start' app | xargs sed -i '' -e 's#/api/sub/start#/api/dub/start#g'
```

`lib/start.ts` собирает задачу по старой форме (`status`, `deliveringAt`) — привести к новой:

```ts
  const now = new Date().toISOString();
  const job: Job = {
    jobId: crypto.randomUUID(),
    chatId: claim.chatId,
    sourceUrl: input.blobUrl,
    resultUrl: null,
    // Первая стадия — измерение ролика; её выполняет уже конвейер.
    stage: "probing",
    durationSec: input.durationSec,
    cues: [],
    trimmedSec: 0,
    createdAt: now,
    stageAt: now,
    error: null,
  };
```

В `tests/start.test.ts` поправить ожидания под ту же форму: `status` → `stage: "probing"`, добавить `trimmedSec: 0` и `stageAt`.

Из `next.config.ts` убрать `./assets/**` для маршрутов и оставить только то, что реально нужно:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/probe": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
    ],
    "/api/dub/start": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
      "./assets/glossary.ru-id.json",
    ],
  },
};

export default nextConfig;
```

- [ ] **Шаг 5: Написать падающий тест на новую машину стадий**

Заменить `dub-bot/tests/jobs.test.ts` целиком:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
}));

import type { Job } from "../lib/jobs";

const { isActive, isExpired, isStale, jobPath, WORK_DEADLINE_MS, STAGE_STALE_MS } =
  await import("../lib/jobs");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    stage: "transcribing",
    durationSec: 58.4,
    cues: [],
    trimmedSec: 0,
    createdAt: "2026-08-21T00:00:00.000Z",
    stageAt: "2026-08-21T00:00:00.000Z",
    error: null,
    ...overrides,
  };
}

describe("jobs", () => {
  it("кладёт задачу в префикс dub/jobs/", () => {
    expect(jobPath("abc")).toBe("dub/jobs/abc.json");
  });

  it("считает активной любую стадию, кроме done и failed", () => {
    expect(isActive(makeJob({ stage: "synthesizing" }))).toBe(true);
    expect(isActive(makeJob({ stage: "delivering" }))).toBe(true);
    expect(isActive(makeJob({ stage: "done" }))).toBe(false);
    expect(isActive(makeJob({ stage: "failed" }))).toBe(false);
  });

  it("просрочивает активную задачу через WORK_DEADLINE_MS", () => {
    const base = Date.parse("2026-08-21T00:00:00.000Z");
    const job = makeJob();
    expect(isExpired(job, base + WORK_DEADLINE_MS - 1)).toBe(false);
    expect(isExpired(job, base + WORK_DEADLINE_MS + 1)).toBe(true);
  });

  it("не просрочивает закрытую задачу, сколько бы ни прошло", () => {
    const base = Date.parse("2026-08-21T00:00:00.000Z");
    expect(isExpired(makeJob({ stage: "done" }), base + WORK_DEADLINE_MS * 10)).toBe(false);
  });

  it("считает стадию брошенной через STAGE_STALE_MS от stageAt, а не от createdAt", () => {
    const job = makeJob({
      createdAt: "2026-08-21T00:00:00.000Z",
      stageAt: "2026-08-21T00:20:00.000Z",
    });
    const stageStart = Date.parse("2026-08-21T00:20:00.000Z");
    expect(isStale(job, stageStart + STAGE_STALE_MS - 1)).toBe(false);
    expect(isStale(job, stageStart + STAGE_STALE_MS + 1)).toBe(true);
  });
});
```

- [ ] **Шаг 6: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/jobs.test.ts`
Expected: FAIL — `isStale` не экспортируется, поля `stage`/`stageAt`/`trimmedSec` в типе `Job` отсутствуют.

- [ ] **Шаг 7: Переписать типы в `lib/cues.ts`**

Файл на этом шаге содержит ТОЛЬКО типы — логику нарезки добавляет Задача 2. Так `lib/jobs.ts` компилируется, не таща за собой `lib/textwidth.ts`.

```ts
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  /** Номер реплики, с единицы. */
  i: number;
  /** Начало русской речи в исходном ролике, секунды. */
  start: number;
  /** Конец русской речи в исходном ролике, секунды. */
  end: number;
  ru: string;
  /** Перевод на бахасу; null до вызова переводчика. */
  id: string | null;
  /** Коэффициент ускорения синтезированной реплики, 1 — без ускорения. */
  tempo: number;
  /** Фактическое время начала реплики в собранной дорожке, секунды. */
  offset: number;
  /** Замечание валидатора терминологии; null — замечаний нет. */
  warning: string | null;
}
```

- [ ] **Шаг 8: Переписать `lib/jobs.ts`**

Меняются только машина стадий и префиксы. Функции работы с Blob (`saveJob`, `readJob`, `loadJob`, `listJobs`, `deleteBlob`) переносятся из старого файла дословно — там же остаётся приём с `?ts=` против кэша CDN.

```ts
import { del, list, put } from "@vercel/blob";
import { Cue } from "./cues";

// Конвейер задачи. Отдельная стадия "delivering" нужна, чтобы параллельный
// вызов не отправил тот же ролик ещё раз.
export type JobStage =
  | "probing"
  | "transcribing"
  | "translating"
  | "synthesizing"
  | "mixing"
  | "delivering"
  | "done"
  | "failed";

export interface Job {
  jobId: string;
  chatId: number;
  sourceUrl: string;
  resultUrl: string | null;
  stage: JobStage;
  /** Длительность по ffprobe; ноль — пока не измеряли. */
  durationSec: number;
  cues: Cue[];
  /** Сколько секунд озвучки не влезло в ролик и обрезано. */
  trimmedSec: number;
  createdAt: string;
  /**
   * Когда началась текущая стадия (ISO). Blob не умеет compare-and-set,
   * поэтому перехват брошенной работы строится на давности стадии, а не на
   * флаге: вызов функции умирает молча, и без этой отметки задача осталась бы
   * в рабочей стадии навсегда.
   */
  stageAt: string;
  error: string | null;
}

export const JOBS_PREFIX = "dub/jobs/";
export const RESULTS_PREFIX = "dub/results/";
export const SOURCES_PREFIX = "dub/sources/";

export function jobPath(jobId: string): string {
  return `${JOBS_PREFIX}${jobId}.json`;
}

// Вся работа машинная, ждать человека не приходится — дедлайн один на все
// стадии, в отличие от субтитрового бота, где "awaiting" ждал правки руками.
export const WORK_DEADLINE_MS = 30 * 60 * 1000;
// Порог, после которого стадию считаем брошенной и можно перехватить.
export const STAGE_STALE_MS = 5 * 60 * 1000;

export function isActive(job: Job): boolean {
  return job.stage !== "done" && job.stage !== "failed";
}

export function isExpired(job: Job, nowMs: number): boolean {
  if (!isActive(job)) return false;
  return nowMs - Date.parse(job.createdAt) > WORK_DEADLINE_MS;
}

export function isStale(job: Job, nowMs: number): boolean {
  if (!isActive(job)) return false;
  return nowMs - Date.parse(job.stageAt) > STAGE_STALE_MS;
}

// Переход в новую стадию всегда обновляет stageAt — иначе перехват брошенной
// работы считал бы давность от входа в ПЕРВУЮ стадию задачи.
export function toStage(job: Job, stage: JobStage): Job {
  return { ...job, stage, stageAt: new Date().toISOString() };
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
// иначе следующий вызов увидит устаревшую стадию задачи.
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

- [ ] **Шаг 9: Починить `lib/cleanup.ts` под новые стадии**

Три правки, остальное дословно как было:

1. В `hungJobs` комментарий про суточный «awaiting» больше не верен — заменить на: `// Дедлайн один на все стадии: ждать человека конвейеру не приходится.`
2. `saveJob({ ...job, status: "failed", ... })` → `saveJob({ ...job, stage: "failed", ... })`.
3. Текст `HUNG_JOB_MESSAGE`: `/sub` → `/dub`.

- [ ] **Шаг 10: Починить `tests/cleanup.test.ts`**

В фабрике задачи заменить `status:` на `stage:`, добавить поля `trimmedSec: 0` и `stageAt`. Тест на суточный дедлайн «awaiting», если он там есть, удалить — такой стадии больше нет.

- [ ] **Шаг 11: Прогнать все тесты**

Run: `cd dub-bot && npm test`
Expected: PASS. Живыми остаются `binaries`, `cleanup`, `glossary`, `jobs`, `media`, `proc`, `scribe`, `start`, `storage`, `telegram`, `tokens`, `upload-form`.

- [ ] **Шаг 12: Проверить сборку**

Run: `cd dub-bot && npm run build`
Expected: сборка проходит. Маршруты в выводе: `/api/upload`, `/api/cleanup`, `/u/[token]`.

- [ ] **Шаг 13: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add -A dub-bot
git commit -m "feat(dub-bot): каркас из sub-bot без субтитрового слоя

Стадии задачи стали машинными целиком: ожидания правки руками больше нет,
поэтому дедлайн один на все стадии, а давность считается от stageAt —
иначе перехват брошенной работы мерил бы время от создания задачи."
```

---

### Задача 2: Нарезка реплик и длина слота

Границы реплик режутся по паузам и концам предложений. Вся субтитровая машинерия — потолок длительности, растяжка до минимума, зазор между блоками, переносы строк — выброшена: тайминг обязан остаться честным, потому что по нему кладётся звук.

**Files:**
- Modify: `dub-bot/lib/cues.ts`
- Test: `dub-bot/tests/cues.test.ts`

**Interfaces:**
- Consumes: `Word`, `Cue` из Задачи 1.
- Produces: `buildCues(words: Word[]): Cue[]`, `slotFor(cues: Cue[], index: number, videoDurSec: number): number`, `PAUSE_BREAK_SEC`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `dub-bot/tests/cues.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCues, slotFor, PAUSE_BREAK_SEC } from "../lib/cues";
import type { Word } from "../lib/cues";

function w(text: string, start: number, end: number): Word {
  return { text, start, end };
}

describe("buildCues", () => {
  it("на пустом списке слов не даёт реплик", () => {
    expect(buildCues([])).toEqual([]);
  });

  it("режет реплику по паузе не короче порога", () => {
    const cues = buildCues([
      w("привет", 0, 0.5),
      w("друзья", 0.5, 1.0),
      w("сегодня", 1.0 + PAUSE_BREAK_SEC, 1.8),
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0].ru).toBe("привет друзья");
    expect(cues[1].ru).toBe("сегодня");
  });

  it("не режет по паузе короче порога", () => {
    const cues = buildCues([
      w("привет", 0, 0.5),
      w("друзья", 0.5 + PAUSE_BREAK_SEC - 0.01, 1.0),
    ]);
    expect(cues).toHaveLength(1);
  });

  it("режет по концу предложения даже без паузы", () => {
    const cues = buildCues([w("едем.", 0, 0.5), w("дальше", 0.5, 1.0)]);
    expect(cues).toHaveLength(2);
  });

  it("берёт границы реплики от первого и последнего слова", () => {
    const cues = buildCues([w("раз", 1.25, 1.6), w("два", 1.7, 2.4)]);
    expect(cues[0].start).toBeCloseTo(1.25);
    expect(cues[0].end).toBeCloseTo(2.4);
  });

  it("нумерует реплики с единицы и ставит нейтральные значения полей", () => {
    const cues = buildCues([w("раз", 0, 0.4), w("два", 1.0, 1.4)]);
    expect(cues.map((c) => c.i)).toEqual([1, 2]);
    expect(cues[0].id).toBeNull();
    expect(cues[0].warning).toBeNull();
    expect(cues[0].tempo).toBe(1);
    expect(cues[0].offset).toBeCloseTo(0);
  });
});

describe("slotFor", () => {
  const cues = buildCues([
    w("раз", 0, 0.5),
    w("два", 2.0, 2.5),
  ]);

  it("даёт реплике всё время до начала следующей, включая паузу", () => {
    expect(slotFor(cues, 0, 10)).toBeCloseTo(2.0);
  });

  it("последней реплике даёт время до конца ролика", () => {
    expect(slotFor(cues, 1, 10)).toBeCloseTo(8.0);
  });

  it("не даёт отрицательный слот, если ролик короче речи", () => {
    expect(slotFor(cues, 1, 1.0)).toBe(0);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/cues.test.ts`
Expected: FAIL — `buildCues` и `slotFor` не экспортируются.

- [ ] **Шаг 3: Дописать логику в `lib/cues.ts`**

Добавить ниже типов из Задачи 1:

```ts
export const PAUSE_BREAK_SEC = 0.3;

const SENTENCE_END = /[.!?…]$/;

// Границы реплик — по паузам и концам предложений, и только. Потолок
// длительности здесь сознательно не проверяется, в отличие от субтитрового
// бота: там блок резали, чтобы человек успел прочитать, здесь единственный
// потребитель тайминга — синтезатор, и длинная реплика ему только на пользу
// (одна интонационная дуга вместо трёх обрубков).
export function buildCues(words: Word[]): Cue[] {
  if (words.length === 0) return [];

  const groups: Word[][] = [];
  let current: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const next = words[i + 1];
    if (!next) break;

    const pause = next.start - words[i].end;
    if (pause >= PAUSE_BREAK_SEC || SENTENCE_END.test(words[i].text)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups.map((g, idx) => ({
    i: idx + 1,
    start: g[0].start,
    end: g[g.length - 1].end,
    ru: g.map((x) => x.text).join(" "),
    id: null,
    tempo: 1,
    offset: g[0].start,
    warning: null,
  }));
}

// Слот реплики — время до начала СЛЕДУЮЩЕЙ реплики, а не до конца своей
// речи. Пауза между фразами принадлежит предыдущей реплике: индонезийский
// текст длиннее русского, и эта тишина — первый и самый дешёвый резерв, куда
// он может вылезти, не требуя ни сокращения, ни ускорения.
export function slotFor(cues: Cue[], index: number, videoDurSec: number): number {
  const next = cues[index + 1];
  const boundary = next ? next.start : videoDurSec;
  return Math.max(0, boundary - cues[index].start);
}
```

- [ ] **Шаг 4: Прогнать тест**

Run: `cd dub-bot && npx vitest run tests/cues.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/cues.ts dub-bot/tests/cues.test.ts
git commit -m "feat(dub-bot): нарезка реплик по паузам и длина слота

Слот реплики тянется до начала следующей, а не до конца своей речи: пауза
между фразами — бесплатный резерв под индонезийский текст, который длиннее
русского. Читательских ограничений субтитров здесь нет — тайминг обязан
остаться честным, по нему кладётся звук."
```

---

### Задача 3: Укладка — бюджет знаков, темп, раскладка по времени

Три ступени укладки из спеки, целиком чистыми функциями: ни сети, ни файлов, ни ffmpeg. Самая содержательная арифметика проекта живёт здесь и тестируется без единого мока.

**Files:**
- Create: `dub-bot/lib/fit.ts`
- Test: `dub-bot/tests/fit.test.ts`

**Interfaces:**
- Consumes: ничего (чистая арифметика).
- Produces: `CHARS_PER_SEC`, `MAX_TEMPO`, `charBudget(slotSec: number): number`, `tempoFor(actualSec: number, slotSec: number): number`, `layout(items: LayoutItem[], videoDurSec: number): LayoutResult`, типы `LayoutItem { i: number; start: number; actualSec: number; slotSec: number }`, `Placed { i: number; offset: number; durSec: number; tempo: number }`, `LayoutResult { placed: Placed[]; trimmedSec: number }`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `dub-bot/tests/fit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { charBudget, tempoFor, layout, CHARS_PER_SEC, MAX_TEMPO } from "../lib/fit";

describe("charBudget", () => {
  it("считает бюджет знаков от длины слота", () => {
    expect(charBudget(4)).toBe(4 * CHARS_PER_SEC);
  });

  it("округляет вниз — лучше недобрать знаков, чем не влезть", () => {
    expect(charBudget(2.9)).toBe(Math.floor(2.9 * CHARS_PER_SEC));
  });

  it("никогда не даёт ноль: пустой бюджет модель понять не сможет", () => {
    expect(charBudget(0)).toBe(1);
    expect(charBudget(-5)).toBe(1);
  });
});

describe("tempoFor", () => {
  it("не ускоряет реплику, которая и так влезла", () => {
    expect(tempoFor(2.0, 3.0)).toBe(1);
    expect(tempoFor(3.0, 3.0)).toBe(1);
  });

  it("ускоряет ровно во столько раз, во сколько реплика длиннее слота", () => {
    expect(tempoFor(3.3, 3.0)).toBeCloseTo(1.1);
  });

  it("упирается в потолок ускорения, а не тараторит без предела", () => {
    expect(tempoFor(6.0, 3.0)).toBe(MAX_TEMPO);
  });

  it("не делит на ноль на пустом слоте", () => {
    expect(tempoFor(2.0, 0)).toBe(1);
  });
});

describe("layout", () => {
  it("на пустом списке даёт пустую раскладку без обрезки", () => {
    expect(layout([], 60)).toEqual({ placed: [], trimmedSec: 0 });
  });

  it("ставит реплики на их собственное время, пока они влезают", () => {
    const { placed, trimmedSec } = layout(
      [
        { i: 1, start: 0, actualSec: 1.5, slotSec: 2 },
        { i: 2, start: 2, actualSec: 1.0, slotSec: 3 },
      ],
      10
    );
    expect(placed[0].offset).toBeCloseTo(0);
    expect(placed[1].offset).toBeCloseTo(2);
    expect(placed.every((p) => p.tempo === 1)).toBe(true);
    expect(trimmedSec).toBe(0);
  });

  it("сокращает длительность ускоренной реплики", () => {
    const { placed } = layout([{ i: 1, start: 0, actualSec: 3.3, slotSec: 3 }], 10);
    expect(placed[0].tempo).toBeCloseTo(1.1);
    expect(placed[0].durSec).toBeCloseTo(3.0);
  });

  it("сдвигает следующую реплику, если предыдущая не влезла даже после ускорения", () => {
    // Реплика вдвое длиннее слота: ускорение до 1.15 оставляет хвост.
    const { placed } = layout(
      [
        { i: 1, start: 0, actualSec: 6, slotSec: 3 },
        { i: 2, start: 3, actualSec: 1, slotSec: 5 },
      ],
      20
    );
    const firstEnd = placed[0].offset + placed[0].durSec;
    expect(firstEnd).toBeGreaterThan(3);
    expect(placed[1].offset).toBeCloseTo(firstEnd);
  });

  it("не подтягивает реплику раньше её собственного времени", () => {
    const { placed } = layout(
      [
        { i: 1, start: 0, actualSec: 0.5, slotSec: 5 },
        { i: 2, start: 5, actualSec: 1, slotSec: 5 },
      ],
      20
    );
    expect(placed[1].offset).toBeCloseTo(5);
  });

  it("считает, сколько секунд озвучки вылезло за конец ролика", () => {
    const { trimmedSec } = layout([{ i: 1, start: 9, actualSec: 2, slotSec: 1 }], 10);
    // 2 с при слоте 1 с: ускорение упирается в 1.15 → длительность 2/1.15 ≈ 1.739,
    // конец 9 + 1.739 = 10.739 при ролике 10 с.
    expect(trimmedSec).toBeCloseTo(0.739, 2);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/fit.test.ts`
Expected: FAIL — `Cannot find module '../lib/fit'`.

- [ ] **Шаг 3: Написать `lib/fit.ts`**

```ts
// Темп индонезийской синтетической речи, знаков в секунду. Величина оценочная
// и подлежит калибровке на первом смоуке (Задача 10): берём десяток
// реальных реплик, делим длину текста на измеренную длительность. Пока
// не откалибровано — это единственное место, где цифру надо править.
export const CHARS_PER_SEC = 15;

// Потолок ускорения. За ним ускорение перестаёт быть незаметным и начинает
// слышаться как спешка, что для дакватского ролика хуже, чем сдвиг хвоста.
export const MAX_TEMPO = 1.15;

export interface LayoutItem {
  i: number;
  /** Время начала реплики в оригинале, секунды. */
  start: number;
  /** Измеренная длительность синтезированного файла, секунды. */
  actualSec: number;
  /** Сколько времени у реплики есть до начала следующей, секунды. */
  slotSec: number;
}

export interface Placed {
  i: number;
  /** Фактическое время начала в собранной дорожке, секунды. */
  offset: number;
  /** Длительность после ускорения, секунды. */
  durSec: number;
  tempo: number;
}

export interface LayoutResult {
  placed: Placed[];
  /** Сколько секунд озвучки вылезло за конец ролика и будет обрезано. */
  trimmedSec: number;
}

// Ступень 1: сколько знаков перевода помещается в слот. Округление ВНИЗ и
// пол в единицу: нулевой бюджет модель прочтёт как «верни пустую строку», а
// пустая реплика — это дыра в озвучке, которую нечем объяснить пользователю.
export function charBudget(slotSec: number): number {
  return Math.max(1, Math.floor(slotSec * CHARS_PER_SEC));
}

// Ступень 2: во сколько раз ускорить готовый файл, чтобы он влез в слот.
// Повторный синтез с voice_settings.speed дал бы результат чище, но стоит
// вторых денег за ту же реплику — см. спеку.
export function tempoFor(actualSec: number, slotSec: number): number {
  if (slotSec <= 0) return 1;
  if (actualSec <= slotSec) return 1;
  return Math.min(actualSec / slotSec, MAX_TEMPO);
}

// Ступень 3: раскладка по времени. Реплика встаёт на своё место в оригинале,
// но не раньше конца предыдущей — иначе две озвучки наложились бы друг на
// друга и обе стали бы неразборчивы. Курсор монотонно растёт, поэтому самый
// поздний конец всегда у последней реплики: только её хвост и может вылезти
// за ролик.
export function layout(items: LayoutItem[], videoDurSec: number): LayoutResult {
  const placed: Placed[] = [];
  let cursor = 0;

  for (const item of items) {
    const tempo = tempoFor(item.actualSec, item.slotSec);
    const durSec = item.actualSec / tempo;
    const offset = Math.max(item.start, cursor);
    placed.push({ i: item.i, offset, durSec, tempo });
    cursor = offset + durSec;
  }

  const trimmedSec = placed.length === 0 ? 0 : Math.max(0, cursor - videoDurSec);
  return { placed, trimmedSec };
}
```

- [ ] **Шаг 4: Прогнать тест**

Run: `cd dub-bot && npx vitest run tests/fit.test.ts`
Expected: PASS, 13 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/fit.ts dub-bot/tests/fit.test.ts
git commit -m "feat(dub-bot): укладка перевода в тайминг тремя ступенями

Бюджет знаков округляется вниз и не опускается до нуля: пустой бюджет
модель понимает как «верни пустую строку», а дыру в озвучке пользователю
объяснить нечем. Реплика не встаёт раньше конца предыдущей — наложение
двух озвучек делает неразборчивыми обе."
```

---

### Задача 4: Перевод с бюджетом знаков и проверка терминологии

`validate.ts` теряет всю геометрию кадра (она была про субтитры) и остаётся проверкой терминологии. `translate.ts` теряет детектор сакрального и получает бюджет знаков на реплику плюс один повтор при расхождении числа реплик.

**Files:**
- Create: `dub-bot/lib/validate.ts`, `dub-bot/lib/translate.ts`
- Test: `dub-bot/tests/validate.test.ts`, `dub-bot/tests/translate.test.ts`

**Interfaces:**
- Consumes: `Cue` (Задача 1), `Entry`, `loadGlossary`, `relevant` (`lib/glossary.ts`, перенос), `charBudget` (Задача 3).
- Produces: `validateCue(cue: Cue, entries: Entry[]): string | null`, `validateSpelling(cues: Cue[]): string | null`, `translateCues(apiKey: string, cues: Cue[], budgetFor: (cue: Cue, index: number) => number): Promise<Cue[]>`.

- [ ] **Шаг 1: Написать падающий тест на валидатор**

Создать `dub-bot/tests/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateCue, validateSpelling } from "../lib/validate";
import type { Cue } from "../lib/cues";
import type { Entry } from "../lib/glossary";

const ENTRIES: Entry[] = [
  { ru: ["дуа", "мольба"], id: "doa", forbidden: ["dua"], note: "dua по-индонезийски значит «два»" },
  { ru: ["намаз"], id: "salat", forbidden: [] },
];

function cue(ru: string, id: string | null): Cue {
  return { i: 1, start: 0, end: 2, ru, id, tempo: 1, offset: 0, warning: null };
}

describe("validateCue", () => {
  it("молчит, пока перевода нет", () => {
    expect(validateCue(cue("прочитай дуа", null), ENTRIES)).toBeNull();
  });

  it("ловит запрещённый вариант термина", () => {
    const msg = validateCue(cue("прочитай дуа", "bacalah dua ini"), ENTRIES);
    expect(msg).toContain("dua");
  });

  it("принимает термин в аффиксированной форме", () => {
    expect(validateCue(cue("прочитай дуа", "berdoalah setelah salat"), ENTRIES)).toBeNull();
  });

  it("замечает пропажу термина в переводе", () => {
    const msg = validateCue(cue("прочитай дуа", "bacalah ini"), ENTRIES);
    expect(msg).toContain("doa");
  });

  it("требует SAW после упоминания Пророка", () => {
    const msg = validateCue(cue("Пророк сказал", "Nabi bersabda"), ENTRIES);
    expect(msg).toContain("SAW");
  });

  it("не считает строчное saw салляватом", () => {
    const msg = validateCue(cue("Пророк сказал", "Nabi bersabda saw"), ENTRIES);
    expect(msg).toContain("SAW");
  });

  it("не проверяет ширину строки — геометрия кадра к озвучке отношения не имеет", () => {
    const long = "Menyampaikan keberkahan kepada seluruh keluarga dan sahabat yang hadir";
    expect(validateCue(cue("длинная фраза", long), [])).toBeNull();
  });
});

describe("validateSpelling", () => {
  it("ловит два режима написания в одном ролике", () => {
    const msg = validateSpelling([cue("а", "sholat subuh"), { ...cue("б", "salat isya"), i: 2 }]);
    expect(msg).toContain("sholat");
  });

  it("молчит, когда режим один", () => {
    expect(validateSpelling([cue("а", "salat subuh"), { ...cue("б", "salat isya"), i: 2 }])).toBeNull();
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/validate.test.ts`
Expected: FAIL — `Cannot find module '../lib/validate'`.

- [ ] **Шаг 3: Написать `lib/validate.ts`**

Файл собирается из старого субтитрового `validate.ts` (ветка `worktree-sub-bot`, `sub-bot/lib/validate.ts`) вычитанием: функции `normalize`, `tokenize`, `matchesRoot`, `containsTerm`, `containsWord`, `escapeRe`, константа `PROROK_RE`, список `SPELLING_PAIRS` и `validateSpelling` переносятся ДОСЛОВНО вместе со всеми комментариями — там разобраны неочевидные грабли (граница слова по юникоду, редупликация `ayat-ayat`, слитное `Alquran`), и переписывать их заново значит наступить на них снова.

Меняется только `validateCue` — из неё уходят проверка геометрии (`fitLines`, `measureWidth`, `LINE_MAX_PX`, `SUBTITLE_FONTSIZE`) и проверка скорости чтения (`MAX_CPS`), а вместе с ними импорты из `./cues` и `./textwidth`:

```ts
import { Cue } from "./cues";
import { Entry, relevant } from "./glossary";

// ... сюда дословно: normalize, tokenize, PREFIXES, SUFFIXES, matchesRoot,
// containsTerm, containsWord, escapeRe, PROROK_RE — из sub-bot/lib/validate.ts

// Геометрия кадра и скорость чтения из проверок ушли вместе с субтитрами:
// ширина строки в пикселях и знаки в секунду — это про глаз, а озвучку
// слушают. Осталась терминология, которая от способа подачи не зависит.
export function validateCue(cue: Cue, entries: Entry[]): string | null {
  const id = cue.id;
  if (!id || id.trim().length === 0) return null;

  for (const e of relevant(entries, cue.ru)) {
    for (const bad of e.forbidden) {
      if (containsWord(id, bad)) {
        return `запрещённый вариант «${bad}»${e.note ? ` — ${e.note}` : ""}`;
      }
    }
    if (!containsTerm(id, e.id)) {
      return `в источнике есть «${e.ru[0]}», в переводе нет «${e.id}»`;
    }
  }

  // Проверка SAW регистрочувствительна намеренно: строчное "saw" — обычное
  // индонезийское слово, не салляват.
  if (PROROK_RE.test(cue.ru) && !/\bSAW\b/.test(id)) {
    return "упомянут Пророк, но нет SAW";
  }
  return null;
}

// ... сюда дословно: SPELLING_PAIRS и validateSpelling — из sub-bot/lib/validate.ts
```

- [ ] **Шаг 4: Прогнать тест валидатора**

Run: `cd dub-bot && npx vitest run tests/validate.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Шаг 5: Написать падающий тест на переводчик**

Создать `dub-bot/tests/translate.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { translateCues } from "../lib/translate";
import type { Cue } from "../lib/cues";

function cue(i: number, ru: string): Cue {
  return { i, start: i, end: i + 1, ru, id: null, tempo: 1, offset: i, warning: null };
}

function reply(items: { i: number; id: string }[], finishReason = "stop") {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ items }) }, finish_reason: finishReason }],
    }),
    text: async () => "",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translateCues", () => {
  it("кладёт бюджет знаков в запрос по каждой реплике", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply([{ i: 1, id: "halo" }]));
    vi.stubGlobal("fetch", fetchMock);

    await translateCues("key", [cue(1, "привет")], () => 37);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const sent = JSON.parse(body.messages[1].content) as { items: { i: number; max: number }[] };
    expect(sent.items[0].max).toBe(37);
  });

  it("проставляет перевод по номеру реплики", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([
      { i: 1, id: "satu" },
      { i: 2, id: "dua puluh" },
    ])));

    const out = await translateCues("key", [cue(1, "раз"), cue(2, "два")], () => 40);
    expect(out.map((c) => c.id)).toEqual(["satu", "dua puluh"]);
  });

  it("повторяет запрос один раз, если число реплик не совпало", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply([{ i: 1, id: "satu" }]))
      .mockResolvedValueOnce(reply([{ i: 1, id: "satu" }, { i: 2, id: "dua" }]));
    vi.stubGlobal("fetch", fetchMock);

    const out = await translateCues("key", [cue(1, "раз"), cue(2, "два")], () => 40);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.map((c) => c.id)).toEqual(["satu", "dua"]);
  });

  it("сдаётся после второй неудачной попытки, назвав обе цифры", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([{ i: 1, id: "satu" }])));

    await expect(
      translateCues("key", [cue(1, "раз"), cue(2, "два")], () => 40)
    ).rejects.toThrow(/отправлено 2, получено 1/);
  });

  it("отличает отказ модерации от сетевой ошибки", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([], "content_filter")));

    await expect(translateCues("key", [cue(1, "раз")], () => 40)).rejects.toThrow(/модерации/);
  });

  it("не ходит в сеть, когда реплик нет", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await translateCues("key", [], () => 40)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Шаг 6: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/translate.test.ts`
Expected: FAIL — `Cannot find module '../lib/translate'`.

- [ ] **Шаг 7: Написать `lib/translate.ts`**

```ts
import { Cue } from "./cues";
import { loadGlossary, relevant, Entry } from "./glossary";
import { validateCue, validateSpelling } from "./validate";

const MODEL = "gpt-5.1";
const ATTEMPTS = 2;

// Только записи, реально встретившиеся хоть в одной реплике ролика — 5–15
// штук вместо всех тридцати: гигантский словарь модель начинает игнорировать.
function pickRelevantEntries(entries: Entry[], cues: Cue[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const c of cues) {
    for (const e of relevant(entries, c.ru)) byId.set(e.id, e);
  }
  return [...byId.values()];
}

function systemPrompt(entries: Entry[]): string {
  // Поле forbidden проговаривается текстом явно: модель надёжнее избегает
  // названного запрета, чем угадывает его — "dua" вместо "doa" это "два"
  // вместо "мольбы".
  const terms = entries
    .map(
      (e) =>
        `- «${e.ru[0]}» → ${e.id}${
          e.forbidden.length ? `; НИКОГДА не ${e.forbidden.join(", ")}` : ""
        }${e.note ? ` (${e.note})` : ""}`
    )
    .join("\n");

  return [
    "Ты переводишь озвучку исламского просветительского ролика с русского на индонезийский (Bahasa Indonesia).",
    "",
    "Правила:",
    // Бюджет знаков — не косметика: реплику озвучивают в отведённый ей слот
    // видео, и перебор превращается либо в спешку, либо в обрезанный хвост.
    "1. У каждой реплики есть поле max — потолок длины перевода в знаках. Не превышай его. Лучше сказать короче и проще, чем не уложиться.",
    "2. Верни ровно столько элементов, сколько получил, с теми же номерами i. Не объединяй и не дроби реплики.",
    "3. Регистр — обращение на «kamu», разговорный, как в дакватских роликах.",
    "4. Соблюдай глоссарий буквально.",
    "5. После имени Пророка обязательно ставь SAW.",
    "6. Пиши текст для произнесения вслух: цифры и сокращения — словами.",
    "",
    terms ? `Глоссарий:\n${terms}` : "Глоссарий: терминов в этом ролике нет.",
  ].join("\n");
}

// Орфографический режим общий на весь ролик: "sholat" и "salat" вместе в
// одном ролике — ошибка, даже если каждая реплика по отдельности чиста.
// Сообщение вешается на первую реплику, у которой ещё нет своего warning;
// если свободной нет — дописывается к первой через разделитель, а не теряется.
function applySpellingWarning(cues: Cue[]): Cue[] {
  const message = validateSpelling(cues);
  if (!message) return cues;

  const freeIndex = cues.findIndex((c) => c.warning === null);
  if (freeIndex !== -1) {
    return cues.map((c, idx) => (idx === freeIndex ? { ...c, warning: message } : c));
  }
  return cues.map((c, idx) => (idx === 0 ? { ...c, warning: `${c.warning}; ${message}` } : c));
}

async function requestTranslation(
  apiKey: string,
  cues: Cue[],
  budgetFor: (cue: Cue, index: number) => number,
  entries: Entry[]
): Promise<Map<number, string>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt(entries) },
        {
          role: "user",
          content: JSON.stringify({
            items: cues.map((c, idx) => ({ i: c.i, ru: c.ru, max: budgetFor(c, idx) })),
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "dubbing",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["i", "id"],
                  properties: { i: { type: "integer" }, id: { type: "string" } },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Переводчик вернул ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    choices: { message: { content: string }; finish_reason?: string }[];
  };

  // Ответ 200 с пустым или отфильтрованным choices — рабочий сценарий на
  // исламском просветительском контенте, а не экзотика. Три причины
  // различимы намеренно: "отказала модерация" и "ответ обрезался" требуют
  // разных действий от человека.
  if (!body.choices || body.choices.length === 0) {
    throw new Error("Переводчик вернул пустой ответ без choices — повтори запрос");
  }
  const choice = body.choices[0];
  if (choice.finish_reason === "content_filter") {
    throw new Error(
      "Модель отказалась переводить по модерации — дело в содержании ролика, а не в ключе или сети."
    );
  }
  if (choice.finish_reason === "length") {
    throw new Error(
      "Ответ модели обрезан по лимиту длины (finish_reason: length) — в ролике слишком много реплик за один вызов."
    );
  }

  const parsed = JSON.parse(choice.message.content) as { items: { i: number; id: string }[] };

  // Расхождение числа элементов означает, что перевод разъехался с таймингом
  // (тайминг привязан к границам русских реплик). Подгонкой это не чинится.
  if (parsed.items.length !== cues.length) {
    throw new Error(
      `перевод не совпал по числу реплик: отправлено ${cues.length}, получено ${parsed.items.length}`
    );
  }

  return new Map(parsed.items.map((x) => [x.i, x.id]));
}

// Один повтор при расхождении числа реплик: это единственная ошибка модели,
// которая лечится буквально повторным броском кубика. Ошибки сети, ключа и
// модерации повторять бессмысленно — они прилетят снова, только позже.
export async function translateCues(
  apiKey: string,
  cues: Cue[],
  budgetFor: (cue: Cue, index: number) => number
): Promise<Cue[]> {
  if (cues.length === 0) return [];

  const entries = loadGlossary();
  const relevantEntries = pickRelevantEntries(entries, cues);

  let byIndex: Map<number, string> | null = null;
  let lastMismatch: Error | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      byIndex = await requestTranslation(apiKey, cues, budgetFor, relevantEntries);
      break;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!/не совпал по числу реплик/.test(err.message)) throw err;
      lastMismatch = err;
    }
  }
  if (!byIndex) throw lastMismatch ?? new Error("перевод не получен");

  const translated = cues.map((c) => {
    const id = byIndex.get(c.i);
    // Число элементов совпало, но конкретный номер отсутствует — модель
    // перепутала i. Реплика остаётся без перевода и получает замечание, а не
    // молча уезжает с id: null дальше по конвейеру.
    if (id === undefined) {
      return { ...c, id: null, warning: "перевод этой реплики не вернулся" };
    }
    const withId = { ...c, id };
    return { ...withId, warning: validateCue(withId, entries) };
  });

  return applySpellingWarning(translated);
}
```

- [ ] **Шаг 8: Прогнать тест переводчика**

Run: `cd dub-bot && npx vitest run tests/translate.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Шаг 9: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/validate.ts dub-bot/lib/translate.ts dub-bot/tests/validate.test.ts dub-bot/tests/translate.test.ts
git commit -m "feat(dub-bot): перевод с бюджетом знаков и проверка терминологии

Бюджет уходит в запрос отдельным полем max на каждую реплику: слот видео
не растягивается, и перебор превращается в спешку или обрезанный хвост.
Повтор ровно один и только на расхождении числа реплик — эта ошибка
лечится повторным броском кубика, а отказ модерации или ключа не лечится."
```

---

### Задача 5: Синтез речи

Обращение к ElevenLabs TTS и пул параллелизма. Соседние реплики уходят в запрос контекстом: кредитов это не стоит, а стык между репликами перестаёт звучать как склейка разных дублей.

**Files:**
- Create: `dub-bot/lib/tts.ts`
- Test: `dub-bot/tests/tts.test.ts`

**Interfaces:**
- Consumes: `Cue` (Задача 1).
- Produces: `TTS_MODEL`, `synthesize(apiKey: string, voiceId: string, input: SynthInput): Promise<Uint8Array>`, `neighborTexts(cues: Cue[], index: number): { prev: string | null; next: string | null }`, `mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`, тип `SynthInput { text: string; prev: string | null; next: string | null }`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `dub-bot/tests/tts.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesize, neighborTexts, mapWithLimit, TTS_MODEL } from "../lib/tts";
import type { Cue } from "../lib/cues";

function cue(i: number, id: string | null): Cue {
  return { i, start: i, end: i + 1, ru: "русский", id, tempo: 1, offset: i, warning: null };
}

function audioReply(bytes: number[]) {
  return {
    ok: true,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    text: async () => "",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("synthesize", () => {
  it("зовёт голос по идентификатору и просит mp3", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioReply([1, 2, 3]));
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await synthesize("key", "voice-42", { text: "halo", prev: null, next: null });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/text-to-speech/voice-42");
    expect(url).toContain("output_format=mp3_44100_128");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("передаёт ключ, модель и язык явно", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioReply([0]));
    vi.stubGlobal("fetch", fetchMock);

    await synthesize("key", "voice-42", { text: "halo", prev: null, next: null });

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers["xi-api-key"]).toBe("key");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.model_id).toBe(TTS_MODEL);
    expect(body.language_code).toBe("id");
    expect(body.text).toBe("halo");
  });

  it("кладёт соседние реплики контекстом", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioReply([0]));
    vi.stubGlobal("fetch", fetchMock);

    await synthesize("key", "v", { text: "dua", prev: "satu", next: "tiga" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.previous_text).toBe("satu");
    expect(body.next_text).toBe("tiga");
  });

  it("падает с кодом ответа в тексте ошибки", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" })
    );

    await expect(
      synthesize("key", "v", { text: "halo", prev: null, next: null })
    ).rejects.toThrow(/429/);
  });
});

describe("neighborTexts", () => {
  const cues = [cue(1, "satu"), cue(2, "dua"), cue(3, null)];

  it("у первой реплики нет предыдущей", () => {
    expect(neighborTexts(cues, 0)).toEqual({ prev: null, next: "dua" });
  });

  it("у последней реплики нет следующей", () => {
    expect(neighborTexts(cues, 2)).toEqual({ prev: "dua", next: null });
  });

  it("непереведённого соседа за контекст не выдаёт", () => {
    expect(neighborTexts(cues, 1)).toEqual({ prev: "satu", next: null });
  });
});

describe("mapWithLimit", () => {
  it("сохраняет порядок результатов, а не порядок завершения", async () => {
    const out = await mapWithLimit([30, 10, 20], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it("не запускает больше задач разом, чем разрешено", async () => {
    let active = 0;
    let peak = 0;
    await mapWithLimit([1, 2, 3, 4, 5], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    });
    expect(peak).toBe(2);
  });

  it("на пустом списке не зовёт работу вовсе", async () => {
    const fn = vi.fn();
    expect(await mapWithLimit([], 2, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/tts.test.ts`
Expected: FAIL — `Cannot find module '../lib/tts'`.

- [ ] **Шаг 3: Написать `lib/tts.ts`**

```ts
import { Cue } from "./cues";

const BASE = "https://api.elevenlabs.io/v1";

// Flash v2.5 — 0.5 кредита за знак против 1 у multilingual v2, вдвое дешевле
// при том же наборе языков. Если фонетика индонезийского на смоуке окажется
// плохой, замена модели — правка одной этой строки.
export const TTS_MODEL = "eleven_flash_v2_5";

// mp3 128 kbps: дорожка всё равно будет пережата в AAC при муксе, гнать сюда
// PCM незачем — это только трафик и время.
const OUTPUT_FORMAT = "mp3_44100_128";

export interface SynthInput {
  text: string;
  /** Предыдущая реплика на бахасе или null — контекст интонации. */
  prev: string | null;
  next: string | null;
}

export async function synthesize(
  apiKey: string,
  voiceId: string,
  input: SynthInput
): Promise<Uint8Array> {
  const res = await fetch(
    `${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        model_id: TTS_MODEL,
        // Язык задан явно: на коротких репликах автоопределение ошибается, и
        // модель читает индонезийский текст с английской фонетикой.
        language_code: "id",
        previous_text: input.prev,
        next_text: input.next,
      }),
    }
  );

  if (!res.ok) {
    // Тело читаем и на отказе: под undici непрочитанное тело держит
    // соединение до тайм-аута вместо возврата в пул, а кусок текста делает
    // диагностику полезнее (429 от лимита параллелизма выглядит иначе, чем
    // 401 от протухшего ключа).
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Синтез речи вернул ${res.status}: ${body}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

// Контекст для интонации: соседняя реплика уже на бахасе. Непереведённого
// соседа не отдаём — русский текст в поле previous_text собьёт модель
// сильнее, чем его отсутствие.
export function neighborTexts(
  cues: Cue[],
  index: number
): { prev: string | null; next: string | null } {
  return {
    prev: cues[index - 1]?.id ?? null,
    next: cues[index + 1]?.id ?? null,
  };
}

// Пул с общим курсором вместо разбиения на пачки: пачка ждёт самую медленную
// свою задачу, прежде чем начать следующую, а курсор отдаёт освободившемуся
// работнику следующую реплику сразу.
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const out = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await fn(items[index], index);
      }
    }
  );

  await Promise.all(workers);
  return out;
}
```

- [ ] **Шаг 4: Прогнать тест**

Run: `cd dub-bot && npx vitest run tests/tts.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/tts.ts dub-bot/tests/tts.test.ts
git commit -m "feat(dub-bot): синтез реплик через ElevenLabs Flash v2.5

Соседние реплики уходят контекстом: кредитов это не стоит, а стык
перестаёт звучать как склейка разных дублей. Пул с общим курсором, а не
пачки: пачка ждёт самую медленную свою задачу, курсор отдаёт работу сразу."
```

---

### Задача 6: Сведение звука

Сборка `filter_complex` и запуск ffmpeg. Строка фильтра собирается чистой функцией и проверяется посимвольно — ошибка в ней даёт либо тишину, либо кашу, и обе видны только ушами на готовом ролике.

**Files:**
- Create: `dub-bot/lib/mix.ts`
- Test: `dub-bot/tests/mix.test.ts`

**Interfaces:**
- Consumes: `Runner`, `spawnRunner` (`lib/proc.ts`), `ffmpegPath` (`lib/binaries.ts`).
- Produces: `buildFilter(segments: MixSegment[], duckLevel: number): string`, `buildMixArgs(opts: MixOptions): string[]`, `mixAudio(run: Runner, opts: MixOptions): Promise<void>`, типы `MixSegment { tempo: number; offsetSec: number }`, `MixOptions { srcPath: string; segPaths: string[]; segments: MixSegment[]; duckLevel: number; outPath: string }`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `dub-bot/tests/mix.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildFilter, buildMixArgs, mixAudio } from "../lib/mix";

describe("buildFilter", () => {
  it("на одной реплике не городит промежуточный amix", () => {
    const filter = buildFilter([{ tempo: 1, offsetSec: 1.2 }], 0.13);
    expect(filter).toBe(
      "[1:a]adelay=1200:all=1[voice];" +
        "[0:a]volume=0.13[bed];" +
        "[bed][voice]amix=inputs=2:duration=first:normalize=0[out]"
    );
  });

  it("вставляет atempo только там, где реплику ускоряли", () => {
    const filter = buildFilter(
      [
        { tempo: 1.05, offsetSec: 1.2 },
        { tempo: 1, offsetSec: 5.4 },
      ],
      0.13
    );
    expect(filter).toBe(
      "[1:a]atempo=1.0500,adelay=1200:all=1[s1];" +
        "[2:a]adelay=5400:all=1[s2];" +
        "[s1][s2]amix=inputs=2:duration=longest:normalize=0[voice];" +
        "[0:a]volume=0.13[bed];" +
        "[bed][voice]amix=inputs=2:duration=first:normalize=0[out]"
    );
  });

  it("округляет сдвиг до целых миллисекунд", () => {
    expect(buildFilter([{ tempo: 1, offsetSec: 2.3456 }], 0.2)).toContain("adelay=2346:all=1");
  });

  it("отдаёт уровень приглушения как есть, без своей арифметики", () => {
    expect(buildFilter([{ tempo: 1, offsetSec: 0 }], 0.2)).toContain("volume=0.2");
  });

  it("отказывается собирать фильтр без реплик", () => {
    expect(() => buildFilter([], 0.13)).toThrow(/без реплик/);
  });
});

describe("buildMixArgs", () => {
  it("копирует видеопоток и подставляет каждую реплику отдельным входом", () => {
    const args = buildMixArgs({
      srcPath: "/tmp/src.mp4",
      segPaths: ["/tmp/1.mp3", "/tmp/2.mp3"],
      segments: [
        { tempo: 1, offsetSec: 0 },
        { tempo: 1, offsetSec: 2 },
      ],
      duckLevel: 0.13,
      outPath: "/tmp/out.mp4",
    });

    expect(args.slice(0, 6)).toEqual(["-y", "-i", "/tmp/src.mp4", "-i", "/tmp/1.mp3", "-i"]);
    expect(args).toContain("-filter_complex");
    expect(args).toContain("[out]");
    expect(args.join(" ")).toContain("-c:v copy");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
  });

  it("не даёт числу входов разойтись с числом реплик в фильтре", () => {
    expect(() =>
      buildMixArgs({
        srcPath: "/tmp/src.mp4",
        segPaths: ["/tmp/1.mp3"],
        segments: [
          { tempo: 1, offsetSec: 0 },
          { tempo: 1, offsetSec: 2 },
        ],
        duckLevel: 0.13,
        outPath: "/tmp/out.mp4",
      })
    ).toThrow(/не совпад/);
  });
});

describe("mixAudio", () => {
  const opts = {
    srcPath: "/tmp/src.mp4",
    segPaths: ["/tmp/1.mp3"],
    segments: [{ tempo: 1, offsetSec: 0 }],
    duckLevel: 0.13,
    outPath: "/tmp/out.mp4",
  };

  it("молча проходит на нулевом коде возврата", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stderr: "", stdout: "" });
    await expect(mixAudio(run, opts)).resolves.toBeUndefined();
  });

  it("кладёт хвост stderr в текст ошибки — без него сбой ffmpeg неотличим", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stderr: "Invalid argument", stdout: "" });
    await expect(mixAudio(run, opts)).rejects.toThrow(/Invalid argument/);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/mix.test.ts`
Expected: FAIL — `Cannot find module '../lib/mix'`.

- [ ] **Шаг 3: Написать `lib/mix.ts`**

```ts
import { ffmpegPath } from "./binaries";
import type { Runner } from "./proc";

const STDERR_TAIL = 600;

export interface MixSegment {
  /** Коэффициент ускорения; 1 — реплика идёт как есть. */
  tempo: number;
  /** Время начала реплики в собранной дорожке, секунды. */
  offsetSec: number;
}

export interface MixOptions {
  srcPath: string;
  /** Файлы реплик по порядку; вход N+1 в ffmpeg соответствует segments[N]. */
  segPaths: string[];
  segments: MixSegment[];
  duckLevel: number;
  outPath: string;
}

// Сведение в два приёма: сначала реплики собираются в одну голосовую дорожку
// (atempo меняет темп, не трогая высоту голоса; adelay ставит реплику на своё
// место), затем дорожка кладётся поверх приглушённого оригинала.
//
// normalize=0 обязателен в обоих amix: по умолчанию фильтр делит громкость на
// число входов, и результат вышел бы вдвое тише оригинала.
//
// duration=first в финальном amix обрезает озвучку по длине оригинала — это и
// есть та самая обрезка хвоста, которую layout() посчитал заранее, чтобы
// написать пользователю, сколько секунд потеряно.
export function buildFilter(segments: MixSegment[], duckLevel: number): string {
  if (segments.length === 0) {
    throw new Error("нечего сводить: фильтр без реплик собрать нельзя");
  }

  const single = segments.length === 1;
  const chains = segments.map((s, idx) => {
    const parts: string[] = [];
    // atempo=1 — честный no-op, но он всё равно гоняет звук через ресемплер.
    // Ставим фильтр только там, где он действительно нужен.
    if (s.tempo > 1) parts.push(`atempo=${s.tempo.toFixed(4)}`);
    // all=1 применяет задержку ко всем каналам: без него adelay сдвинет
    // только первый, и стереореплика поедет по каналам врозь.
    parts.push(`adelay=${Math.round(s.offsetSec * 1000)}:all=1`);
    const label = single ? "voice" : `s${idx + 1}`;
    return `[${idx + 1}:a]${parts.join(",")}[${label}]`;
  });

  const filters = [...chains];
  if (!single) {
    const labels = segments.map((_, idx) => `[s${idx + 1}]`).join("");
    filters.push(`${labels}amix=inputs=${segments.length}:duration=longest:normalize=0[voice]`);
  }
  filters.push(`[0:a]volume=${duckLevel}[bed]`);
  filters.push("[bed][voice]amix=inputs=2:duration=first:normalize=0[out]");

  return filters.join(";");
}

export function buildMixArgs(opts: MixOptions): string[] {
  if (opts.segPaths.length !== opts.segments.length) {
    throw new Error(
      `число файлов реплик не совпадает с раскладкой: ${opts.segPaths.length} против ${opts.segments.length}`
    );
  }

  const inputs = opts.segPaths.flatMap((p) => ["-i", p]);
  return [
    "-y",
    "-i",
    opts.srcPath,
    ...inputs,
    "-filter_complex",
    buildFilter(opts.segments, opts.duckLevel),
    "-map",
    "0:v",
    "-map",
    "[out]",
    // Картинка копируется потоком: перекодировать её незачем, мы трогаем
    // только звук — и рендер из минут превращается в секунды.
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    opts.outPath,
  ];
}

export async function mixAudio(run: Runner, opts: MixOptions): Promise<void> {
  const { code, stderr } = await run(ffmpegPath(), buildMixArgs(opts));
  if (code !== 0) {
    throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-STDERR_TAIL)}`);
  }
}
```

- [ ] **Шаг 4: Прогнать тест**

Run: `cd dub-bot && npx vitest run tests/mix.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/mix.ts dub-bot/tests/mix.test.ts
git commit -m "feat(dub-bot): сведение озвучки с приглушённым оригиналом

normalize=0 в обоих amix: по умолчанию фильтр делит громкость на число
входов, и ролик вышел бы вдвое тише оригинала. adelay с all=1 — иначе
задержку получает только первый канал и стереореплика едет врозь."
```

---

### Задача 7: Конвейер и роут запуска

Оркестрация от исходника в Blob до готового ролика в чате. Зависимости идут параметром, как в `sub-bot`: конвейер тестируется без сети и без спавна ffmpeg, а связывание с настоящими модулями живёт в роуте.

**Files:**
- Create: `dub-bot/lib/pipeline.ts`, `dub-bot/app/api/dub/start/route.ts`
- Test: `dub-bot/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `Job`, `toStage`, `saveJob` (Задача 1), `buildCues`, `slotFor` (Задача 2), `charBudget`, `layout` (Задача 3), `translateCues` (Задача 4), `synthesize`, `neighborTexts`, `mapWithLimit` (Задача 5), `mixAudio`, `MixSegment` (Задача 6), `probeMedia`, `downloadToTmp`, `startJob` (перенос).
- Produces: `runPipeline(deps: PipelineDeps, job: Job): Promise<Job>`, тип `PipelineDeps`, `Synthesized { path: string; durSec: number }`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `dub-bot/tests/pipeline.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "../lib/pipeline";
import type { PipelineDeps } from "../lib/pipeline";
import type { Job } from "../lib/jobs";
import type { Cue, Word } from "../lib/cues";

function job(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mp4",
    resultUrl: null,
    stage: "probing",
    durationSec: 0,
    cues: [],
    trimmedSec: 0,
    createdAt: "2026-08-21T00:00:00.000Z",
    stageAt: "2026-08-21T00:00:00.000Z",
    error: null,
    ...overrides,
  };
}

function words(): Word[] {
  return [
    { text: "привет", start: 0, end: 0.5 },
    { text: "друзья", start: 0.5, end: 1.0 },
    { text: "сегодня", start: 2.0, end: 2.6 },
  ];
}

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    download: async () => ({ path: "/tmp/src.mp4", dispose: () => {} }),
    probe: async () => ({ durationSec: 10, hasAudio: true }),
    transcribe: async () => words(),
    translate: async (cues) => cues.map((c) => ({ ...c, id: `id-${c.i}` })),
    synthesizeAll: async (cues) =>
      cues.map((c) => ({ path: `/tmp/${c.i}.mp3`, durSec: 1.0 })),
    mix: async () => "/tmp/out.mp4",
    upload: async () => "https://blob/out.mp4",
    size: async () => 5 * 1024 * 1024,
    deliver: async () => {},
    deleteSource: async () => {},
    save: async () => {},
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("доводит задачу до done и проставляет ссылку на результат", async () => {
    const out = await runPipeline(deps(), job());
    expect(out.stage).toBe("done");
    expect(out.resultUrl).toBe("https://blob/out.mp4");
    expect(out.error).toBeNull();
  });

  it("проходит стадии по порядку", async () => {
    const stages: string[] = [];
    const out = await runPipeline(
      deps({ save: async (j) => { stages.push(j.stage); } }),
      job()
    );
    expect(stages).toEqual([
      "transcribing",
      "translating",
      "synthesizing",
      "mixing",
      "delivering",
      "done",
    ]);
    expect(out.stage).toBe("done");
  });

  it("отказывает по длительности ДО распознавания — платить за отказ незачем", async () => {
    const transcribe = vi.fn();
    const out = await runPipeline(
      deps({ probe: async () => ({ durationSec: 61.5, hasAudio: true }), transcribe }),
      job()
    );
    expect(out.stage).toBe("failed");
    expect(out.error).toMatch(/61/);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("отказывает на ролике без звуковой дорожки", async () => {
    const out = await runPipeline(
      deps({ probe: async () => ({ durationSec: 10, hasAudio: false }) }),
      job()
    );
    expect(out.stage).toBe("failed");
    expect(out.error).toMatch(/звук/i);
  });

  it("отличает «речь не распозналась» от сетевого сбоя", async () => {
    const out = await runPipeline(deps({ transcribe: async () => [] }), job());
    expect(out.stage).toBe("failed");
    expect(out.error).toMatch(/речь/i);
  });

  it("считает бюджет знаков от слота реплики, а не от длительности речи", async () => {
    let seen: number[] = [];
    await runPipeline(
      deps({
        translate: async (cues, budgetFor) => {
          seen = cues.map((c, i) => budgetFor(c, i));
          return cues.map((c) => ({ ...c, id: `id-${c.i}` }));
        },
      }),
      job()
    );
    // Первая реплика: слот 0 → 2.0 с (до начала второй) при CHARS_PER_SEC = 15.
    expect(seen[0]).toBe(30);
    // Вторая реплика: слот 2.0 → 10 с (до конца ролика).
    expect(seen[1]).toBe(120);
  });

  it("не синтезирует реплику, у которой не вернулся перевод", async () => {
    const synthesizeAll = vi.fn().mockResolvedValue([{ path: "/tmp/1.mp3", durSec: 1 }]);
    await runPipeline(
      deps({
        translate: async (cues) =>
          cues.map((c) => (c.i === 1 ? { ...c, id: "satu" } : { ...c, id: null })),
        synthesizeAll,
      }),
      job()
    );
    const passed = synthesizeAll.mock.calls[0][0] as Cue[];
    expect(passed.map((c) => c.i)).toEqual([1]);
  });

  it("сдаётся, если переводить оказалось нечего", async () => {
    const out = await runPipeline(
      deps({ translate: async (cues) => cues.map((c) => ({ ...c, id: null })) }),
      job()
    );
    expect(out.stage).toBe("failed");
    expect(out.error).toMatch(/перевод/i);
  });

  it("запоминает обрезанный хвост в задаче", async () => {
    const out = await runPipeline(
      deps({
        probe: async () => ({ durationSec: 3, hasAudio: true }),
        synthesizeAll: async (cues) => cues.map((c) => ({ path: `/tmp/${c.i}.mp3`, durSec: 5 })),
      }),
      job()
    );
    expect(out.trimmedSec).toBeGreaterThan(0);
  });

  it("удаляет исходник после доставки", async () => {
    const deleteSource = vi.fn();
    await runPipeline(deps({ deleteSource }), job());
    expect(deleteSource).toHaveBeenCalledWith("https://blob/source.mp4");
  });

  it("не удаляет исходник, если доставка не удалась", async () => {
    const deleteSource = vi.fn();
    const out = await runPipeline(
      deps({
        deleteSource,
        deliver: async () => { throw new Error("Telegram лёг"); },
      }),
      job()
    );
    expect(out.stage).toBe("failed");
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it("убирает временный каталог даже на отказе", async () => {
    const dispose = vi.fn();
    await runPipeline(
      deps({
        download: async () => ({ path: "/tmp/src.mp4", dispose }),
        probe: async () => { throw new Error("ffprobe умер"); },
      }),
      job()
    );
    expect(dispose).toHaveBeenCalled();
  });

  it("не роняет вызов на сбое сохранения отказа", async () => {
    const out = await runPipeline(
      deps({
        transcribe: async () => { throw new Error("Scribe вернул 401"); },
        save: async () => { throw new Error("Blob лёг"); },
      }),
      job()
    );
    expect(out.stage).toBe("failed");
    expect(out.error).toMatch(/401/);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/pipeline.test.ts`
Expected: FAIL — `Cannot find module '../lib/pipeline'`.

- [ ] **Шаг 3: Написать `lib/pipeline.ts`**

```ts
import { Cue, Word, buildCues, slotFor } from "./cues";
import { charBudget, layout } from "./fit";
import { Job, toStage } from "./jobs";
import { MAX_DURATION_SEC } from "./media";
import { MixSegment } from "./mix";
import { Download } from "./storage";

export interface Synthesized {
  path: string;
  durSec: number;
}

// Зависимости идут параметром, а не импортом внутри функции: оркестрация
// чистая и тестируется без сети и без спавна ffmpeg. Связывание с настоящими
// lib/media.ts, lib/scribe.ts, lib/translate.ts, lib/tts.ts и lib/mix.ts
// живёт в app/api/dub/start/route.ts.
export interface PipelineDeps {
  download: (url: string) => Promise<Download>;
  probe: (path: string) => Promise<{ durationSec: number; hasAudio: boolean }>;
  transcribe: (sourceUrl: string) => Promise<Word[]>;
  translate: (
    cues: Cue[],
    budgetFor: (cue: Cue, index: number) => number
  ) => Promise<Cue[]>;
  /** Синтезирует реплики и складывает на диск; порядок ответа — порядок реплик. */
  synthesizeAll: (cues: Cue[]) => Promise<Synthesized[]>;
  /** Сводит звук и возвращает путь к готовому ролику. */
  mix: (srcPath: string, segPaths: string[], segments: MixSegment[]) => Promise<string>;
  upload: (path: string, jobId: string) => Promise<string>;
  size: (path: string) => Promise<number>;
  deliver: (job: Job, url: string, sizeBytes: number) => Promise<void>;
  /** Удаляет исходник из Blob. Зовётся только после успешной доставки. */
  deleteSource: (url: string) => Promise<void>;
  save: (job: Job) => Promise<void>;
}

// Отказ — не падение вызова: конвейер запускается фоново из after(), и
// уронить его здесь означает не записать состояние И не отправить сообщение
// в чат. Поэтому сбой сохранения самого отказа тоже проглатывается в лог.
async function fail(deps: PipelineDeps, job: Job, error: string): Promise<Job> {
  const out: Job = { ...toStage(job, "failed"), error };
  try {
    await deps.save(out);
  } catch (saveError) {
    console.error("pipeline: не удалось сохранить отказ", job.jobId, saveError);
  }
  return out;
}

export async function runPipeline(deps: PipelineDeps, job: Job): Promise<Job> {
  // current — последнее собранное состояние задачи: если исключение прилетит
  // после стадии "translating", отказ должен нести уже нарезанные реплики и
  // измеренную длительность, а не исходную пустую задачу.
  let current = job;
  let downloaded: Download | null = null;

  try {
    downloaded = await deps.download(current.sourceUrl);
    const info = await deps.probe(downloaded.path);

    // Порядок важен: длительность и звук проверяются ДО распознавания —
    // отказ здесь стоит одного локального вызова ffprobe, а не оплаченного
    // обращения к Scribe.
    if (info.durationSec > MAX_DURATION_SEC) {
      return await fail(
        deps,
        current,
        `ролик ${info.durationSec.toFixed(1)} с, а потолок ${MAX_DURATION_SEC} с`
      );
    }
    if (!info.hasAudio) {
      return await fail(deps, current, "в ролике нет звуковой дорожки — нечего распознавать");
    }

    current = { ...toStage(current, "transcribing"), durationSec: info.durationSec };
    await deps.save(current);

    const words = await deps.transcribe(current.sourceUrl);
    if (words.length === 0) {
      return await fail(deps, current, "речь не распозналась — возможно, в ролике только музыка");
    }

    const cues = buildCues(words);
    if (cues.length === 0) {
      return await fail(deps, current, "речь не распозналась — реплик не получилось");
    }

    current = { ...toStage(current, "translating"), cues };
    await deps.save(current);

    // Бюджет знаков считается от СЛОТА реплики (время до начала следующей),
    // а не от длительности её речи: пауза между фразами принадлежит реплике
    // и является первым резервом под более длинный индонезийский текст.
    const translated = await deps.translate(cues, (_cue, index) =>
      charBudget(slotFor(cues, index, info.durationSec))
    );

    // Реплики без перевода (модель перепутала номера) в синтез не идут: их
    // слот останется тишиной, а замечание уйдёт в отчёт.
    const usable = translated.filter((c) => c.id !== null && c.id.trim().length > 0);
    if (usable.length === 0) {
      return await fail(deps, { ...current, cues: translated }, "перевод не вернулся ни по одной реплике");
    }

    current = { ...toStage(current, "synthesizing"), cues: translated };
    await deps.save(current);

    const synth = await deps.synthesizeAll(usable);

    // Слот считается по положению реплики в ПОЛНОМ списке, а не в
    // отфильтрованном: граница слота — начало следующей реплики оригинала,
    // даже если её саму озвучить не вышло. Позиция берётся из карты по
    // номеру, а не через indexOf по ссылке на объект: ссылочное равенство
    // здесь держится случайно (filter не копирует элементы) и сломается от
    // первой же безобидной правки в translateCues.
    const positionOf = new Map(translated.map((c, idx) => [c.i, idx]));
    const { placed, trimmedSec } = layout(
      usable.map((c, idx) => ({
        i: c.i,
        start: c.start,
        actualSec: synth[idx].durSec,
        slotSec: slotFor(translated, positionOf.get(c.i) as number, info.durationSec),
      })),
      info.durationSec
    );

    const byIndex = new Map(placed.map((p) => [p.i, p]));
    const withPlacement = translated.map((c) => {
      const p = byIndex.get(c.i);
      return p ? { ...c, tempo: p.tempo, offset: p.offset } : c;
    });

    current = { ...toStage(current, "mixing"), cues: withPlacement, trimmedSec };
    await deps.save(current);

    const segments: MixSegment[] = placed.map((p) => ({ tempo: p.tempo, offsetSec: p.offset }));
    const outPath = await deps.mix(
      downloaded.path,
      synth.map((s) => s.path),
      segments
    );

    const sizeBytes = await deps.size(outPath);
    const url = await deps.upload(outPath, current.jobId);

    current = { ...toStage(current, "delivering"), resultUrl: url };
    await deps.save(current);

    await deps.deliver(current, url, sizeBytes);

    // Исходник весит сотни мегабайт и больше не нужен. Удаляется ТОЛЬКО после
    // успешной доставки: упади отправка раньше — файл останется, и повторить
    // работу будет из чего. Сбой самой уборки доставку не отменяет.
    await deps.deleteSource(current.sourceUrl);

    current = toStage(current, "done");
    await deps.save(current);
    return current;
  } catch (e) {
    return await fail(deps, current, e instanceof Error ? e.message : String(e));
  } finally {
    // /tmp на функции — 500 МБ на всё, и на тёплом инстансе он переживает
    // между вызовами. Каталог убирается на любом исходе, а не только на успехе.
    downloaded?.dispose();
  }
}
```

- [ ] **Шаг 4: Прогнать тест**

Run: `cd dub-bot && npx vitest run tests/pipeline.test.ts`
Expected: PASS, 13 тестов.

- [ ] **Шаг 5: Написать роут запуска**

Создать `dub-bot/app/api/dub/start/route.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse, after } from "next/server";
import { requireEnv } from "../../../../lib/config";
import { Cue } from "../../../../lib/cues";
import { pickDelivery, renderReport } from "../../../../lib/deliver";
import { deleteBlob, RESULTS_PREFIX, saveJob } from "../../../../lib/jobs";
import { probeMedia } from "../../../../lib/media";
import { mixAudio, MixSegment } from "../../../../lib/mix";
import { runPipeline } from "../../../../lib/pipeline";
import { spawnRunner } from "../../../../lib/proc";
import { transcribe } from "../../../../lib/scribe";
import { startJob } from "../../../../lib/start";
import { downloadToTmp } from "../../../../lib/storage";
import { sendMessage, sendVideoByUrl, sendVideoUpload } from "../../../../lib/telegram";
import { translateCues } from "../../../../lib/translate";
import { mapWithLimit, neighborTexts, synthesize } from "../../../../lib/tts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

const DEFAULT_DUCK_LEVEL = 0.13;
const DEFAULT_CONCURRENCY = 2;

function duckLevel(): number {
  const raw = Number(process.env.DUB_DUCK_LEVEL);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DUCK_LEVEL;
}

function concurrency(): number {
  const raw = Number(process.env.DUB_TTS_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
}

// Файл уже целиком лежит в Blob (страница загрузки закончила multipart-заливку
// до этого запроса) — здесь заводится задача и запускается конвейер целиком.
// startJob уже проверяет токен и владение файлом, повторять это незачем.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { token: string; blobUrl: string; durationSec: number };

  let started: Awaited<ReturnType<typeof startJob>>;
  try {
    started = await startJob(body);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const botToken = requireEnv("TELEGRAM_DUB_BOT_TOKEN");
  const workdir = mkdtempSync(join(tmpdir(), "dub-work-"));
  // Путь к готовому файлу нужен ветке доставки multipart: она грузит байты
  // через нашу функцию, а не даёт Telegram ссылку. Держим его здесь, потому
  // что deliver получает от конвейера только ссылку на Blob.
  let resultPath: string | null = null;

  // Ответ уходит сразу же (202): конвейер занимает минуты, клиент ждать не должен.
  after(async () => {
    try {
      const done = await runPipeline(
        {
          download: downloadToTmp,
          probe: (path) => probeMedia(spawnRunner, path),
          transcribe: (sourceUrl) => transcribe(requireEnv("ELEVENLABS_API_KEY"), sourceUrl),
          translate: (cues, budgetFor) =>
            translateCues(requireEnv("OPENAI_API_KEY"), cues, budgetFor),
          synthesizeAll: (cues: Cue[]) =>
            mapWithLimit(cues, concurrency(), async (cue, index) => {
              const { prev, next } = neighborTexts(cues, index);
              const bytes = await synthesize(
                requireEnv("ELEVENLABS_API_KEY"),
                requireEnv("DUB_VOICE_ID"),
                { text: cue.id as string, prev, next }
              );
              const path = join(workdir, `cue-${cue.i}.mp3`);
              writeFileSync(path, bytes);
              // Длительность меряем тем же ffprobe, что и исходник: гадать по
              // битрейту нельзя, а от этой цифры зависит вся раскладка.
              const info = await probeMedia(spawnRunner, path);
              return { path, durSec: info.durationSec };
            }),
          mix: async (srcPath: string, segPaths: string[], segments: MixSegment[]) => {
            const outPath = join(workdir, "out.mp4");
            await mixAudio(spawnRunner, {
              srcPath,
              segPaths,
              segments,
              duckLevel: duckLevel(),
              outPath,
            });
            resultPath = outPath;
            return outPath;
          },
          upload: async (path, jobId) => {
            const blob = await put(`${RESULTS_PREFIX}${jobId}.mp4`, readFileAsBytes(path), {
              access: "public",
              contentType: "video/mp4",
              addRandomSuffix: false,
              allowOverwrite: true,
            });
            return blob.url;
          },
          size: async (path) => statSync(path).size,
          deliver: async (job, url, sizeBytes) => {
            const caption = renderReport(job);
            const mode = pickDelivery(sizeBytes);
            if (mode === "link") {
              return sendVideoByUrl(botToken, job.chatId, url, caption);
            }
            // Ветка multipart читает ЛОКАЛЬНЫЙ файл: она для того и нужна, что
            // Telegram по ссылке берёт только 20 МБ, а через загрузку — 50.
            if (mode === "multipart" && resultPath) {
              return sendVideoUpload(
                botToken,
                job.chatId,
                readFileAsBytes(resultPath),
                "dub.mp4",
                caption
              );
            }
            return sendMessage(botToken, job.chatId, `${caption}\n\nФайл крупный, забери по ссылке: ${url}`);
          },
          deleteSource: deleteBlob,
          save: saveJob,
        },
        started.job
      );

      if (done.stage === "failed") {
        await sendMessage(botToken, done.chatId, `Не вышло: ${done.error}`);
      }
    } catch (error) {
      // runPipeline сама не бросает — сюда долетит разве что requireEnv на
      // отсутствующей переменной или упавший sendMessage. Ответ уже отправлен.
      console.error("dub/start: конвейер не отчитался в чат", started.jobId, error);
    } finally {
      rmWorkdir(workdir);
    }
  });

  return NextResponse.json({ ok: true, jobId: started.jobId }, { status: 202 });
}
```

Вспомогательные `readFileAsBytes` и `rmWorkdir` дописать в том же файле:

```ts
import { readFileSync, rmSync } from "node:fs";

function readFileAsBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

function rmWorkdir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.error("dub/start: не удалось убрать рабочий каталог", dir, error);
  }
}
```

- [ ] **Шаг 6: Проверить сборку**

Run: `cd dub-bot && npm run build`
Expected: сборка проходит, в списке маршрутов появился `/api/dub/start`.

- [ ] **Шаг 7: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/pipeline.ts dub-bot/tests/pipeline.test.ts dub-bot/app/api/dub/start/route.ts
git commit -m "feat(dub-bot): конвейер от исходника до готового ролика

Длительность и звук проверяются до распознавания: отказ стоит одного
локального ffprobe вместо оплаченного обращения к Scribe. Бюджет знаков
считается от слота реплики, а не от длительности её речи — пауза между
фразами принадлежит реплике и работает первым резервом."
```

---

### Задача 8: Команды бота, отчёт и вебхук

Три команды, текст отчёта и вебхук с проверкой секрета. Отчёт обязан говорить правду про обрезанный хвост: пользователь выложит ролик в сторис, не переслушав его до конца.

**Files:**
- Create: `dub-bot/lib/commands.ts`, `dub-bot/lib/deliver.ts`, `dub-bot/app/api/telegram/route.ts`
- Test: `dub-bot/tests/commands.test.ts`, `dub-bot/tests/deliver.test.ts`

**Interfaces:**
- Consumes: `Job`, `isActive`, `listJobs` (Задача 1), `Cue` (Задача 1), `signToken`, `UPLOAD_TOKEN_TTL_MS` (`lib/tokens.ts`), `baseUrl`, `allowedChatIds`, `requireEnv` (`lib/config.ts`).
- Produces: `parseCommand(text: string): Command | null`, `handleCommand(command: Command, chatId: number, deps: CommandDeps): Promise<string>`, `pickDelivery(sizeBytes: number): DeliveryMode`, `renderReport(job: Job): string`, типы `Command = "dub" | "status" | "help"`, `DeliveryMode = "link" | "multipart" | "blob"`.

- [ ] **Шаг 1: Написать падающий тест на отчёт**

Создать `dub-bot/tests/deliver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickDelivery, renderReport } from "../lib/deliver";
import type { Job } from "../lib/jobs";
import type { Cue } from "../lib/cues";

const MB = 1024 * 1024;

function cue(i: number, over: Partial<Cue> = {}): Cue {
  return { i, start: i, end: i + 1, ru: "русский", id: `id-${i}`, tempo: 1, offset: i, warning: null, ...over };
}

function job(over: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mp4",
    resultUrl: "https://blob/out.mp4",
    stage: "delivering",
    durationSec: 58,
    cues: [cue(1), cue(2)],
    trimmedSec: 0,
    createdAt: "2026-08-21T00:00:00.000Z",
    stageAt: "2026-08-21T00:00:00.000Z",
    error: null,
    ...over,
  };
}

describe("pickDelivery", () => {
  it("до 20 МБ отдаёт ссылкой — Telegram скачает сам", () => {
    expect(pickDelivery(20 * MB)).toBe("link");
  });

  it("от 20 до 50 МБ гонит файл через нашу функцию", () => {
    expect(pickDelivery(20 * MB + 1)).toBe("multipart");
    expect(pickDelivery(50 * MB)).toBe("multipart");
  });

  it("свыше 50 МБ остаётся только ссылка на хранилище", () => {
    expect(pickDelivery(50 * MB + 1)).toBe("blob");
  });
});

describe("renderReport", () => {
  it("называет число реплик", () => {
    expect(renderReport(job())).toContain("Реплик: 2");
  });

  it("молчит про ускорение, когда никого не ускоряли", () => {
    expect(renderReport(job())).not.toMatch(/ускор/i);
  });

  it("считает ускоренные реплики", () => {
    const j = job({ cues: [cue(1, { tempo: 1.12 }), cue(2)] });
    expect(renderReport(j)).toMatch(/Ускорено: 1/);
  });

  it("говорит про обрезанный хвост — иначе он уедет в сторис незамеченным", () => {
    expect(renderReport(job({ trimmedSec: 0.42 }))).toMatch(/0\.4 с/);
  });

  it("перечисляет замечания по терминологии с номерами реплик", () => {
    const j = job({ cues: [cue(1, { warning: "в переводе нет «doa»" }), cue(2)] });
    const text = renderReport(j);
    expect(text).toContain("1:");
    expect(text).toContain("doa");
  });

  it("называет реплики, оставшиеся без озвучки", () => {
    const j = job({ cues: [cue(1, { id: null }), cue(2)] });
    expect(renderReport(j)).toMatch(/без озвучки: 1/i);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/deliver.test.ts`
Expected: FAIL — `Cannot find module '../lib/deliver'`.

- [ ] **Шаг 3: Написать `lib/deliver.ts`**

```ts
import { Job } from "./jobs";

const MB = 1024 * 1024;

export type DeliveryMode = "link" | "multipart" | "blob";

// Telegram скачивает по ссылке до 20 МБ и принимает загрузку до 50 МБ.
// Три ветки, а не две, именно поэтому.
export function pickDelivery(sizeBytes: number): DeliveryMode {
  if (sizeBytes <= 20 * MB) return "link";
  if (sizeBytes <= 50 * MB) return "multipart";
  return "blob";
}

// Подпись к готовому ролику. Обрезанный хвост и реплики без озвучки названы
// явно: молча отдать ролик, у которого оборвана последняя фраза, — значит
// дать выложить его в сторис не переслушав.
export function renderReport(job: Job): string {
  const lines = [`Готово. Реплик: ${job.cues.length}`];

  const sped = job.cues.filter((c) => c.tempo > 1).length;
  if (sped > 0) lines.push(`Ускорено: ${sped}`);

  const silent = job.cues.filter((c) => !c.id || c.id.trim().length === 0);
  if (silent.length > 0) {
    lines.push(`Без озвучки: ${silent.map((c) => c.i).join(", ")} — перевод не вернулся`);
  }

  if (job.trimmedSec > 0) {
    lines.push(`Хвост не влез: обрезано ${job.trimmedSec.toFixed(1)} с — переслушай конец`);
  }

  const warnings = job.cues.filter((c) => c.warning !== null);
  if (warnings.length > 0) {
    lines.push("Замечания по терминам:");
    for (const c of warnings) lines.push(`${c.i}: ${c.warning}`);
  }

  return lines.join("\n");
}
```

- [ ] **Шаг 4: Прогнать тест отчёта**

Run: `cd dub-bot && npx vitest run tests/deliver.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Шаг 5: Написать падающий тест на команды**

Создать `dub-bot/tests/commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCommand, handleCommand } from "../lib/commands";
import type { CommandDeps } from "../lib/commands";
import type { Job } from "../lib/jobs";

function job(over: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mp4",
    resultUrl: null,
    stage: "synthesizing",
    durationSec: 58,
    cues: [],
    trimmedSec: 0,
    createdAt: "2026-08-21T00:00:00.000Z",
    stageAt: "2026-08-21T00:00:00.000Z",
    error: null,
    ...over,
  };
}

function deps(jobs: Job[] = []): CommandDeps {
  return {
    uploadUrl: (chatId) => `https://bot.example/u/token-${chatId}`,
    listJobs: async () => jobs,
  };
}

describe("parseCommand", () => {
  it("узнаёт команды", () => {
    expect(parseCommand("/dub")).toBe("dub");
    expect(parseCommand("/status")).toBe("status");
    expect(parseCommand("/help")).toBe("help");
    expect(parseCommand("/start")).toBe("help");
  });

  it("терпит приписанное имя бота, как в группах", () => {
    expect(parseCommand("/dub@qurany_dub_bot")).toBe("dub");
  });

  it("не считает командой обычное сообщение", () => {
    expect(parseCommand("привет")).toBeNull();
  });
});

describe("handleCommand", () => {
  it("на /dub отдаёт ссылку на страницу загрузки", async () => {
    const text = await handleCommand("dub", 42, deps());
    expect(text).toContain("https://bot.example/u/token-42");
  });

  it("на /status без активных задач так и говорит", async () => {
    const text = await handleCommand("status", 42, deps());
    expect(text).toMatch(/нет/i);
  });

  it("на /status показывает стадию своей задачи", async () => {
    const text = await handleCommand("status", 42, deps([job()]));
    expect(text).toContain("synthesizing");
  });

  it("не показывает чужие задачи", async () => {
    const text = await handleCommand("status", 42, deps([job({ chatId: 7 })]));
    expect(text).toMatch(/нет/i);
  });

  it("не показывает закрытые задачи", async () => {
    const text = await handleCommand("status", 42, deps([job({ stage: "done" })]));
    expect(text).toMatch(/нет/i);
  });

  it("на /help перечисляет команды", async () => {
    const text = await handleCommand("help", 42, deps());
    expect(text).toContain("/dub");
    expect(text).toContain("/status");
  });
});
```

- [ ] **Шаг 6: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/commands.test.ts`
Expected: FAIL — `Cannot find module '../lib/commands'`.

- [ ] **Шаг 7: Написать `lib/commands.ts`**

```ts
import { isActive, Job } from "./jobs";

export type Command = "dub" | "status" | "help";

export interface CommandDeps {
  uploadUrl: (chatId: number) => string;
  listJobs: () => Promise<Job[]>;
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
  "Что умею:",
  "/dub — дать ссылку на загрузку ролика; в ответ придёт тот же ролик с индонезийской озвучкой",
  "/status — показать, на какой стадии моя работа",
  "/help — это сообщение",
  "",
  "Ролик до 61 секунды, с русской речью. Оригинальный звук останется фоном.",
].join("\n");

export async function handleCommand(
  command: Command,
  chatId: number,
  deps: CommandDeps
): Promise<string> {
  if (command === "help") return HELP;

  if (command === "dub") {
    return [
      "Открой ссылку и выбери ролик из галереи (живёт 30 минут):",
      deps.uploadUrl(chatId),
    ].join("\n");
  }

  const mine = (await deps.listJobs()).filter((j) => j.chatId === chatId && isActive(j));
  if (mine.length === 0) return "Активных задач нет. Начни новую через /dub.";

  return mine
    .map((j) => `${j.jobId.slice(0, 8)} — ${j.stage}, с ${j.stageAt}`)
    .join("\n");
}
```

- [ ] **Шаг 8: Прогнать тест команд**

Run: `cd dub-bot && npx vitest run tests/commands.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Шаг 9: Написать вебхук**

Создать `dub-bot/app/api/telegram/route.ts`. Файл переносится из `sub-bot/app/api/telegram/route.ts` (ветка `worktree-sub-bot`) с тремя правками: команды берутся из нового `lib/commands.ts`, ветки `/ok`, `/cancel` и разбора правок удаляются целиком, переменная токена — `TELEGRAM_DUB_BOT_TOKEN`. Сохраняются без изменений: проверка заголовка `X-Telegram-Bot-Api-Secret-Token`, whitelist `allowedChatIds()` и ответ `200` на любой апдейт (Telegram повторяет доставку на любой не-200, включая осмысленные отказы).

- [ ] **Шаг 10: Проверить сборку и все тесты**

Run: `cd dub-bot && npm test && npm run build`
Expected: PASS; в маршрутах есть `/api/telegram`, `/api/dub/start`, `/api/upload`, `/api/cleanup`, `/u/[token]`.

- [ ] **Шаг 11: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/commands.ts dub-bot/lib/deliver.ts dub-bot/app/api/telegram/route.ts dub-bot/tests/commands.test.ts dub-bot/tests/deliver.test.ts
git commit -m "feat(dub-bot): команды бота и отчёт о готовом ролике

Отчёт называет обрезанный хвост и реплики без озвучки явно: молча отдать
ролик с оборванной последней фразой значит дать выложить его в сторис
не переслушав."
```

---

### Задача 9: Самопроверка окружения

Роут, который отвечает на вопрос «поедет ли это на проде» без единого платного вызова. Сборка ffmpeg на Vercel уже один раз преподнесла сюрприз (в 7.0 фильтр `drawtext` потребовал HarfBuzz и молча не собрался) — набор фильтров проверяется, а не предполагается.

**Files:**
- Create: `dub-bot/lib/probe.ts`, `dub-bot/app/api/probe/route.ts`
- Test: `dub-bot/tests/probe.test.ts`

**Interfaces:**
- Consumes: `ffmpegPath`, `ffprobePath`, `ffmpegHash`, `FFMPEG_SHA256` (`lib/binaries.ts`), `spawnRunner` (`lib/proc.ts`), `buildMixArgs` (Задача 6), `probeMedia` (`lib/media.ts`).
- Produces: `runProbe(): Promise<ProbeReport>`, `missingFilters(ffmpegFiltersOutput: string): string[]`, `REQUIRED_FILTERS`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `dub-bot/tests/probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { missingFilters, REQUIRED_FILTERS } from "../lib/probe";

// Формат вывода `ffmpeg -filters`: два-три флага, имя, входы/выходы, описание.
const SAMPLE = [
  " Filters:",
  " T.. adelay            A->A       Delay one or more audio channels.",
  " ... amix              N->A       Audio mixing.",
  " TSC atempo            A->A       Adjust audio tempo.",
  " TSC volume            A->A       Change input volume.",
].join("\n");

describe("missingFilters", () => {
  it("на полном наборе не находит пропаж", () => {
    expect(missingFilters(SAMPLE)).toEqual([]);
  });

  it("называет именно тот фильтр, которого нет", () => {
    const without = SAMPLE.split("\n").filter((l) => !l.includes("atempo")).join("\n");
    expect(missingFilters(without)).toEqual(["atempo"]);
  });

  it("не принимает имя фильтра, найденное внутри чужого слова", () => {
    const decoy = " ... amixotron        N->A       Not our filter.";
    expect(missingFilters(decoy)).toEqual([...REQUIRED_FILTERS]);
  });

  it("требует ровно те фильтры, на которых стоит сведение", () => {
    expect([...REQUIRED_FILTERS].sort()).toEqual(["adelay", "amix", "atempo", "volume"]);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `cd dub-bot && npx vitest run tests/probe.test.ts`
Expected: FAIL — `Cannot find module '../lib/probe'`.

- [ ] **Шаг 3: Написать `lib/probe.ts`**

```ts
import { mkdtempSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegHash, ffmpegPath, ffprobePath, FFMPEG_SHA256 } from "./binaries";
import { probeMedia } from "./media";
import { buildMixArgs } from "./mix";
import { spawnRunner } from "./proc";

// Ровно те фильтры, на которых стоит сведение (lib/mix.ts). Список не
// «на всякий случай»: сборка ffmpeg на Vercel уже один раз молча приехала
// без drawtext, и обнаружилось это только на рендере.
export const REQUIRED_FILTERS = ["atempo", "adelay", "amix", "volume"] as const;

export interface ProbeReport {
  ffmpeg: string;
  ffprobe: string;
  ffmpegSha256: string;
  hashMatches: boolean;
  missingFilters: string[];
  tmpFreeMb: number;
  mixOk: boolean;
  mixStderrTail: string;
  resultHasAudio: boolean;
  resultDurationSec: number;
}

// Имя фильтра ищется как отдельное слово в колонке имён, а не подстрокой:
// иначе «amix» нашёлся бы внутри любого чужого фильтра, чьё имя с него
// начинается, и проверка бы врала в самую опасную сторону — в сторону «всё
// на месте».
export function missingFilters(filtersOutput: string): string[] {
  return REQUIRED_FILTERS.filter(
    (name) => !new RegExp(`(^|\\s)${name}(\\s|$)`, "m").test(filtersOutput)
  );
}

export async function runProbe(): Promise<ProbeReport> {
  const ffmpeg = ffmpegPath();
  const ffprobe = ffprobePath();
  const sha = await ffmpegHash(ffmpeg);
  const filters = await spawnRunner(ffmpeg, ["-hide_banner", "-filters"]);

  let tmpFreeMb = -1;
  try {
    const s = statfsSync(tmpdir());
    tmpFreeMb = Math.round((Number(s.bavail) * Number(s.bsize)) / 1048576);
  } catch {
    tmpFreeMb = -1;
  }

  const dir = mkdtempSync(join(tmpdir(), "dub-probe-"));
  let mixOk = false;
  let mixStderrTail = "";
  let resultHasAudio = false;
  let resultDurationSec = 0;

  try {
    // Материал берётся из lavfi, а не из файла: проверять надо связку
    // фильтров и мукс, а не наличие тестового ролика в репозитории. Реплики
    // в wav — чтобы самопроверка не зависела от наличия кодировщика mp3
    // (в проде mp3 приходит готовым от ElevenLabs, а декодер есть всегда).
    const src = join(dir, "src.mp4");
    const srcResult = await spawnRunner(ffmpeg, [
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=320x240:d=4",
      "-f", "lavfi", "-i", "sine=frequency=200:duration=4",
      "-c:v", "mpeg4", "-c:a", "aac", "-shortest", src,
    ]);
    if (srcResult.code !== 0) {
      return {
        ffmpeg, ffprobe, ffmpegSha256: sha, hashMatches: sha === FFMPEG_SHA256,
        missingFilters: missingFilters(filters.stdout + filters.stderr),
        tmpFreeMb, mixOk: false,
        mixStderrTail: `не удалось собрать тестовый ролик: ${srcResult.stderr.slice(-400)}`,
        resultHasAudio: false, resultDurationSec: 0,
      };
    }

    const segs: string[] = [];
    for (const [idx, freq] of [700, 900].entries()) {
      const seg = join(dir, `seg${idx}.wav`);
      await spawnRunner(ffmpeg, [
        "-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=1`, seg,
      ]);
      segs.push(seg);
    }

    const out = join(dir, "out.mp4");
    const mix = await spawnRunner(
      ffmpeg,
      buildMixArgs({
        srcPath: src,
        segPaths: segs,
        segments: [
          { tempo: 1.1, offsetSec: 0.5 },
          { tempo: 1, offsetSec: 2.5 },
        ],
        duckLevel: 0.13,
        outPath: out,
      })
    );
    mixOk = mix.code === 0;
    mixStderrTail = mix.stderr.slice(-600);

    if (mixOk) {
      const info = await probeMedia(spawnRunner, out);
      resultHasAudio = info.hasAudio;
      resultDurationSec = info.durationSec;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    ffmpeg,
    ffprobe,
    ffmpegSha256: sha,
    hashMatches: sha === FFMPEG_SHA256,
    missingFilters: missingFilters(filters.stdout + filters.stderr),
    tmpFreeMb,
    mixOk,
    mixStderrTail,
    resultHasAudio,
    resultDurationSec,
  };
}
```

- [ ] **Шаг 4: Написать роут**

Создать `dub-bot/app/api/probe/route.ts`:

```ts
import { NextResponse } from "next/server";
import { runProbe } from "../../../lib/probe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await runProbe());
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Шаг 5: Прогнать тест и локальную самопроверку**

Run: `cd dub-bot && npx vitest run tests/probe.test.ts`
Expected: PASS, 4 теста.

Затем убедиться, что сведение реально работает на локальной сборке:

```bash
cd dub-bot && node -e "import('./lib/probe.ts').catch(() => {})" 2>/dev/null; npm run dev &
sleep 8 && curl -s localhost:3000/api/probe | head -40
```

Expected: `mixOk: true`, `resultHasAudio: true`, `missingFilters: []`. Локально `hashMatches` будет `false` — там сборка ffmpeg под macOS, это ожидаемо и не ошибка.

- [ ] **Шаг 6: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/lib/probe.ts dub-bot/app/api/probe/route.ts dub-bot/tests/probe.test.ts
git commit -m "feat(dub-bot): самопроверка ffmpeg без платных вызовов

Набор фильтров проверяется, а не предполагается: сборка на Vercel уже
приезжала без drawtext молча, и узналось это только на рендере. Имя
фильтра ищется целым словом — подстрока нашла бы amix внутри чужого
фильтра и соврала в сторону «всё на месте»."
```

---

### Задача 10: Деплой, смоук и калибровка

Единственная задача, которой нужен человек: ключи, проект в Vercel и уши, чтобы выбрать голос. Она же закрывает три непроверенных места из спеки.

**Files:**
- Modify: `dub-bot/vercel.json`, `dub-bot/README.md`
- Modify (по итогам калибровки): `dub-bot/lib/fit.ts`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: работающий бот и откалиброванная константа `CHARS_PER_SEC`.

- [ ] **Шаг 1: Поправить `vercel.json` под новые маршруты**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cleanup", "schedule": "0 4 * * *" }],
  "functions": {
    "app/api/dub/start/route.ts": { "memory": 4096, "maxDuration": 800 }
  }
}
```

- [ ] **Шаг 2: Создать проект и хранилище**

Просить Alan выполнить (или выполнить самому, если есть доступ):

```bash
cd dub-bot
npx vercel link --yes
npx vercel blob store add dub-bot
```

- [ ] **Шаг 3: Завести переменные окружения**

Ключи `ELEVENLABS_API_KEY` и `OPENAI_API_KEY` даёт Alan; токен бота — от @BotFather; `DUB_TOKEN_SECRET` и `TELEGRAM_WEBHOOK_SECRET` генерируются на месте.

```bash
for name in TELEGRAM_DUB_BOT_TOKEN TELEGRAM_ALLOWED_CHAT_IDS TELEGRAM_WEBHOOK_SECRET \
            ELEVENLABS_API_KEY OPENAI_API_KEY DUB_VOICE_ID DUB_TOKEN_SECRET; do
  echo "добавляю $name"; npx vercel env add "$name" production
done
```

`DUB_DUCK_LEVEL` и `DUB_TTS_CONCURRENCY` не заводить: у них есть рабочие значения по умолчанию (0.13 и 2), а переменные нужны, только если понадобится их менять.

- [ ] **Шаг 4: Выкатить и прогнать самопроверку**

```bash
cd dub-bot && npx vercel deploy --prod
curl -s https://<домен>/api/probe | python3 -m json.tool
```

Expected: `hashMatches: true`, `missingFilters: []`, `mixOk: true`, `resultHasAudio: true`, `tmpFreeMb` заметно больше 500.

Если `mixOk: false` — дальше не идти: читать `mixStderrTail`, чинить `lib/mix.ts`, повторять. Ключи на этом шаге ещё не тратятся.

- [ ] **Шаг 5: Выбрать голос**

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices \
  | python3 -c "import json,sys; [print(v['voice_id'], v['name'], v.get('labels',{})) for v in json.load(sys.stdin)['voices']]"
```

Взять три-четыре кандидата, озвучить каждым одну и ту же индонезийскую фразу из настоящего ролика, дать Alan послушать, выбранный `voice_id` положить в `DUB_VOICE_ID`.

- [ ] **Шаг 6: Прописать вебхук**

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_DUB_BOT_TOKEN/setWebhook" \
  -d "url=https://<домен>/api/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

- [ ] **Шаг 7: Смоук на пятнадцатисекундном ролике**

Ролик с русской речью и нашидом фоном. `/dub` → загрузить → дождаться результата.

Проверить по шагам: ролик пришёл; индонезийская речь разборчива; оригинал слышен фоном, но не мешает; реплики попадают в свои места; отчёт совпадает с тем, что слышно.

- [ ] **Шаг 8: Откалибровать `CHARS_PER_SEC`**

Взять из логов (или из задачи в Blob) реплики смоука: длину `id` в знаках и измеренную `durSec`. Посчитать медиану `длина / durSec` — это и есть настоящий темп. Если медиана расходится с 15 больше чем на единицу, поправить константу в `lib/fit.ts` и закоммитить с реальными цифрами в теле коммита.

```bash
curl -s "https://<домен>/api/probe" > /dev/null  # прогрев
# цифры взять из задачи: dub/jobs/<jobId>.json, поля cues[].id и tempo
```

- [ ] **Шаг 9: Обновить README**

Переписать `dub-bot/README.md` под дубляж: что делает бот, три команды, схема конвейера, список переменных окружения, как выбрать другой голос, что означает `trimmedSec` в отчёте. Старый субтитровый текст выбросить целиком.

- [ ] **Шаг 10: Убрать воркtree субтитрового бота**

Ветка `worktree-sub-bot` остаётся в репозитории нетронутой — она ничего не весит и хранит рабочую историю. Убирается только рабочая копия:

```bash
cd /Users/alanalmassuly/Desktop/qurany
git worktree remove --force .claude/worktrees/sub-bot
git worktree prune
```

- [ ] **Шаг 11: Финальный коммит и слияние**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add dub-bot/vercel.json dub-bot/README.md dub-bot/lib/fit.ts
git commit -m "feat(dub-bot): выкатка, калибровка темпа речи и README"
git checkout main && git merge --no-ff feat/dub-bot-v2
```

---

## Порядок и зависимости

```
Задача 1 (каркас)
  ├─> Задача 2 (нарезка реплик) ──┐
  ├─> Задача 3 (укладка) ─────────┤
  ├─> Задача 4 (перевод) ─────────┼─> Задача 7 (конвейер) ─> Задача 8 (бот) ─> Задача 10 (деплой)
  ├─> Задача 5 (синтез) ──────────┤
  └─> Задача 6 (сведение) ────────┴─> Задача 9 (самопроверка)
```

Задачи 2–6 независимы друг от друга и могут идти параллельно разными исполнителями: у каждой свой файл, свой тест и никаких общих правок. Задачи 7 и 8 требуют всех предыдущих. Задача 9 требует только Задачи 6.
