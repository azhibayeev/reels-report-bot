# Telegram-бот субтитров RU → Bahasa Indonesia — план внедрения

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Телеграм-бот принимает вертикальный ролик до 61 секунды с русской речью и возвращает его же со вшитыми индонезийскими субтитрами, показав перевод текстом на утверждение перед рендером.

**Architecture:** Существующий проект `dub-bot/` переименовывается в `sub-bot/`, дубляжная середина вырезается, каркас (вебхук, подписанные токены загрузки, прямая загрузка в Blob, цепочка самовызовов, доставка по трём веткам размера, суточная уборка) переносится как есть. Новая середина — конвейер `ffprobe → Scribe v2 → buildCues → перевод с глоссарием → утверждение в чате → .ass → ffmpeg с libass`. Всё исполняется внутри функций Vercel, состояние в Blob, никакой БД и внешних воркеров.

**Tech Stack:** Next.js 16 (App Router), TypeScript, vitest, Vercel Blob, `ffmpeg-static` + `ffprobe-static`, ElevenLabs Scribe v2, OpenAI GPT-5.1, libass через фильтр `subtitles=`.

**Spec:** `docs/superpowers/specs/2026-08-20-telegram-subtitle-bot-design.md`

## Global Constraints

- Весь код, комментарии, сообщения бота в чат и сообщения коммитов — на русском. Тексты субтитров — на индонезийском.
- Формат коммитов: `тип(scope): описание в повелительном наклонении`, например `feat(sub-bot): собрать реплики из слов Scribe`. Scope для всех задач — `sub-bot`.
- Тесты — vitest, запуск `npm test` из каталога `sub-bot/`. Внешние вызовы (`fetch`, Blob, spawn) всегда мокаются; ffmpeg в тестах не запускается никогда.
- Длительность ролика: потолок **61.0 секунды**, проверяется и в браузере, и через `ffprobe`.
- Геометрия субтитра: ≤ 42 знака на блок, ≤ 2 строки, ≤ 21 знак в строке, длительность блока 0.9–2.6 с, ≤ 17 знаков в секунду, зазор между блоками 100 мс.
- Стиль `.ass` — ровно тот, что в спеке: `PlayResX 1080`, `PlayResY 1920`, `WrapStyle 2`, `ScaledBorderAndShadow yes`, `Fontsize 64`, `Bold 0`, `BorderStyle 1`, `Outline 6.5`, `Shadow 2`, `Alignment 2`, `MarginL/R 130`, `MarginV 480`.
- Салляват пишется словесной формой `SAW`. Лигатура U+FDFA запрещена: глифа нет в шрифте, HarfBuzz нет в сборке.
- SHA256 линуксового бинарника ffmpeg: `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99`. Тег релиза `b6.1.1` версию не отражает — внутри ffmpeg 7.0.2.
- Переменные окружения: `TELEGRAM_SUB_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `SUB_TOKEN_SECRET`, `SUB_BASE_URL`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`. Необязательные: `SUB_FFMPEG_PATH`, `SUB_FFPROBE_PATH`, `SUB_FONT_PATH`.
- Проект Vercel — на плане Pro (команда `alanalmas82-6453s-projects`), поэтому `maxDuration: 800` и Performance 2 vCPU / 4 ГБ доступны.

---

## Структура файлов

Каталог `sub-bot/`.

| Файл | Ответственность |
| --- | --- |
| `lib/config.ts` | Чтение обязательных переменных, белый список чатов, базовый URL |
| `lib/tokens.ts` | HMAC-подписи: токен загрузки (30 мин) и ключ самовызова |
| `lib/telegram.ts` | Вызовы Bot API, три ветки доставки видео по размеру |
| `lib/binaries.ts` | Резолв путей ffmpeg / ffprobe / шрифта + сверка SHA256 |
| `lib/probe.ts` | Четыре проверки среды на проде |
| `lib/media.ts` | `ffprobe`: длительность и наличие звуковой дорожки |
| `lib/scribe.ts` | ElevenLabs Scribe v2 → слова с таймкодами |
| `lib/cues.ts` | Границы блоков по русскому, переносы строк по индонезийскому |
| `lib/glossary.ts` | Загрузка и фильтрация глоссария под конкретный текст |
| `lib/sacred.ts` | Детектор сакральных фрагментов |
| `lib/validate.ts` | Детерминированные проверки перевода и геометрии |
| `lib/translate.ts` | Посегментный перевод через OpenAI |
| `lib/ass.ts` | Генерация файла `.ass` |
| `lib/render.ts` | Сборка аргументов ffmpeg и запуск |
| `lib/jobs.ts` | Модель задачи, статусы, дедлайны, хранение в Blob |
| `lib/commands.ts` | Разбор команд и правок, отрисовка списка реплик |
| `lib/pipeline.ts` | Оркестрация: от загруженного файла до статуса `awaiting` |
| `lib/deliver.ts` | Рендер и доставка результата |
| `lib/cleanup.ts` | Суточная уборка с раздельными дедлайнами |
| `assets/PlusJakartaSans-ExtraBold.ttf` | Шрифт субтитров |
| `assets/glossary.ru-id.json` | Глоссарий терминов |
| `app/api/telegram/route.ts` | Вебхук |
| `app/api/upload/route.ts` | Выдача токена клиентской загрузки в Blob |
| `app/api/probe/route.ts` | Проверка среды |
| `app/api/sub/start/route.ts` | Запуск конвейера |
| `app/api/sub/render/route.ts` | Рендер с полным бюджетом вызова |
| `app/api/cleanup/route.ts` | Крон уборки |
| `app/u/[token]/page.tsx` + `upload-form.tsx` | Страница загрузки |

---

## Порядок и гейт

Задачи 1–3 доводятся до прода и **probe должен пройти**, прежде чем начинается задача 4. Если probe покажет, что `subtitles=` не работает или шрифт не находится, дальнейший план недействителен: середина переезжает на PNG-оверлеи через `@napi-rs/canvas`, и план переписывается. Смысл гейта в том, чтобы узнать это на третьей задаче, а не на пятнадцатой.

---

### Task 1: Переименовать каркас и вырезать дубляж

**Files:**
- Rename: `dub-bot/` → `sub-bot/` (целиком, `git mv`)
- Delete: `sub-bot/lib/elevenlabs.ts`, `sub-bot/lib/credits.ts`, `sub-bot/lib/balance.ts`, `sub-bot/tests/elevenlabs.test.ts`, `sub-bot/tests/credits.test.ts`, `sub-bot/tests/balance.test.ts`, `sub-bot/app/api/balance/route.ts`, `sub-bot/app/api/dub/` (целиком)
- Modify: `sub-bot/lib/config.ts`, `sub-bot/lib/tokens.ts`, `sub-bot/lib/jobs.ts`, `sub-bot/lib/tick.ts`, `sub-bot/lib/commands.ts`, `sub-bot/lib/cleanup.ts`, `sub-bot/lib/start.ts`, `sub-bot/package.json`, `sub-bot/.env.example`, `sub-bot/README.md`
- Test: существующие `sub-bot/tests/*.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: каркас с переменными `SUB_TOKEN_SECRET`, `SUB_BASE_URL`, `TELEGRAM_SUB_BOT_TOKEN`; префиксы Blob `sub/jobs/`, `sub/sources/`, `sub/results/`; функции `requireEnv(name: string): string`, `allowedChatIds(): number[]`, `baseUrl(): string`, `uploadToken(chatId: number, secret: string): string`, `tickKey(jobId: string, secret: string): string`

- [ ] **Step 1: Переименовать каталог**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git mv dub-bot sub-bot
```

- [ ] **Step 2: Удалить дубляжные модули и роуты**

```bash
cd sub-bot
git rm lib/elevenlabs.ts lib/credits.ts lib/balance.ts
git rm tests/elevenlabs.test.ts tests/credits.test.ts tests/balance.test.ts
git rm -r app/api/balance app/api/dub
```

- [ ] **Step 3: Переименовать переменные и префиксы во всех оставшихся файлах**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
grep -rl 'DUB_TOKEN_SECRET\|DUB_BASE_URL\|TELEGRAM_DUB_BOT_TOKEN' lib app tests .env.example \
  | xargs sed -i '' \
    -e 's/DUB_TOKEN_SECRET/SUB_TOKEN_SECRET/g' \
    -e 's/DUB_BASE_URL/SUB_BASE_URL/g' \
    -e 's/TELEGRAM_DUB_BOT_TOKEN/TELEGRAM_SUB_BOT_TOKEN/g'
grep -rl '"dub/' lib app tests | xargs sed -i '' -e 's|"dub/|"sub/|g'
sed -i '' -e 's/"name": "dub-bot"/"name": "sub-bot"/' package.json
```

- [ ] **Step 4: Убрать из `lib/jobs.ts` дубляжное поле и статус**

В интерфейсе `Job` удалить строку `dubbingId: string | null;`. В типе `JobStatus` удалить `"dubbing"`. Оставить `"pending" | "delivering" | "done" | "failed"` — новые статусы добавит Task 10.

- [ ] **Step 5: Вычистить импорты, которые указывают на удалённые файлы**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
grep -rn 'elevenlabs\|credits\|balance' lib app tests || echo "чисто"
```

Каждое найденное вхождение удалить вместе с кодом, который им пользовался: в `lib/start.ts` — проверку кредитов и вызов `createDub`, в `lib/tick.ts` — `getDubStatus`/`downloadDub` и весь цикл опроса, в `lib/commands.ts` — упоминания дубляжа в тексте `/help`. Тело `runTick` временно сводится к заглушке, которая просто завершается: рендер вернёт Task 13.

- [ ] **Step 6: Проверить, что сборка и оставшиеся тесты зелёные**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx tsc --noEmit && npm test`
Expected: компиляция без ошибок, тесты `jobs`, `telegram`, `tokens`, `commands`, `cleanup`, `start`, `tick` проходят или удалены вместе с проверявшимся кодом. Ни одного упавшего теста.

- [ ] **Step 7: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add -A sub-bot
git commit -m "refactor(sub-bot): переименовать проект и вырезать дубляж"
```

---

### Task 2: Бинарники, шрифт и сверка SHA256

**Files:**
- Create: `sub-bot/lib/binaries.ts`, `sub-bot/tests/binaries.test.ts`
- Create: `sub-bot/assets/PlusJakartaSans-ExtraBold.ttf`, `sub-bot/assets/PlusJakartaSans.LICENSE.txt`
- Modify: `sub-bot/package.json`, `sub-bot/next.config.ts`

**Interfaces:**
- Consumes: `requireEnv` из Task 1
- Produces: `ffmpegPath(): string`, `ffprobePath(): string`, `fontPath(): string`, `assertFfmpegHash(path: string): Promise<void>`, константа `FFMPEG_SHA256`

- [ ] **Step 1: Поставить зависимости и положить шрифт**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
npm i ffmpeg-static@^5.3.0 ffprobe-static@^3.1.0
mkdir -p assets
curl -sSL -o /tmp/pjs.zip "https://github.com/tokotype/PlusJakartaSans/archive/refs/heads/master.zip"
unzip -o -j /tmp/pjs.zip '*/fonts/ttf/PlusJakartaSans-ExtraBold.ttf' -d assets
unzip -o -j /tmp/pjs.zip '*/OFL.txt' -d assets && mv assets/OFL.txt assets/PlusJakartaSans.LICENSE.txt
ls -la assets
```

Если в архиве другая раскладка каталогов — найти файл `PlusJakartaSans-ExtraBold.ttf` внутри распакованного архива и скопировать вручную. Нужен **статический** TTF, не variable: variable-шрифт `@napi-rs/canvas` и libass молча отрисуют как Regular.

- [ ] **Step 2: Записать внутреннее имя семейства из name-таблицы**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
node -e '
const b=require("fs").readFileSync("assets/PlusJakartaSans-ExtraBold.ttf");
const num=b.readUInt16BE(4);let off=12,nameOff=null,nameLen=null;
for(let i=0;i<num;i++,off+=16){if(b.toString("ascii",off,off+4)==="name"){nameOff=b.readUInt32BE(off+8);nameLen=b.readUInt32BE(off+12);}}
const count=b.readUInt16BE(nameOff+2),strOff=nameOff+b.readUInt16BE(nameOff+4);
for(let i=0;i<count;i++){const r=nameOff+6+i*12,id=b.readUInt16BE(r+6);
 if(id===1||id===4){const len=b.readUInt16BE(r+8),o=strOff+b.readUInt16BE(r+10);
  const enc=b.readUInt16BE(r+2)===1||b.readUInt16BE(r)===3?"utf16le":"ascii";
  let s=b.toString(enc==="utf16le"?"utf16le":"ascii",o,o+len);
  if(enc==="utf16le")s=Buffer.from(b.subarray(o,o+len)).swap16().toString("utf16le");
  console.log("nameID",id,"=",JSON.stringify(s));}}'
```

Expected: значение `nameID 1` (family). Именно оно должно стоять в `Fontname` стиля `.ass`. Записать его в комментарий в `lib/ass.ts` при Task 5. Если оно окажется не `Plus Jakarta Sans ExtraBold`, а, скажем, `Plus Jakarta Sans` — использовать то, что вернула name-таблица.

- [ ] **Step 3: Написать падающий тест на резолв и хеш**

Создать `sub-bot/tests/binaries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { ffmpegPath, ffprobePath, fontPath, FFMPEG_SHA256 } from "../lib/binaries";

describe("binaries", () => {
  it("находит все три файла", () => {
    expect(existsSync(ffmpegPath())).toBe(true);
    expect(existsSync(ffprobePath())).toBe(true);
    expect(existsSync(fontPath())).toBe(true);
  });

  it("держит зафиксированный хеш линуксовой сборки", () => {
    expect(FFMPEG_SHA256).toBe(
      "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99"
    );
  });

  it("уважает переопределение путей через окружение", () => {
    process.env.SUB_FONT_PATH = "/nope/font.ttf";
    expect(fontPath()).toBe("/nope/font.ttf");
    delete process.env.SUB_FONT_PATH;
  });
});
```

- [ ] **Step 4: Запустить тест и убедиться, что он падает**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/binaries.test.ts`
Expected: FAIL — `Cannot find module '../lib/binaries'`

- [ ] **Step 5: Реализовать `lib/binaries.ts`**

```ts
import { createHash } from "node:crypto";
import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";

// SHA256 ассета ffmpeg-linux-x64 из релиза b6.1.1. Тег версию НЕ отражает:
// внутри ffmpeg 7.0.2 от johnvansickle. Именно от версии зависит набор
// фильтров (в 7.0 drawtext потребовал HarfBuzz и не собрался), поэтому
// сверяем файл по хешу, а не доверяем тегу.
export const FFMPEG_SHA256 =
  "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99";

// Дефолтный экспорт ffmpeg-static посчитан на сборке и в проде указывает
// не туда — поэтому он последний кандидат, а не первый.
function firstExisting(name: string, candidates: string[]): string {
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(`${name} не найден. Искал: ${candidates.filter(Boolean).join(", ")}`);
}

export function ffmpegPath(): string {
  let bundled = "";
  try {
    bundled = (require("ffmpeg-static") as string) || "";
  } catch {
    bundled = "";
  }
  return firstExisting("ffmpeg", [
    process.env.SUB_FFMPEG_PATH || "",
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    bundled,
  ]);
}

export function ffprobePath(): string {
  // ffprobe-static не импортируем: у пакета нет типов, tsc падает на импорте.
  return firstExisting("ffprobe", [
    process.env.SUB_FFPROBE_PATH || "",
    join(
      process.cwd(),
      "node_modules",
      "ffprobe-static",
      "bin",
      process.platform,
      process.arch,
      "ffprobe"
    ),
  ]);
}

export function fontPath(): string {
  return firstExisting("шрифт", [
    process.env.SUB_FONT_PATH || "",
    join(process.cwd(), "assets", "PlusJakartaSans-ExtraBold.ttf"),
  ]);
}

export async function ffmpegHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
```

- [ ] **Step 6: Запустить тест — должен пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/binaries.test.ts`
Expected: PASS, 3 теста. Локально на macOS хеш файла не совпадёт с `FFMPEG_SHA256` — это ожидаемо, там другая сборка; сверка хеша выполняется только на проде в probe.

- [ ] **Step 7: Прописать трассировку файлов в бандл**

В `sub-bot/next.config.ts` добавить в конфиг:

```ts
outputFileTracingIncludes: {
  "/api/probe": [
    "./node_modules/ffmpeg-static/ffmpeg",
    "./node_modules/ffprobe-static/bin/**",
    "./assets/**",
  ],
  "/api/sub/render": [
    "./node_modules/ffmpeg-static/ffmpeg",
    "./node_modules/ffprobe-static/bin/**",
    "./assets/**",
  ],
  "/api/sub/start": ["./node_modules/ffprobe-static/bin/**"],
},
```

Без этого Next не положит бинарники и шрифт в функцию — это уже проходили в ферме.

- [ ] **Step 8: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): резолв бинарников, шрифт и фиксация хеша ffmpeg"
```

---

### Task 3: Probe-эндпоинт и гейт на проде

**Files:**
- Create: `sub-bot/lib/probe.ts`, `sub-bot/tests/probe.test.ts`, `sub-bot/app/api/probe/route.ts`
- Modify: `sub-bot/vercel.json`

**Interfaces:**
- Consumes: `ffmpegPath`, `ffprobePath`, `fontPath`, `ffmpegHash`, `FFMPEG_SHA256` из Task 2; `tickKey` из Task 1
- Produces: `fontFamily(ttfPath: string): string`, `runProbe(): Promise<ProbeReport>`, тип `ProbeReport`

- [ ] **Step 1: Написать падающий тест на чтение name-таблицы**

Создать `sub-bot/tests/probe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fontFamily } from "../lib/probe";
import { fontPath } from "../lib/binaries";

describe("fontFamily", () => {
  it("читает имя семейства из name-таблицы TTF", () => {
    const family = fontFamily(fontPath());
    expect(family.length).toBeGreaterThan(0);
    expect(family).toMatch(/Jakarta/i);
  });

  it("на файле, который не TTF, бросает понятную ошибку", () => {
    expect(() => fontFamily("/etc/hosts")).toThrow(/name-таблиц/i);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/probe.test.ts`
Expected: FAIL — модуль `../lib/probe` не найден

- [ ] **Step 3: Реализовать `lib/probe.ts`**

```ts
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegPath, ffprobePath, fontPath, ffmpegHash, FFMPEG_SHA256 } from "./binaries";

export interface ProbeReport {
  ffmpeg: string;
  ffprobe: string;
  font: string;
  ffmpegSha256: string;
  hashMatches: boolean;
  hasSubtitlesFilter: boolean;
  hasDrawtextFilter: boolean;
  fontFamilyFromFile: string;
  tmpFreeMb: number;
  renderOk: boolean;
  renderStderrTail: string;
  frameBase64: string | null;
}

// Внутреннее имя семейства обязано совпадать с Fontname в стиле .ass.
// Расхождение даёт рендер без текста и без ошибки — тихий провал,
// который иначе заметен только глазами на кадре.
export function fontFamily(ttfPath: string): string {
  const b = readFileSync(ttfPath);
  if (b.length < 12) throw new Error("не удалось прочитать name-таблицу: файл слишком мал");
  const numTables = b.readUInt16BE(4);
  let nameOff = 0;
  for (let i = 0, off = 12; i < numTables; i++, off += 16) {
    if (off + 16 > b.length) break;
    if (b.toString("ascii", off, off + 4) === "name") nameOff = b.readUInt32BE(off + 8);
  }
  if (!nameOff) throw new Error("не удалось прочитать name-таблицу: таблица name отсутствует");
  const count = b.readUInt16BE(nameOff + 2);
  const strOff = nameOff + b.readUInt16BE(nameOff + 4);
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platformId = b.readUInt16BE(rec);
    const nameId = b.readUInt16BE(rec + 6);
    if (nameId !== 1) continue;
    const len = b.readUInt16BE(rec + 8);
    const off = strOff + b.readUInt16BE(rec + 10);
    const raw = b.subarray(off, off + len);
    return platformId === 3
      ? Buffer.from(raw).swap16().toString("utf16le")
      : raw.toString("latin1");
  }
  throw new Error("не удалось прочитать name-таблицу: нет записи nameID=1");
}

function run(bin: string, args: string[]): Promise<{ code: number | null; stderr: string; stdout: Buffer }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const out: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d as Buffer));
    p.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-8000);
    });
    p.on("close", (code) => resolve({ code, stderr, stdout: Buffer.concat(out) }));
    p.on("error", (e) => resolve({ code: null, stderr: String(e), stdout: Buffer.alloc(0) }));
  });
}

export async function runProbe(): Promise<ProbeReport> {
  const ffmpeg = ffmpegPath();
  const ffprobe = ffprobePath();
  const font = fontPath();
  const sha = await ffmpegHash(ffmpeg);
  const filters = await run(ffmpeg, ["-hide_banner", "-filters"]);
  const family = fontFamily(font);

  let tmpFreeMb = -1;
  try {
    const s = statfsSync(tmpdir());
    tmpFreeMb = Math.round((Number(s.bavail) * Number(s.bsize)) / 1048576);
  } catch {
    tmpFreeMb = -1;
  }

  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  let renderOk = false;
  let stderrTail = "";
  let frame: string | null = null;
  try {
    const ass = join(dir, "t.ass");
    writeFileSync(
      ass,
      [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        `Style: Sub,${family},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,6.5,2,2,130,130,480,1`,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:00.00,0:00:02.00,Sub,,0,0,0,,Bacalah doa ini\\Nsetelah sholat",
      ].join("\n"),
      "utf8"
    );
    const out = join(dir, "frame.png");
    const r = await run(ffmpeg, [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=0x1b5e20:s=1080x1920:d=2",
      "-vf", `subtitles=${assEscape(ass)}:fontsdir=${assEscape(dir === "" ? "" : fontDir(font))}`,
      "-frames:v", "1",
      out,
    ]);
    renderOk = r.code === 0;
    stderrTail = r.stderr.slice(-600);
    if (renderOk) frame = readFileSync(out).toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    ffmpeg,
    ffprobe,
    font,
    ffmpegSha256: sha,
    hashMatches: sha === FFMPEG_SHA256,
    hasSubtitlesFilter: /(^|\s)subtitles(\s|$)/m.test(filters.stdout.toString() + filters.stderr),
    hasDrawtextFilter: /(^|\s)drawtext(\s|$)/m.test(filters.stdout.toString() + filters.stderr),
    fontFamilyFromFile: family,
    tmpFreeMb,
    renderOk,
    renderStderrTail: stderrTail,
    frameBase64: frame,
  };
}

function fontDir(p: string): string {
  return p.slice(0, p.lastIndexOf("/"));
}

// В filtergraph двоеточие разделяет опции, а обратный слэш экранирует.
// Путь, попавший внутрь subtitles=, обязан быть экранирован, иначе
// /var/task/... с двоеточием в имени разъедет фильтр.
export function assEscape(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/probe.test.ts`
Expected: PASS, 2 теста

- [ ] **Step 5: Написать роут**

Создать `sub-bot/app/api/probe/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { runProbe } from "../../../lib/probe";
import { tickKey } from "../../../lib/tokens";
import { requireEnv } from "../../../lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (key !== tickKey("probe", requireEnv("SUB_TOKEN_SECRET"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const want = req.nextUrl.searchParams.get("frame") === "1";
  const report = await runProbe();
  return NextResponse.json(want ? report : { ...report, frameBase64: null });
}
```

- [ ] **Step 6: Задеплоить и создать проект на Vercel**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
vercel link --yes
vercel env add SUB_TOKEN_SECRET production   # значение: openssl rand -hex 32
vercel deploy --prod
```

Blob-хранилище подключить в дашборде проекта — `BLOB_READ_WRITE_TOKEN` появится автоматически.

- [ ] **Step 7: Прогнать probe на проде — это гейт**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
SECRET=$(vercel env pull /dev/stdout --environment=production 2>/dev/null | grep SUB_TOKEN_SECRET | cut -d= -f2 | tr -d '"')
KEY=$(node -e 'console.log(require("crypto").createHmac("sha256",process.argv[1]).update("tick.probe").digest("base64url"))' "$SECRET")
curl -sS "https://<домен>/api/probe?key=$KEY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'
```

Expected — обязательные значения:
- `hasSubtitlesFilter: true` — **без этого план недействителен**
- `hashMatches: true` — совпал зафиксированный хеш
- `renderOk: true`
- `fontFamilyFromFile` — непустая строка; запомнить её, она пойдёт в `Fontname`
- `hasDrawtextFilter: false` — ожидаемо, подтверждает, что сборка та самая
- `tmpFreeMb` — записать в README, ожидается около 500

- [ ] **Step 8: Посмотреть кадр глазами**

```bash
curl -sS "https://<домен>/api/probe?key=$KEY&frame=1" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);require("fs").writeFileSync("/tmp/probe.png",Buffer.from(j.frameBase64,"base64"))})'
open /tmp/probe.png
```

Expected: белый текст в две строки с чёрной обводкой, в нижней трети кадра. Пустой зелёный кадр означает, что libass не нашёл шрифт — план останавливается, пока это не починено.

- [ ] **Step 9: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): probe среды с проверкой libass, шрифта и хеша"
```

---

### Task 4: Границы блоков и переносы строк

**Files:**
- Create: `sub-bot/lib/cues.ts`, `sub-bot/tests/cues.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: типы `Word`, `Cue`; `buildCues(words: Word[]): Cue[]`; `fitLines(text: string): string[] | null`; константы `MAX_CHARS`, `MAX_LINES`, `MAX_CHARS_PER_LINE`, `MIN_DUR_SEC`, `MAX_DUR_SEC`, `MAX_CPS`, `GAP_SEC`, `PAUSE_BREAK_SEC`

- [ ] **Step 1: Написать падающие тесты**

Создать `sub-bot/tests/cues.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCues, fitLines, MAX_DUR_SEC } from "../lib/cues";
import type { Word } from "../lib/cues";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("buildCues", () => {
  it("режет блок по паузе длиннее 300 мс", () => {
    const cues = buildCues([w("Читай", 0, 0.4), w("дуа", 0.4, 0.8), w("после", 1.3, 1.7)]);
    expect(cues).toHaveLength(2);
    expect(cues[0].ru).toBe("Читай дуа");
    expect(cues[1].ru).toBe("после");
  });

  it("не режет по паузе короче 300 мс", () => {
    const cues = buildCues([w("Читай", 0, 0.4), w("дуа", 0.6, 1.0)]);
    expect(cues).toHaveLength(1);
  });

  it("режет по концу предложения даже без паузы", () => {
    const cues = buildCues([w("Читай.", 0, 0.4), w("Потом", 0.45, 0.9)]);
    expect(cues).toHaveLength(2);
  });

  it("режет блок, который вышел длиннее потолка длительности", () => {
    const words: Word[] = [];
    for (let i = 0; i < 10; i++) words.push(w(`слово${i}`, i * 0.5, i * 0.5 + 0.45));
    const cues = buildCues(words);
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(MAX_DUR_SEC + 0.001);
  });

  it("нумерует реплики с единицы и подряд", () => {
    const cues = buildCues([w("раз.", 0, 0.4), w("два.", 0.8, 1.2), w("три.", 1.6, 2.0)]);
    expect(cues.map((c) => c.i)).toEqual([1, 2, 3]);
  });

  it("оставляет зазор между соседними блоками", () => {
    const cues = buildCues([w("раз.", 0, 0.5), w("два", 0.55, 1.6)]);
    expect(cues[1].start - cues[0].end).toBeGreaterThanOrEqual(0.05);
  });

  it("тянет слишком короткий блок до нижней границы", () => {
    const cues = buildCues([w("Да.", 0, 0.2)]);
    expect(cues[0].end - cues[0].start).toBeGreaterThanOrEqual(0.9);
  });

  it("на пустом входе возвращает пустой список", () => {
    expect(buildCues([])).toEqual([]);
  });
});

describe("fitLines", () => {
  it("короткую фразу оставляет одной строкой", () => {
    expect(fitLines("Bacalah doa")).toEqual(["Bacalah doa"]);
  });

  it("ломает на две строки по ширине", () => {
    const lines = fitLines("Bacalah doa ini setelah sholat");
    expect(lines).not.toBeNull();
    expect(lines!.length).toBe(2);
    for (const l of lines!) expect(l.length).toBeLessThanOrEqual(21);
  });

  it("ставит разрыв перед союзом, а не после", () => {
    const lines = fitLines("Bersabarlah karena Allah");
    expect(lines).not.toBeNull();
    expect(lines![1].startsWith("karena")).toBe(true);
  });

  it("не разрывает редупликацию через дефис", () => {
    const lines = fitLines("Jagalah anak-anak kalian");
    expect(lines).not.toBeNull();
    for (const l of lines!) expect(l.startsWith("-")).toBe(false);
  });

  it("возвращает null, если текст не влезает в два раза по 21", () => {
    expect(fitLines("Ini kalimat yang sangat panjang sekali dan tidak muat")).toBeNull();
  });

  it("возвращает null на слове длиннее строки", () => {
    expect(fitLines("pertanggungjawabannya kepada")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/cues.test.ts`
Expected: FAIL — модуль `../lib/cues` не найден

- [ ] **Step 3: Реализовать `lib/cues.ts`**

```ts
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  i: number;
  start: number;
  end: number;
  ru: string;
  id: string | null;
  needsManual: boolean;
  warning: string | null;
}

export const MAX_CHARS = 42;
export const MAX_LINES = 2;
export const MAX_CHARS_PER_LINE = 21;
export const MIN_DUR_SEC = 0.9;
export const MAX_DUR_SEC = 2.6;
export const MAX_CPS = 17;
export const GAP_SEC = 0.1;
export const PAUSE_BREAK_SEC = 0.3;

const SENTENCE_END = /[.!?…]$/;
const CLAUSE_END = /[:;]$/;

// Индонезийские союзы и подчинительные слова: разрыв строки ставится ПЕРЕД
// ними, не после. Список применяется к переводу, а не к русскому источнику —
// границы блоков режутся по русскому, переносы внутри блока по индонезийскому.
const ID_CONJUNCTIONS = new Set([
  "dan", "atau", "tapi", "tetapi", "namun", "karena", "sehingga", "yang",
  "untuk", "agar", "supaya", "jika", "kalau", "ketika", "lalu", "kemudian",
  "sedangkan",
]);

// Уровень 1: границы блоков по русским словам с таймкодами.
export function buildCues(words: Word[]): Cue[] {
  if (words.length === 0) return [];

  const groups: Word[][] = [];
  let current: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const next = words[i + 1];
    if (!next) break;

    const pause = next.start - words[i].end;
    const breakHere =
      pause >= PAUSE_BREAK_SEC ||
      SENTENCE_END.test(words[i].text) ||
      CLAUSE_END.test(words[i].text) ||
      next.end - current[0].start > MAX_DUR_SEC;

    if (breakHere) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  const split = groups.flatMap(splitLongGroup);

  const cues: Cue[] = split.map((g, idx) => ({
    i: idx + 1,
    start: g[0].start,
    end: g[g.length - 1].end,
    ru: g.map((x) => x.text).join(" "),
    id: null,
    needsManual: false,
    warning: null,
  }));

  return enforceTiming(cues);
}

// Группа длиннее потолка режется по самой длинной межсловной паузе внутри неё.
function splitLongGroup(group: Word[]): Word[][] {
  const dur = group[group.length - 1].end - group[0].start;
  if (dur <= MAX_DUR_SEC || group.length < 2) return [group];

  let bestIdx = Math.floor(group.length / 2);
  let bestPause = -1;
  for (let i = 0; i < group.length - 1; i++) {
    const pause = group[i + 1].start - group[i].end;
    if (pause > bestPause) {
      bestPause = pause;
      bestIdx = i;
    }
  }
  const left = group.slice(0, bestIdx + 1);
  const right = group.slice(bestIdx + 1);
  return [...splitLongGroup(left), ...splitLongGroup(right)];
}

// Нижняя граница длительности и зазор между блоками. Верхнюю границу уже
// обеспечил splitLongGroup, поэтому здесь только растягиваем короткие
// и не даём соседям слипнуться.
function enforceTiming(cues: Cue[]): Cue[] {
  const out = cues.map((c) => ({ ...c }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].end - out[i].start < MIN_DUR_SEC) {
      out[i].end = out[i].start + MIN_DUR_SEC;
    }
    const next = out[i + 1];
    if (next && next.start - out[i].end < GAP_SEC) {
      out[i].end = Math.max(out[i].start + 0.4, next.start - GAP_SEC);
    }
  }
  return out;
}

// Уровень 2: переносы строк внутри блока по индонезийскому тексту.
// Возвращает null, если текст физически не помещается — тогда блок
// получает warning и ждёт правки руками.
export function fitLines(text: string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.some((w) => w.length > MAX_CHARS_PER_LINE)) return null;

  const joined = words.join(" ");
  if (joined.length <= MAX_CHARS_PER_LINE) return [joined];
  if (joined.length > MAX_CHARS) return null;

  // Кандидаты на разрыв: сначала позиции перед союзом, потом все остальные.
  const positions = Array.from({ length: words.length - 1 }, (_, i) => i + 1);
  const preferred = positions.filter((p) =>
    ID_CONJUNCTIONS.has(words[p].toLowerCase().replace(/[.,!?;:]+$/, ""))
  );

  for (const list of [preferred, positions]) {
    for (const p of list) {
      const first = words.slice(0, p).join(" ");
      const second = words.slice(p).join(" ");
      if (first.length <= MAX_CHARS_PER_LINE && second.length <= MAX_CHARS_PER_LINE) {
        return [first, second];
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/cues.test.ts`
Expected: PASS, 14 тестов

- [ ] **Step 5: Проверить компиляцию**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx tsc --noEmit`
Expected: без ошибок

- [ ] **Step 6: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): нарезка реплик по паузам и переносы строк"
```

---

### Task 5: Генерация файла .ass

**Files:**
- Create: `sub-bot/lib/ass.ts`, `sub-bot/tests/ass.test.ts`

**Interfaces:**
- Consumes: `Cue`, `fitLines`, `MAX_CHARS_PER_LINE` из Task 4
- Produces: `buildAss(cues: Cue[], fontFamily: string): string`, `assTime(sec: number): string`, `escapeText(s: string): string`

- [ ] **Step 1: Написать падающие тесты**

Создать `sub-bot/tests/ass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAss, assTime, escapeText } from "../lib/ass";
import type { Cue } from "../lib/cues";

const cue = (over: Partial<Cue> = {}): Cue => ({
  i: 1, start: 0.42, end: 2.61, ru: "Читай дуа",
  id: "Bacalah doa ini", needsManual: false, warning: null, ...over,
});

describe("assTime", () => {
  it("форматирует ноль", () => expect(assTime(0)).toBe("0:00:00.00"));
  it("форматирует сотые", () => expect(assTime(2.61)).toBe("0:00:02.61"));
  it("переходит через минуту", () => expect(assTime(61.5)).toBe("0:01:01.50"));
  it("переходит через час", () => expect(assTime(3661.25)).toBe("1:01:01.25"));
});

describe("escapeText", () => {
  it("экранирует фигурные скобки", () => {
    expect(escapeText("a {b} c")).toBe("a \\{b\\} c");
  });
  it("превращает перевод строки в \\N", () => {
    expect(escapeText("a\nb")).toBe("a\\Nb");
  });
});

describe("buildAss", () => {
  it("кладёт имя семейства в стиль", () => {
    expect(buildAss([cue()], "Plus Jakarta Sans ExtraBold"))
      .toContain("Style: Sub,Plus Jakarta Sans ExtraBold,64,");
  });

  it("держит WrapStyle 2 и разрешение кадра", () => {
    const out = buildAss([cue()], "F");
    expect(out).toContain("WrapStyle: 2");
    expect(out).toContain("PlayResX: 1080");
    expect(out).toContain("PlayResY: 1920");
  });

  it("даёт по строке Dialogue на реплику", () => {
    const out = buildAss([cue({ i: 1 }), cue({ i: 2, id: "Kedua" })], "F");
    expect(out.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(2);
  });

  it("ставит \\N там, где решил fitLines", () => {
    const out = buildAss([cue({ id: "Bacalah doa ini setelah sholat" })], "F");
    expect(out).toMatch(/Dialogue:.*\\N/);
  });

  it("пропускает реплики без перевода", () => {
    const out = buildAss([cue({ id: null, needsManual: true })], "F");
    expect(out.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/ass.test.ts`
Expected: FAIL — модуль `../lib/ass` не найден

- [ ] **Step 3: Реализовать `lib/ass.ts`**

```ts
import { Cue, fitLines } from "./cues";

export function assTime(sec: number): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const cc = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

// В .ass фигурные скобки открывают блок тегов override, поэтому текст,
// пришедший от человека или модели, обязан быть экранирован — иначе
// случайная скобка съест кусок реплики.
export function escapeText(s: string): string {
  return s.replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

export function buildAss(cues: Cue[], fontFamily: string): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Sub,${fontFamily},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,6.5,2,2,130,130,480,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = cues
    .filter((c) => c.id && c.id.trim().length > 0)
    .map((c) => {
      // WrapStyle 2 отключает автоперенос: строки ломает fitLines, тот же
      // код, что проверяет лимит знаков. Не влезло — печатаем одной строкой,
      // она вылезет за поля и будет видна. Молчаливой перевёрстки быть не должно.
      const lines = fitLines(c.id as string) ?? [c.id as string];
      const text = escapeText(lines.join("\n"));
      return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${text}`;
    });

  return [...header, ...events, ""].join("\n");
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/ass.test.ts`
Expected: PASS, 11 тестов

- [ ] **Step 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): генерация файла .ass со стилем субтитров"
```

---

### Task 6: Запуск ffmpeg и разбор медиа

**Files:**
- Create: `sub-bot/lib/render.ts`, `sub-bot/lib/media.ts`, `sub-bot/tests/render.test.ts`, `sub-bot/tests/media.test.ts`

**Interfaces:**
- Consumes: `ffmpegPath`, `ffprobePath`, `fontPath` из Task 2; `assEscape` из Task 3
- Produces: тип `Runner = (bin: string, args: string[]) => Promise<{code: number|null, stderr: string, stdout: string}>`; `spawnRunner: Runner`; `renderArgs(o: RenderOpts): string[]`; `renderSubs(run: Runner, o: RenderOpts): Promise<void>`; `probeMedia(run: Runner, path: string): Promise<{durationSec: number, hasAudio: boolean}>`; `MAX_DURATION_SEC = 61.0`

- [ ] **Step 1: Написать падающие тесты на аргументы и разбор**

Создать `sub-bot/tests/render.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderArgs, renderSubs } from "../lib/render";

const opts = {
  srcPath: "/tmp/x/src.mp4",
  assPath: "/tmp/x/cues.ass",
  fontsDir: "/var/task/assets",
  outPath: "/tmp/x/out.mp4",
  preset: "veryfast" as const,
};

describe("renderArgs", () => {
  it("не трогает звук", () => {
    expect(renderArgs(opts)).toContain("copy");
    const a = renderArgs(opts);
    expect(a[a.indexOf("-c:a") + 1]).toBe("copy");
  });

  it("вшивает субтитры фильтром subtitles с fontsdir", () => {
    const a = renderArgs(opts);
    const vf = a[a.indexOf("-vf") + 1];
    expect(vf).toContain("subtitles=");
    expect(vf).toContain("fontsdir=");
  });

  it("экранирует двоеточия в путях", () => {
    const a = renderArgs({ ...opts, assPath: "/tmp/a:b/cues.ass" });
    expect(a[a.indexOf("-vf") + 1]).toContain("a\\:b");
  });

  it("ставит переданный пресет", () => {
    expect(renderArgs({ ...opts, preset: "ultrafast" })).toContain("ultrafast");
  });

  it("готовит файл к быстрому старту в плеере", () => {
    expect(renderArgs(opts)).toContain("+faststart");
  });
});

describe("renderSubs", () => {
  it("на ненулевом коде бросает ошибку с хвостом stderr", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stderr: "boom".repeat(400), stdout: "" });
    await expect(renderSubs(run, opts)).rejects.toThrow(/ffmpeg вышел с кодом 1/);
  });

  it("на нулевом коде не бросает", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stderr: "", stdout: "" });
    await expect(renderSubs(run, opts)).resolves.toBeUndefined();
  });
});
```

Создать `sub-bot/tests/media.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { probeMedia } from "../lib/media";

const json = (o: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify(o) });

describe("probeMedia", () => {
  it("читает длительность и наличие звука", async () => {
    const run = vi.fn().mockResolvedValue(
      json({ format: { duration: "47.2" }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] })
    );
    expect(await probeMedia(run, "/tmp/a.mp4")).toEqual({ durationSec: 47.2, hasAudio: true });
  });

  it("видит отсутствие звуковой дорожки", async () => {
    const run = vi.fn().mockResolvedValue(json({ format: { duration: "10" }, streams: [{ codec_type: "video" }] }));
    expect((await probeMedia(run, "/tmp/a.mp4")).hasAudio).toBe(false);
  });

  it("на мусорном выводе бросает ошибку, а не возвращает ноль", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stderr: "", stdout: "не json" });
    await expect(probeMedia(run, "/tmp/a.mp4")).rejects.toThrow(/ffprobe/);
  });

  it("на ненулевом коде бросает ошибку", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stderr: "нет такого файла", stdout: "" });
    await expect(probeMedia(run, "/tmp/a.mp4")).rejects.toThrow(/ffprobe/);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/render.test.ts tests/media.test.ts`
Expected: FAIL — модули не найдены

- [ ] **Step 3: Реализовать `lib/render.ts`**

```ts
import { spawn } from "node:child_process";
import { assEscape } from "./probe";

export interface RunResult {
  code: number | null;
  stderr: string;
  stdout: string;
}
export type Runner = (bin: string, args: string[]) => Promise<RunResult>;

const STDERR_CAP = 8000;

export const spawnRunner: Runner = (bin, args) =>
  new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    p.stdout.on("data", (d) => {
      stdout += String(d);
    });
    p.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-STDERR_CAP);
    });
    p.on("close", (code) => resolve({ code, stderr, stdout }));
    p.on("error", (e) => resolve({ code: null, stderr: String(e), stdout: "" }));
  });

export interface RenderOpts {
  srcPath: string;
  assPath: string;
  fontsDir: string;
  outPath: string;
  preset: "veryfast" | "ultrafast";
}

export function renderArgs(o: RenderOpts): string[] {
  const vf = `subtitles=${assEscape(o.assPath)}:fontsdir=${assEscape(o.fontsDir)}`;
  return [
    "-y",
    "-i", o.srcPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", o.preset,
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    // Звук не трогаем вовсе: перекодирование аудио стоит времени и ничего
    // не даёт — дорожка остаётся русской и без изменений.
    "-c:a", "copy",
    o.outPath,
  ];
}

export async function renderSubs(run: Runner, o: RenderOpts): Promise<void> {
  // Переопределение пути живёт в ffmpegPath() и читает SUB_FFMPEG_PATH —
  // второй развилки здесь быть не должно, иначе переменных станет две.
  const { code, stderr } = await run(ffmpegBin(), renderArgs(o));
  if (code !== 0) throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-600)}`);
}

function ffmpegBin(): string {
  // Ленивый импорт: тесты не должны требовать наличия бинарника.
  return (require("./binaries") as typeof import("./binaries")).ffmpegPath();
}
```

- [ ] **Step 4: Реализовать `lib/media.ts`**

```ts
import { Runner } from "./render";
import { ffprobePath } from "./binaries";

export const MAX_DURATION_SEC = 61.0;

export interface MediaInfo {
  durationSec: number;
  hasAudio: boolean;
}

// Длительность из браузера — оценка; правда только здесь. Порог 61.0, а не
// 60.0: телефонные экспорты «минутного» ролика дают 60.03–60.5 с.
export async function probeMedia(run: Runner, path: string): Promise<MediaInfo> {
  const { code, stderr, stdout } = await run(ffprobePath(), [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  if (code !== 0) throw new Error(`ffprobe вышел с кодом ${code}: ${stderr.slice(-300)}`);

  let parsed: { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe вернул не JSON");
  }

  const durationSec = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSec)) throw new Error("ffprobe не отдал длительность");

  return {
    durationSec,
    hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}
```

- [ ] **Step 5: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/render.test.ts tests/media.test.ts`
Expected: PASS, 11 тестов

- [ ] **Step 6: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): аргументы ffmpeg и разбор медиа через ffprobe"
```

---

### Task 7: Распознавание речи через Scribe v2

**Files:**
- Create: `sub-bot/lib/scribe.ts`, `sub-bot/tests/scribe.test.ts`

**Interfaces:**
- Consumes: `Word` из Task 4
- Produces: `transcribe(apiKey: string, sourceUrl: string): Promise<Word[]>`, `KEYTERMS: string[]`

- [ ] **Step 1: Сверить контракт API живым вызовом**

```bash
curl -sS -X POST "https://api.elevenlabs.io/v1/speech-to-text" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -F "model_id=scribe_v2" \
  -F "source_url=https://<любой публичный mp4 с речью>" \
  -F "language_code=rus" \
  -F "timestamps_granularity=word" | head -c 1200
```

Записать реальные имена полей ответа. Ожидается массив `words` с элементами `{text, type, start, end}`, где `type` бывает `word`, `spacing`, `audio_event`. Если имена другие — поправить парсер в шаге 3, интерфейс наружу (`Word[]`) не меняется.

- [ ] **Step 2: Написать падающие тесты**

Создать `sub-bot/tests/scribe.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { transcribe } from "../lib/scribe";

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });

afterEach(() => vi.unstubAllGlobals());

describe("transcribe", () => {
  it("оставляет только слова, выбрасывая паузы и звуковые события", async () => {
    vi.stubGlobal("fetch", ok({
      words: [
        { text: "Читай", type: "word", start: 0, end: 0.4 },
        { text: " ", type: "spacing", start: 0.4, end: 0.45 },
        { text: "(музыка)", type: "audio_event", start: 0.45, end: 1.2 },
        { text: "дуа", type: "word", start: 1.2, end: 1.6 },
      ],
    }));
    const words = await transcribe("k", "https://x/a.mp4");
    expect(words.map((w) => w.text)).toEqual(["Читай", "дуа"]);
  });

  it("шлёт source_url, язык и keyterms", async () => {
    const f = ok({ words: [] });
    vi.stubGlobal("fetch", f);
    await transcribe("k", "https://x/a.mp4");
    const body = f.mock.calls[0][1].body as FormData;
    expect(body.get("source_url")).toBe("https://x/a.mp4");
    expect(body.get("language_code")).toBe("rus");
    expect(String(body.get("keyterms"))).toContain("дуа");
  });

  it("на ошибке API бросает исключение с кодом", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}),
    }));
    await expect(transcribe("k", "https://x/a.mp4")).rejects.toThrow(/401/);
  });

  it("на ответе без слов возвращает пустой список, а не падает", async () => {
    vi.stubGlobal("fetch", ok({}));
    expect(await transcribe("k", "https://x/a.mp4")).toEqual([]);
  });
});
```

- [ ] **Step 3: Реализовать `lib/scribe.ts`**

```ts
import { Word } from "./cues";

const BASE = "https://api.elevenlabs.io/v1";

// Термины, на которых ошибаться нельзя. Scribe принимает до 1000 штук по
// 50 знаков; надбавка к цене транскрипции 20% — доли цента на ролик.
export const KEYTERMS = [
  "дуа", "зикр", "азкар", "намаз", "салят", "ракаат", "закят", "садака",
  "вакф", "сунна", "суннат", "фард", "тахаджуд", "витр", "иншааллах",
  "альхамдулиллях", "субханаллах", "бисмиллях", "аят", "сура", "хадис",
  "тасбих", "иман", "таква", "умма",
];

export async function transcribe(apiKey: string, sourceUrl: string): Promise<Word[]> {
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  // Файл не гоняем через функцию: тело запроса Vercel ограничено 4.5 МБ,
  // а source_url принимает любой HTTPS, включая ссылку из Blob.
  form.append("source_url", sourceUrl);
  // Язык задан явно: на 60 секундах с фоновой музыкой автоопределение
  // ошибается заметно чаще, чем на длинном аудио.
  form.append("language_code", "rus");
  form.append("timestamps_granularity", "word");
  form.append("keyterms", JSON.stringify(KEYTERMS));

  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Scribe вернул ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    words?: { text: string; type?: string; start?: number; end?: number }[];
  };

  // Музыка и нашид приходят отдельными токенами audio_event и в текст
  // не подмешиваются — ровно то, ради чего выбран Scribe, а не Whisper.
  return (data.words ?? [])
    .filter((w) => w.type === "word" && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ text: w.text.trim(), start: w.start as number, end: w.end as number }))
    .filter((w) => w.text.length > 0);
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/scribe.test.ts`
Expected: PASS, 4 теста

- [ ] **Step 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): распознавание речи через Scribe v2"
```

---

### Task 8: Глоссарий, детектор сакрального и валидатор

**Files:**
- Create: `sub-bot/assets/glossary.ru-id.json`, `sub-bot/lib/glossary.ts`, `sub-bot/lib/sacred.ts`, `sub-bot/lib/validate.ts`
- Create: `sub-bot/tests/glossary.test.ts`, `sub-bot/tests/sacred.test.ts`, `sub-bot/tests/validate.test.ts`

**Interfaces:**
- Consumes: `Cue`, `fitLines`, `MAX_CHARS`, `MAX_CPS` из Task 4
- Produces: тип `Entry = {ru: string[]; id: string; forbidden: string[]; note?: string}`; `loadGlossary(): Entry[]`; `relevant(entries: Entry[], ru: string): Entry[]`; `detectSacred(ru: string): string | null`; `validateCue(cue: Cue, entries: Entry[]): string | null`; `validateSpelling(cues: Cue[]): string | null`

- [ ] **Step 1: Создать глоссарий**

Создать `sub-bot/assets/glossary.ru-id.json`. Орфографический режим — массовый (`sholat`, `dzikir`, `adzan`, `hadits`), как в контенте, который видит аудитория:

```json
[
  {"ru": ["дуа", "мольба", "мольбу", "мольбы"], "id": "doa", "forbidden": ["dua"], "note": "dua по-индонезийски значит «два». Никогда не транслитерировать."},
  {"ru": ["намаз", "молитва", "молитву", "салят"], "id": "sholat", "forbidden": ["salat", "shalat", "sembahyang"], "note": "Держать один режим написания на весь ролик."},
  {"ru": ["суннат", "сунна", "сунну"], "id": "sunnah", "forbidden": ["sunat"], "note": "sunat значит «обрезание»."},
  {"ru": ["закят"], "id": "zakat", "forbidden": [], "note": ""},
  {"ru": ["садака", "милостыня", "милостыню"], "id": "sedekah", "forbidden": [], "note": ""},
  {"ru": ["вакф", "вакуф"], "id": "wakaf", "forbidden": [], "note": ""},
  {"ru": ["зикр", "поминание"], "id": "dzikir", "forbidden": ["zikir"], "note": "Массовый режим — dzikir."},
  {"ru": ["азкар"], "id": "adzkar", "forbidden": [], "note": ""},
  {"ru": ["хадис"], "id": "hadits", "forbidden": ["hadis"], "note": ""},
  {"ru": ["аят"], "id": "ayat", "forbidden": [], "note": ""},
  {"ru": ["сура"], "id": "surah", "forbidden": [], "note": ""},
  {"ru": ["Коран", "Корана", "Коране"], "id": "Al-Qur'an", "forbidden": ["koran"], "note": "koran в нижнем регистре значит «газета»."},
  {"ru": ["награда", "награду", "воздаяние"], "id": "pahala", "forbidden": ["hadiah", "berkat"], "note": "hadiah — подарок, а не награда от Аллаха."},
  {"ru": ["Аллах", "Аллаха", "Аллаху"], "id": "Allah", "forbidden": ["Tuhan"], "note": "Никогда не заменять на Tuhan."},
  {"ru": ["Пророк", "Пророка", "Мухаммад", "Мухаммада"], "id": "Nabi Muhammad SAW", "forbidden": [], "note": "После имени обязателен SAW."},
  {"ru": ["иншаллах", "иншааллах"], "id": "insya Allah", "forbidden": [], "note": ""},
  {"ru": ["альхамдулиллях", "хвала Аллаху"], "id": "alhamdulillah", "forbidden": [], "note": ""},
  {"ru": ["тахаджуд"], "id": "tahajud", "forbidden": [], "note": ""},
  {"ru": ["витр"], "id": "witir", "forbidden": ["ganjil"], "note": "ganjil значит «нечётный», это не название молитвы."},
  {"ru": ["фард", "обязательный"], "id": "fardhu", "forbidden": [], "note": ""},
  {"ru": ["пост", "поста", "ураза"], "id": "puasa", "forbidden": [], "note": ""},
  {"ru": ["разговение", "ифтар"], "id": "buka puasa", "forbidden": ["ifthar"], "note": ""},
  {"ru": ["мечеть", "мечети"], "id": "masjid", "forbidden": ["kuil"], "note": "kuil — храм иной религии."},
  {"ru": ["рай"], "id": "surga", "forbidden": [], "note": ""},
  {"ru": ["ад"], "id": "neraka", "forbidden": [], "note": ""},
  {"ru": ["Судный день", "День суда"], "id": "hari kiamat", "forbidden": ["penghakiman"], "note": ""},
  {"ru": ["покаяние", "тауба"], "id": "taubat", "forbidden": [], "note": ""},
  {"ru": ["терпение", "сабр"], "id": "sabar", "forbidden": [], "note": ""},
  {"ru": ["богобоязненность", "таква"], "id": "takwa", "forbidden": [], "note": ""},
  {"ru": ["умма", "община"], "id": "umat", "forbidden": [], "note": ""}
]
```

- [ ] **Step 2: Написать падающие тесты**

Создать `sub-bot/tests/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateCue, validateSpelling } from "../lib/validate";
import { loadGlossary } from "../lib/glossary";
import type { Cue } from "../lib/cues";

const G = loadGlossary();
const cue = (ru: string, id: string | null): Cue => ({
  i: 1, start: 0, end: 2, ru, id, needsManual: false, warning: null,
});

describe("validateCue", () => {
  it("пропускает корректный перевод", () => {
    expect(validateCue(cue("Читай дуа", "Bacalah doa"), G)).toBeNull();
  });

  it("ловит запрещённый вариант dua", () => {
    expect(validateCue(cue("Читай дуа", "Bacalah dua"), G)).toMatch(/dua/);
  });

  it("не считает berdua запрещённым — это другое слово", () => {
    expect(validateCue(cue("Они вдвоём", "Mereka berdua"), G)).toBeNull();
  });

  it("требует целевой термин, если исходный есть", () => {
    expect(validateCue(cue("Читай дуа", "Bacalah sesuatu"), G)).toMatch(/doa/);
  });

  it("засчитывает термин с индонезийским аффиксом", () => {
    expect(validateCue(cue("Читай дуа", "Berdoalah sekarang"), G)).toBeNull();
  });

  it("требует SAW при упоминании Пророка", () => {
    expect(validateCue(cue("Пророк сказал", "Nabi Muhammad bersabda"), G)).toMatch(/SAW/);
  });

  it("принимает перевод с SAW", () => {
    expect(validateCue(cue("Пророк сказал", "Nabi Muhammad SAW bersabda"), G)).toBeNull();
  });

  it("ловит Tuhan вместо Allah", () => {
    expect(validateCue(cue("Аллах милостив", "Tuhan maha pengasih"), G)).toMatch(/Tuhan/);
  });

  it("ловит блок, который не влезает в кадр", () => {
    const long = "Ini kalimat yang sangat panjang sekali dan sama sekali tidak muat";
    expect(validateCue(cue("Длинно", long), G)).toMatch(/кадр|знак/i);
  });

  it("ловит слишком быструю реплику", () => {
    const c: Cue = { ...cue("Быстро", "Bacalah doa ini setelah sholat"), start: 0, end: 1.0 };
    expect(validateCue(c, G)).toMatch(/быстро|секунд/i);
  });

  it("геометрию проверяет и на ручном тексте", () => {
    const c: Cue = { ...cue("Дуа", "a ".repeat(60).trim()), needsManual: false };
    expect(validateCue(c, G)).not.toBeNull();
  });

  it("реплику без перевода не проверяет терминами", () => {
    expect(validateCue({ ...cue("Бисмилляхи", null), needsManual: true }, G)).toBeNull();
  });
});

describe("validateSpelling", () => {
  it("ловит два режима написания в одном ролике", () => {
    const cues = [cue("а", "Bacalah sholat"), { ...cue("б", "Setelah salat"), i: 2 }];
    expect(validateSpelling(cues)).toMatch(/sholat|salat/);
  });

  it("на едином режиме молчит", () => {
    const cues = [cue("а", "Bacalah sholat"), { ...cue("б", "Setelah sholat"), i: 2 }];
    expect(validateSpelling(cues)).toBeNull();
  });
});
```

Создать `sub-bot/tests/sacred.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectSacred } from "../lib/sacred";

describe("detectSacred", () => {
  it("ловит басмалу", () => {
    expect(detectSacred("Бисмилляхи-р-рахмани-р-рахим")).not.toBeNull();
  });

  it("ловит арабское письмо", () => {
    expect(detectSacred("Он сказал بِسْمِ اللَّهِ")).not.toBeNull();
  });

  it("ловит ссылку на аят", () => {
    expect(detectSacred("В суре Аль-Бакара аят 255 сказано")).not.toBeNull();
  });

  it("обычную фразу со словом Аллах не трогает", () => {
    expect(detectSacred("Аллах любит терпеливых")).toBeNull();
  });

  it("обычную фразу про молитву не трогает", () => {
    expect(detectSacred("Читай эту дуа после молитвы")).toBeNull();
  });
});
```

Создать `sub-bot/tests/glossary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadGlossary, relevant } from "../lib/glossary";

describe("глоссарий", () => {
  it("загружается и не пуст", () => {
    expect(loadGlossary().length).toBeGreaterThanOrEqual(25);
  });

  it("отдаёт только записи, встретившиеся в тексте", () => {
    const r = relevant(loadGlossary(), "Читай дуа после намаза");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("doa");
    expect(ids).toContain("sholat");
    expect(ids).not.toContain("zakat");
  });

  it("на тексте без терминов отдаёт пустой список", () => {
    expect(relevant(loadGlossary(), "Сегодня хорошая погода")).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/validate.test.ts tests/sacred.test.ts tests/glossary.test.ts`
Expected: FAIL — модули не найдены

- [ ] **Step 4: Реализовать `lib/glossary.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Entry {
  ru: string[];
  id: string;
  forbidden: string[];
  note?: string;
}

let cache: Entry[] | null = null;

export function loadGlossary(): Entry[] {
  if (cache) return cache;
  const path = join(process.cwd(), "assets", "glossary.ru-id.json");
  cache = JSON.parse(readFileSync(path, "utf8")) as Entry[];
  return cache;
}

// В промпт уходит 5–15 записей, а не весь список: гигантский словарь
// модель начинает игнорировать.
export function relevant(entries: Entry[], ru: string): Entry[] {
  const low = ru.toLowerCase();
  return entries.filter((e) => e.ru.some((form) => low.includes(form.toLowerCase())));
}
```

- [ ] **Step 5: Реализовать `lib/sacred.ts`**

```ts
// Аяты, дуа и хадисы машине не отдаются: перевод священного текста — это
// вопрос тасхиха, а не качества модели. Распознали — просим текст руками.
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

const OPENERS = [
  "бисмилля", "бисмиллях", "а'узу", "аузубилля", "субханака",
  "аллахумма", "ля иляха илля",
];

const CITATION = /\b(сур[аеы]|аят[аеу]?)\b[^.]{0,40}\b\d{1,3}\b/i;
const HADITH = /\b(передал|сообщил)\b.{0,30}\b(бухари|муслим|тирмизи|абу дауд)\b/i;

export function detectSacred(ru: string): string | null {
  if (ARABIC.test(ru)) return "арабский текст — впиши перевод руками";
  const low = ru.toLowerCase();
  if (OPENERS.some((o) => low.includes(o))) {
    return "богослужебная формула — впиши текст руками";
  }
  if (CITATION.test(ru)) return "ссылка на аят — впиши текст руками";
  if (HADITH.test(ru)) return "хадис — впиши текст руками";
  return null;
}
```

- [ ] **Step 6: Реализовать `lib/validate.ts`**

```ts
import { Cue, fitLines, MAX_CHARS, MAX_CPS } from "./cues";
import { Entry, relevant } from "./glossary";

// Индонезийская аффиксация: doa → berdoa, berdoalah, doanya. Прямое
// совпадение подстроки дало бы ложные срабатывания, поэтому термин
// ищется как корень внутри слова, а запрещённые варианты — строго
// по границам слова.
function containsTerm(text: string, term: string): boolean {
  const t = term.toLowerCase().replace(/[^a-z' ]/g, "");
  if (!t) return false;
  return new RegExp(`[a-z]*${escapeRe(t)}[a-z]*`, "i").test(text.toLowerCase());
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word.toLowerCase())}\\b`, "i").test(text.toLowerCase());
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateCue(cue: Cue, entries: Entry[]): string | null {
  const id = cue.id;
  if (!id || id.trim().length === 0) return null;

  // Геометрия проверяется ВСЕГДА, в том числе на тексте, вписанном руками:
  // 42 знака и два ряда — это физика кадра, а не богословие.
  if (id.length > MAX_CHARS || fitLines(id) === null) {
    return `не влезает в кадр: ${id.length} знаков при потолке ${MAX_CHARS}`;
  }
  const dur = cue.end - cue.start;
  if (dur > 0 && id.length / dur > MAX_CPS) {
    return `слишком быстро: ${(id.length / dur).toFixed(1)} знаков в секунду при потолке ${MAX_CPS}`;
  }

  // Терминологию с ручного текста не спрашиваем: человек вписал осознанно.
  if (cue.needsManual) return null;

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

  if (/\b(пророк|мухаммад)/i.test(cue.ru) && !/\bSAW\b/.test(id)) {
    return "упомянут Пророк, но нет SAW";
  }
  return null;
}

// Орфографический режим общий на весь ролик: sholat и salat вместе — ошибка.
const SPELLING_PAIRS: [string, string][] = [
  ["sholat", "salat"],
  ["dzikir", "zikir"],
  ["hadits", "hadis"],
  ["adzan", "azan"],
];

export function validateSpelling(cues: Cue[]): string | null {
  const all = cues.map((c) => c.id ?? "").join(" ").toLowerCase();
  for (const [a, b] of SPELLING_PAIRS) {
    if (containsWord(all, a) && containsWord(all, b)) {
      return `в одном ролике встретились «${a}» и «${b}» — оставь один режим написания`;
    }
  }
  return null;
}
```

- [ ] **Step 7: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/validate.test.ts tests/sacred.test.ts tests/glossary.test.ts`
Expected: PASS, 20 тестов

- [ ] **Step 8: Добавить глоссарий в трассировку**

В `sub-bot/next.config.ts` в `outputFileTracingIncludes` для `/api/sub/start` добавить `"./assets/glossary.ru-id.json"`.

- [ ] **Step 9: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): глоссарий, детектор сакрального и валидатор перевода"
```

---

### Task 9: Посегментный перевод

**Files:**
- Create: `sub-bot/lib/translate.ts`, `sub-bot/tests/translate.test.ts`

**Interfaces:**
- Consumes: `Cue` из Task 4; `Entry`, `relevant`, `loadGlossary` из Task 8; `detectSacred` из Task 8
- Produces: `translateCues(apiKey: string, cues: Cue[]): Promise<Cue[]>`

- [ ] **Step 1: Написать падающие тесты**

Создать `sub-bot/tests/translate.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { translateCues } from "../lib/translate";
import type { Cue } from "../lib/cues";

const cue = (i: number, ru: string): Cue => ({
  i, start: i, end: i + 2, ru, id: null, needsManual: false, warning: null,
});

const reply = (items: { i: number; id: string }[]) =>
  vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] }),
    text: async () => "",
  });

afterEach(() => vi.unstubAllGlobals());

describe("translateCues", () => {
  it("проставляет перевод по номерам", async () => {
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah doa" }, { i: 2, id: "Setelah sholat" }]));
    const out = await translateCues("k", [cue(1, "Читай дуа"), cue(2, "После намаза")]);
    expect(out.map((c) => c.id)).toEqual(["Bacalah doa", "Setelah sholat"]);
  });

  it("сакральные реплики не отдаёт модели и помечает вручную", async () => {
    const f = reply([{ i: 2, id: "Setelah sholat" }]);
    vi.stubGlobal("fetch", f);
    const out = await translateCues("k", [cue(1, "Бисмилляхи-р-рахман"), cue(2, "После намаза")]);
    expect(out[0].needsManual).toBe(true);
    expect(out[0].id).toBeNull();
    expect(out[0].warning).toMatch(/руками/);
    const body = JSON.parse(f.mock.calls[0][1].body as string);
    expect(JSON.stringify(body)).not.toContain("Бисмилляхи");
  });

  it("на расхождении числа элементов бросает ошибку", async () => {
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah doa" }]));
    await expect(translateCues("k", [cue(1, "Читай дуа"), cue(2, "После намаза")]))
      .rejects.toThrow(/2.*1|не совпад/);
  });

  it("проставляет warning на непрошедших валидатор", async () => {
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah dua" }]));
    const out = await translateCues("k", [cue(1, "Читай дуа")]);
    expect(out[0].warning).toMatch(/dua/);
  });

  it("если переводить нечего, к модели не ходит", async () => {
    const f = reply([]);
    vi.stubGlobal("fetch", f);
    const out = await translateCues("k", [cue(1, "Бисмилляхи-р-рахман")]);
    expect(f).not.toHaveBeenCalled();
    expect(out[0].needsManual).toBe(true);
  });

  it("на ошибке API бросает исключение с кодом", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => "rate limited", json: async () => ({}),
    }));
    await expect(translateCues("k", [cue(1, "Читай дуа")])).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/translate.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать `lib/translate.ts`**

```ts
import { Cue, MAX_CHARS } from "./cues";
import { loadGlossary, relevant, Entry } from "./glossary";
import { detectSacred } from "./sacred";
import { validateCue } from "./validate";

const MODEL = "gpt-5.1";

function systemPrompt(entries: Entry[]): string {
  const terms = entries
    .map((e) => `- «${e.ru[0]}» → ${e.id}${e.forbidden.length ? `; НИКОГДА не ${e.forbidden.join(", ")}` : ""}${e.note ? ` (${e.note})` : ""}`)
    .join("\n");

  return [
    "Ты переводишь субтитры исламского просветительского ролика с русского на индонезийский (Bahasa Indonesia).",
    "",
    "Правила:",
    `1. Каждая реплика — отдельный субтитр на экране. Держи её КОРОТКОЙ: не длиннее ${MAX_CHARS} знаков.`,
    "2. Верни ровно столько элементов, сколько получил, с теми же номерами i. Не объединяй и не дроби реплики.",
    "3. Регистр — обращение на «kamu», разговорный, как в дакватских роликах.",
    "4. Соблюдай глоссарий буквально.",
    "5. После имени Пророка обязательно ставь SAW.",
    "",
    terms ? `Глоссарий:\n${terms}` : "Глоссарий: терминов в этом ролике нет.",
  ].join("\n");
}

export async function translateCues(apiKey: string, cues: Cue[]): Promise<Cue[]> {
  const entries = loadGlossary();

  const marked = cues.map((c) => {
    const sacred = detectSacred(c.ru);
    return sacred
      ? { ...c, id: null, needsManual: true, warning: sacred }
      : { ...c, needsManual: false, warning: null };
  });

  const toTranslate = marked.filter((c) => !c.needsManual);
  if (toTranslate.length === 0) return marked;

  const relevantEntries = entries.filter((e) =>
    toTranslate.some((c) => relevant([e], c.ru).length > 0)
  );

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt(relevantEntries) },
        {
          role: "user",
          content: JSON.stringify({
            items: toTranslate.map((c) => ({ i: c.i, ru: c.ru })),
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "subtitles",
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

  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  const parsed = JSON.parse(body.choices[0].message.content) as {
    items: { i: number; id: string }[];
  };

  // Расхождение числа элементов означает, что перевод разъехался с
  // таймингом. Это не чинится подгонкой — только явной ошибкой.
  if (parsed.items.length !== toTranslate.length) {
    throw new Error(
      `перевод не совпал по числу реплик: отправлено ${toTranslate.length}, получено ${parsed.items.length}`
    );
  }

  const byIndex = new Map(parsed.items.map((x) => [x.i, x.id]));
  return marked.map((c) => {
    if (c.needsManual) return c;
    const id = byIndex.get(c.i);
    if (id === undefined) {
      return { ...c, needsManual: true, warning: "перевод не вернулся — впиши текст руками" };
    }
    const withId = { ...c, id };
    return { ...withId, warning: validateCue(withId, entries) };
  });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/translate.test.ts`
Expected: PASS, 6 тестов

- [ ] **Step 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): посегментный перевод с глоссарием"
```

---

### Task 10: Модель задачи, статусы и раздельные дедлайны

**Files:**
- Modify: `sub-bot/lib/jobs.ts`, `sub-bot/tests/jobs.test.ts`

**Interfaces:**
- Consumes: `Cue` из Task 4
- Produces: расширенный `Job` с полем `cues: Cue[]`; `JobStatus = "transcribing"|"translating"|"awaiting"|"rendering"|"delivering"|"done"|"failed"`; `isActive(job)`; `deadlineMs(status)`; `isExpired(job, nowMs)`; `AWAITING_DEADLINE_MS`, `WORK_DEADLINE_MS`

- [ ] **Step 1: Написать падающие тесты**

Дописать в `sub-bot/tests/jobs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isActive, isExpired, deadlineMs, AWAITING_DEADLINE_MS, WORK_DEADLINE_MS } from "../lib/jobs";
import type { Job } from "../lib/jobs";

const job = (over: Partial<Job> = {}): Job => ({
  jobId: "j1", chatId: 1, sourceUrl: "https://x/a.mp4", resultUrl: null,
  status: "awaiting", durationSec: 20, cues: [], deliveringAt: null,
  createdAt: new Date("2026-08-20T00:00:00Z").toISOString(), error: null, ...over,
});

describe("дедлайны", () => {
  it("awaiting живёт сутки", () => {
    expect(deadlineMs("awaiting")).toBe(AWAITING_DEADLINE_MS);
    expect(AWAITING_DEADLINE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("рабочие статусы живут полчаса", () => {
    for (const s of ["transcribing", "translating", "rendering", "delivering"] as const) {
      expect(deadlineMs(s)).toBe(WORK_DEADLINE_MS);
    }
    expect(WORK_DEADLINE_MS).toBe(30 * 60 * 1000);
  });

  it("awaiting через час ещё жив", () => {
    const t = Date.parse("2026-08-20T01:00:00Z");
    expect(isExpired(job(), t)).toBe(false);
  });

  it("rendering через час уже мёртв", () => {
    const t = Date.parse("2026-08-20T01:00:00Z");
    expect(isExpired(job({ status: "rendering" }), t)).toBe(true);
  });

  it("awaiting через двое суток мёртв", () => {
    const t = Date.parse("2026-08-22T00:00:00Z");
    expect(isExpired(job(), t)).toBe(true);
  });

  it("завершённые задачи не считаются активными", () => {
    expect(isActive(job({ status: "done" }))).toBe(false);
    expect(isActive(job({ status: "failed" }))).toBe(false);
    expect(isActive(job({ status: "awaiting" }))).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/jobs.test.ts`
Expected: FAIL — `deadlineMs` не экспортируется

- [ ] **Step 3: Расширить `lib/jobs.ts`**

Заменить объявление типов и добавить функции дедлайнов:

```ts
import { Cue } from "./cues";

export type JobStatus =
  | "transcribing"
  | "translating"
  | "awaiting"
  | "rendering"
  | "delivering"
  | "done"
  | "failed";

export interface Job {
  jobId: string;
  chatId: number;
  sourceUrl: string;
  resultUrl: string | null;
  status: JobStatus;
  durationSec: number;
  cues: Cue[];
  deliveringAt: string | null;
  createdAt: string;
  error: string | null;
}

export const WORK_DEADLINE_MS = 30 * 60 * 1000;
// awaiting ждёт человека, а правка религиозного текста руками — это часы.
// Общий тридцатиминутный дедлайн делал бы живучесть задачи лотереей:
// созданная в 03:00 UTC умирала бы через час, созданная в 05:00 жила почти сутки.
export const AWAITING_DEADLINE_MS = 24 * 60 * 60 * 1000;

export function deadlineMs(status: JobStatus): number {
  return status === "awaiting" ? AWAITING_DEADLINE_MS : WORK_DEADLINE_MS;
}

export function isActive(job: Job): boolean {
  return job.status !== "done" && job.status !== "failed";
}

export function isExpired(job: Job, nowMs: number): boolean {
  if (!isActive(job)) return false;
  return nowMs - Date.parse(job.createdAt) > deadlineMs(job.status);
}
```

Префиксы Blob оставить как есть после Task 1 (`sub/jobs/`, `sub/sources/`, `sub/results/`).

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/jobs.test.ts`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): статусы конвейера и раздельные дедлайны задач"
```

---

### Task 11: Команды, список реплик и разбор правок

**Files:**
- Modify: `sub-bot/lib/commands.ts`, `sub-bot/tests/commands.test.ts`

**Interfaces:**
- Consumes: `Job`, `Cue` из Task 10
- Produces: `parseEdit(text: string, cues: Cue[]): {i: number, text: string} | null`; `renderCueList(job: Job): string`; `blockingWarnings(cues: Cue[]): number[]`

- [ ] **Step 1: Написать падающие тесты**

Дописать в `sub-bot/tests/commands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseEdit, renderCueList, blockingWarnings } from "../lib/commands";
import type { Cue } from "../lib/cues";
import type { Job } from "../lib/jobs";

const cues: Cue[] = [
  { i: 1, start: 0, end: 2, ru: "Читай дуа", id: "Bacalah doa", needsManual: false, warning: null },
  { i: 2, start: 2.1, end: 4, ru: "Бисмилляхи", id: null, needsManual: true, warning: "впиши руками" },
];

describe("parseEdit", () => {
  it("разбирает правку по номеру", () => {
    expect(parseEdit("1 Bacalah doa ini", cues)).toEqual({ i: 1, text: "Bacalah doa ini" });
  });

  it("берёт весь остаток строки, включая пробелы", () => {
    expect(parseEdit("2 Dengan nama Allah  yang", cues)?.text).toBe("Dengan nama Allah  yang");
  });

  it("не принимает номер вне диапазона", () => {
    expect(parseEdit("9 текст", cues)).toBeNull();
  });

  it("не принимает номер без текста", () => {
    expect(parseEdit("1", cues)).toBeNull();
    expect(parseEdit("1   ", cues)).toBeNull();
  });

  it("не принимает сообщение без ведущего числа", () => {
    expect(parseEdit("Bacalah doa", cues)).toBeNull();
  });

  it("не принимает команды", () => {
    expect(parseEdit("/ok", cues)).toBeNull();
  });
});

describe("blockingWarnings", () => {
  it("собирает номера реплик, которые блокируют рендер", () => {
    expect(blockingWarnings(cues)).toEqual([2]);
  });

  it("на чистых репликах пусто", () => {
    expect(blockingWarnings([cues[0]])).toEqual([]);
  });
});

describe("renderCueList", () => {
  const job = { jobId: "j", chatId: 1, cues, status: "awaiting", durationSec: 4 } as Job;

  it("нумерует и показывает таймкоды", () => {
    const out = renderCueList(job);
    expect(out).toContain("1.");
    expect(out).toContain("0:00");
  });

  it("показывает предупреждения", () => {
    expect(renderCueList(job)).toContain("впиши руками");
  });

  it("показывает русский оригинал", () => {
    expect(renderCueList(job)).toContain("Читай дуа");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/commands.test.ts`
Expected: FAIL — функции не экспортируются

- [ ] **Step 3: Дописать `lib/commands.ts`**

```ts
import { Cue } from "./cues";
import { Job } from "./jobs";

// Правка — сообщение вида «<номер><пробел><текст>». Число должно попасть в
// диапазон существующих реплик, иначе это обычное сообщение и бот отвечает
// подсказкой, а не проглатывает молча.
export function parseEdit(text: string, cues: Cue[]): { i: number; text: string } | null {
  const m = /^(\d{1,3})\s+(.+)$/s.exec(text.trim());
  if (!m) return null;
  const i = Number(m[1]);
  if (!cues.some((c) => c.i === i)) return null;
  const body = m[2].trim();
  if (body.length === 0) return null;
  return { i, text: body };
}

export function blockingWarnings(cues: Cue[]): number[] {
  return cues.filter((c) => c.needsManual || c.warning !== null).map((c) => c.i);
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function renderCueList(job: Job): string {
  const lines = job.cues.map((c) => {
    const head = `${c.i}. [${mmss(c.start)}] ${c.id ?? "—"}`;
    const warn = c.warning ? `\n   ⚠ ${c.warning}` : "";
    return `${head}\n   ${c.ru}${warn}`;
  });

  const blocking = blockingWarnings(job.cues);
  const tail = blocking.length
    ? `\nПоправь строки: ${blocking.join(", ")}. Пиши «номер новый текст».`
    : "\nВсё чисто. /ok — вшить субтитры, /cancel — отменить.";

  return `Субтитры, ${job.cues.length} реплик:\n\n${lines.join("\n\n")}\n${tail}`;
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): список реплик в чате и разбор правок"
```

---

### Task 12: Конвейер до статуса awaiting

**Files:**
- Create: `sub-bot/lib/pipeline.ts`, `sub-bot/tests/pipeline.test.ts`, `sub-bot/app/api/sub/start/route.ts`
- Modify: `sub-bot/app/u/[token]/upload-form.tsx`

**Interfaces:**
- Consumes: `probeMedia`, `MAX_DURATION_SEC` (Task 6), `transcribe` (Task 7), `buildCues` (Task 4), `translateCues` (Task 9), `Job` (Task 10)
- Produces: `runPipeline(deps: PipelineDeps, job: Job): Promise<Job>`, тип `PipelineDeps`

- [ ] **Step 1: Написать падающие тесты**

Создать `sub-bot/tests/pipeline.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../lib/pipeline";
import type { Job } from "../lib/jobs";

const job = (): Job => ({
  jobId: "j1", chatId: 1, sourceUrl: "https://x/a.mp4", resultUrl: null,
  status: "transcribing", durationSec: 0, cues: [], deliveringAt: null,
  createdAt: new Date().toISOString(), error: null,
});

const deps = (over: Record<string, unknown> = {}) => ({
  probe: vi.fn().mockResolvedValue({ durationSec: 20, hasAudio: true }),
  download: vi.fn().mockResolvedValue("/tmp/src.mp4"),
  transcribe: vi.fn().mockResolvedValue([{ text: "Читай", start: 0, end: 0.5 }]),
  translate: vi.fn().mockImplementation(async (cues) => cues.map((c: any) => ({ ...c, id: "Bacalah" }))),
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe("runPipeline", () => {
  it("доводит задачу до awaiting с репликами", async () => {
    const out = await runPipeline(deps() as never, job());
    expect(out.status).toBe("awaiting");
    expect(out.cues.length).toBeGreaterThan(0);
    expect(out.cues[0].id).toBe("Bacalah");
  });

  it("отбивает ролик длиннее потолка", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 61.4, hasAudio: true }) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/61/);
    expect(d.transcribe).not.toHaveBeenCalled();
  });

  it("пропускает ролик 60.4 секунды — это норма для телефона", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 60.4, hasAudio: true }) });
    expect((await runPipeline(d as never, job())).status).toBe("awaiting");
  });

  it("отбивает ролик без звуковой дорожки", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 20, hasAudio: false }) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/звук/i);
  });

  it("отбивает ролик, где речь не распозналась", async () => {
    const d = deps({ transcribe: vi.fn().mockResolvedValue([]) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/речь/i);
  });

  it("на падении перевода помечает задачу failed, а не роняет вызов", async () => {
    const d = deps({ translate: vi.fn().mockRejectedValue(new Error("429 rate limited")) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/429/);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/pipeline.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать `lib/pipeline.ts`**

```ts
import { Job } from "./jobs";
import { Cue, Word, buildCues } from "./cues";
import { MAX_DURATION_SEC } from "./media";

export interface PipelineDeps {
  probe: (path: string) => Promise<{ durationSec: number; hasAudio: boolean }>;
  download: (url: string) => Promise<string>;
  transcribe: (sourceUrl: string) => Promise<Word[]>;
  translate: (cues: Cue[]) => Promise<Cue[]>;
  save: (job: Job) => Promise<void>;
}

async function fail(deps: PipelineDeps, job: Job, error: string): Promise<Job> {
  const out: Job = { ...job, status: "failed", error };
  await deps.save(out);
  return out;
}

export async function runPipeline(deps: PipelineDeps, job: Job): Promise<Job> {
  try {
    const localPath = await deps.download(job.sourceUrl);
    const info = await deps.probe(localPath);

    if (info.durationSec > MAX_DURATION_SEC) {
      return fail(
        deps,
        job,
        `ролик ${info.durationSec.toFixed(1)} с, а потолок ${MAX_DURATION_SEC} с`
      );
    }
    if (!info.hasAudio) {
      return fail(deps, job, "в ролике нет звуковой дорожки — нечего распознавать");
    }

    const words = await deps.transcribe(job.sourceUrl);
    if (words.length === 0) {
      return fail(deps, job, "речь не распозналась — возможно, в ролике только музыка");
    }

    const cues = buildCues(words);
    if (cues.length === 0) {
      return fail(deps, job, "речь не распозналась — реплик не получилось");
    }

    const translating: Job = { ...job, status: "translating", durationSec: info.durationSec, cues };
    await deps.save(translating);

    const translated = await deps.translate(cues);
    const awaiting: Job = { ...translating, status: "awaiting", cues: translated };
    await deps.save(awaiting);
    return awaiting;
  } catch (e) {
    return fail(deps, job, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/pipeline.test.ts`
Expected: PASS, 6 тестов

- [ ] **Step 5: Поднять потолок длительности на странице загрузки**

В `sub-bot/app/u/[token]/upload-form.tsx` найти проверку длительности и заменить порог на `61.0`, а текст отказа — на «Ролик длиннее 61 секунды. Обрежь и загрузи снова». Если проверки нет — добавить в обработчик выбора файла: читать `video.duration` через `URL.createObjectURL`, блокировать кнопку и показывать длительность.

- [ ] **Step 6: Написать роут `app/api/sub/start/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { runPipeline } from "../../../../lib/pipeline";
import { saveJob } from "../../../../lib/jobs";
import { requireEnv } from "../../../../lib/config";
import { verifyUploadToken } from "../../../../lib/tokens";
import { probeMedia } from "../../../../lib/media";
import { spawnRunner } from "../../../../lib/render";
import { transcribe } from "../../../../lib/scribe";
import { translateCues } from "../../../../lib/translate";
import { sendMessage } from "../../../../lib/telegram";
import { renderCueList } from "../../../../lib/commands";
import { downloadToTmp } from "../../../../lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { token, sourceUrl } = (await req.json()) as { token: string; sourceUrl: string };
  const claim = verifyUploadToken(token, requireEnv("SUB_TOKEN_SECRET"));
  if (!claim) return NextResponse.json({ error: "токен истёк" }, { status: 403 });

  const job = {
    jobId: randomUUID(),
    chatId: claim.chatId,
    sourceUrl,
    resultUrl: null,
    status: "transcribing" as const,
    durationSec: 0,
    cues: [],
    deliveringAt: null,
    createdAt: new Date().toISOString(),
    error: null,
  };
  await saveJob(job);

  after(async () => {
    const done = await runPipeline(
      {
        probe: (p) => probeMedia(spawnRunner, p),
        download: downloadToTmp,
        transcribe: (url) => transcribe(requireEnv("ELEVENLABS_API_KEY"), url),
        translate: (cues) => translateCues(requireEnv("OPENAI_API_KEY"), cues),
        save: saveJob,
      },
      job
    );
    const token = requireEnv("TELEGRAM_SUB_BOT_TOKEN");
    await sendMessage(
      token,
      done.chatId,
      done.status === "failed" ? `Не вышло: ${done.error}` : renderCueList(done)
    );
  });

  return NextResponse.json({ ok: true, jobId: job.jobId }, { status: 202 });
}
```

Если функций `verifyUploadToken`, `downloadToTmp` или `sendMessage` в проекте нет под такими именами — использовать существующие из `lib/tokens.ts`, `lib/storage.ts`, `lib/telegram.ts`, а недостающее дописать. `downloadToTmp(url)` качает файл из Blob во временный каталог и возвращает путь.

- [ ] **Step 7: Проверить компиляцию и весь набор тестов**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx tsc --noEmit && npm test`
Expected: компиляция чистая, все тесты зелёные

- [ ] **Step 8: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): конвейер от загрузки до утверждения текста"
```

---

### Task 13: Рендер и доставка

**Files:**
- Create: `sub-bot/lib/deliver.ts`, `sub-bot/tests/deliver.test.ts`, `sub-bot/app/api/sub/render/route.ts`
- Modify: `sub-bot/lib/telegram.ts`

**Interfaces:**
- Consumes: `buildAss` (Task 5), `renderSubs` (Task 6), `Job` (Task 10), `blockingWarnings` (Task 11)
- Produces: `pickDelivery(sizeBytes: number): "link"|"multipart"|"blob"`; `runRender(deps: RenderDeps, job: Job): Promise<Job>`

- [ ] **Step 1: Написать падающие тесты**

Создать `sub-bot/tests/deliver.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { pickDelivery, runRender } from "../lib/deliver";
import type { Job } from "../lib/jobs";

const MB = 1024 * 1024;

const job = (over: Partial<Job> = {}): Job => ({
  jobId: "j1", chatId: 1, sourceUrl: "https://x/a.mp4", resultUrl: null,
  status: "awaiting", durationSec: 20,
  cues: [{ i: 1, start: 0, end: 2, ru: "Читай", id: "Bacalah", needsManual: false, warning: null }],
  deliveringAt: null, createdAt: new Date().toISOString(), error: null, ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  download: vi.fn().mockResolvedValue("/tmp/src.mp4"),
  render: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn().mockResolvedValue("https://blob/out.mp4"),
  size: vi.fn().mockResolvedValue(10 * MB),
  deliver: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn().mockResolvedValue(undefined),
  fontFamily: "Plus Jakarta Sans ExtraBold",
  ...over,
});

describe("pickDelivery", () => {
  it("до 20 МБ отдаёт ссылкой", () => {
    expect(pickDelivery(19 * MB)).toBe("link");
    expect(pickDelivery(20 * MB)).toBe("link");
  });
  it("от 20 до 50 МБ грузит multipart", () => {
    expect(pickDelivery(20 * MB + 1)).toBe("multipart");
    expect(pickDelivery(50 * MB)).toBe("multipart");
  });
  it("свыше 50 МБ отдаёт ссылку на Blob", () => {
    expect(pickDelivery(50 * MB + 1)).toBe("blob");
  });
});

describe("runRender", () => {
  it("доводит задачу до done", async () => {
    const out = await runRender(deps() as never, job());
    expect(out.status).toBe("done");
    expect(out.resultUrl).toBe("https://blob/out.mp4");
  });

  it("отказывает, если есть блокирующие предупреждения", async () => {
    const d = deps();
    const j = job({ cues: [{ i: 1, start: 0, end: 2, ru: "Б", id: null, needsManual: true, warning: "впиши руками" }] });
    const out = await runRender(d as never, j);
    expect(out.status).toBe("awaiting");
    expect(d.render).not.toHaveBeenCalled();
  });

  it("на падении ffmpeg помечает failed с хвостом ошибки", async () => {
    const d = deps({ render: vi.fn().mockRejectedValue(new Error("ffmpeg вышел с кодом 1: boom")) });
    const out = await runRender(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/ffmpeg/);
  });

  it("удаляет временные файлы даже при падении", async () => {
    const d = deps({ render: vi.fn().mockRejectedValue(new Error("boom")) });
    await runRender(d as never, job());
    expect(d.cleanup).toHaveBeenCalled();
  });

  it("не рендерит задачу, которая уже не в awaiting", async () => {
    const d = deps();
    const out = await runRender(d as never, job({ status: "done" }));
    expect(d.render).not.toHaveBeenCalled();
    expect(out.status).toBe("done");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/deliver.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать `lib/deliver.ts`**

```ts
import { Job } from "./jobs";
import { blockingWarnings } from "./commands";

const MB = 1024 * 1024;

// Telegram скачивает по ссылке до 20 МБ и принимает загрузку до 50 МБ.
// Три ветки, а не две, именно поэтому.
export function pickDelivery(sizeBytes: number): "link" | "multipart" | "blob" {
  if (sizeBytes <= 20 * MB) return "link";
  if (sizeBytes <= 50 * MB) return "multipart";
  return "blob";
}

export interface RenderDeps {
  download: (url: string) => Promise<string>;
  render: (srcPath: string, ass: string, fontFamily: string) => Promise<string>;
  upload: (path: string, jobId: string) => Promise<string>;
  size: (path: string) => Promise<number>;
  deliver: (job: Job, url: string, mode: "link" | "multipart" | "blob") => Promise<void>;
  save: (job: Job) => Promise<void>;
  cleanup: () => Promise<void>;
  fontFamily: string;
}

export async function runRender(deps: RenderDeps, job: Job): Promise<Job> {
  if (job.status !== "awaiting") return job;

  const blocking = blockingWarnings(job.cues);
  if (blocking.length > 0) return job;

  const rendering: Job = { ...job, status: "rendering" };
  await deps.save(rendering);

  try {
    const src = await deps.download(job.sourceUrl);
    const { buildAss } = await import("./ass");
    const outPath = await deps.render(src, buildAss(job.cues, deps.fontFamily), deps.fontFamily);
    const size = await deps.size(outPath);
    const url = await deps.upload(outPath, job.jobId);

    const delivering: Job = {
      ...rendering,
      status: "delivering",
      deliveringAt: new Date().toISOString(),
      resultUrl: url,
    };
    await deps.save(delivering);

    await deps.deliver(delivering, url, pickDelivery(size));

    const done: Job = { ...delivering, status: "done", deliveringAt: null };
    await deps.save(done);
    return done;
  } catch (e) {
    const failed: Job = {
      ...rendering,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
    await deps.save(failed);
    return failed;
  } finally {
    await deps.cleanup();
  }
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/deliver.test.ts`
Expected: PASS, 8 тестов

- [ ] **Step 5: Написать роут рендера**

Создать `sub-bot/app/api/sub/render/route.ts` по образцу `app/api/probe/route.ts`: проверка `tickKey(jobId, SUB_TOKEN_SECRET)`, ответ 202 сразу, работа в `after()`. Конфигурация функции — **`maxDuration = 800`** (план Pro это позволяет) и запуск `runRender` с реальными зависимостями:

- `download` — качает исходник из Blob в `mkdtemp(join(tmpdir(), "sub-"))`
- `render` — пишет `.ass` в тот же каталог, вызывает `renderSubs(spawnRunner, {...})` с `preset: "veryfast"`, **удаляет исходник сразу после возврата ffmpeg** (в `/tmp` всего 500 МБ), возвращает путь результата
- `upload` — `put()` в `sub/results/<jobId>.mp4`
- `deliver` — три ветки из `lib/telegram.ts`; в ветке `blob` текст сообщения обязан содержать «ссылка живёт сутки»
- `cleanup` — `rmSync(dir, {recursive: true, force: true})`
- `fontFamily` — значение, полученное из probe в Task 3

- [ ] **Step 6: Поднять лимит времени и память функции рендера**

Создать или дополнить `sub-bot/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cleanup", "schedule": "0 4 * * *" }],
  "functions": {
    "app/api/sub/render/route.ts": { "memory": 4096, "maxDuration": 800 }
  }
}
```

Дополнительно в дашборде проекта выставить лимит конкурентности Fluid равным 1 — ffmpeg занимает CPU целиком и задушил бы соседние вызовы на том же инстансе.

- [ ] **Step 7: Прогнать весь набор тестов**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx tsc --noEmit && npm test`
Expected: всё зелёное

- [ ] **Step 8: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): рендер субтитров и доставка результата"
```

---

### Task 14: Вебхук, уборка и README

**Files:**
- Modify: `sub-bot/app/api/telegram/route.ts`, `sub-bot/lib/cleanup.ts`, `sub-bot/tests/cleanup.test.ts`, `sub-bot/README.md`, `sub-bot/.env.example`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: рабочий бот целиком

- [ ] **Step 1: Написать падающий тест на уборку с раздельными дедлайнами**

Дописать в `sub-bot/tests/cleanup.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { cleanup } from "../lib/cleanup";
import type { Job } from "../lib/jobs";

const at = (iso: string, status: Job["status"]): Job => ({
  jobId: iso, chatId: 1, sourceUrl: "https://x/a.mp4", resultUrl: null,
  status, durationSec: 10, cues: [], deliveringAt: null, createdAt: iso, error: null,
});

describe("cleanup", () => {
  const now = Date.parse("2026-08-20T04:00:00Z");

  it("закрывает зависший rendering старше получаса", async () => {
    const deps = {
      list: vi.fn().mockResolvedValue([at("2026-08-20T03:00:00Z", "rendering")]),
      save: vi.fn(), notify: vi.fn(), del: vi.fn(),
    };
    await cleanup(deps as never, now);
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("не трогает awaiting, которому час", async () => {
    const deps = {
      list: vi.fn().mockResolvedValue([at("2026-08-20T03:00:00Z", "awaiting")]),
      save: vi.fn(), notify: vi.fn(), del: vi.fn(),
    };
    await cleanup(deps as never, now);
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("закрывает awaiting старше суток", async () => {
    const deps = {
      list: vi.fn().mockResolvedValue([at("2026-08-18T03:00:00Z", "awaiting")]),
      save: vi.fn(), notify: vi.fn(), del: vi.fn(),
    };
    await cleanup(deps as never, now);
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("чистит блобы завершённых задач старше суток", async () => {
    const done = { ...at("2026-08-18T03:00:00Z", "done"), resultUrl: "https://blob/out.mp4" };
    const deps = { list: vi.fn().mockResolvedValue([done]), save: vi.fn(), notify: vi.fn(), del: vi.fn() };
    await cleanup(deps as never, now);
    expect(deps.del).toHaveBeenCalledWith("https://blob/out.mp4");
  });
});
```

- [ ] **Step 2: Запустить, убедиться что падает, привести `lib/cleanup.ts` в соответствие**

Run: `cd /Users/alanalmassuly/Desktop/qurany/sub-bot && npx vitest run tests/cleanup.test.ts`

Переписать `cleanup` так, чтобы просроченность считалась через `isExpired(job, nowMs)` из Task 10 (то есть по статусу), а не через один общий порог. Завершённые задачи старше суток чистятся как раньше — удаляются исходник, результат и файл задачи.

- [ ] **Step 3: Дописать обработку сообщений в вебхуке**

В `sub-bot/app/api/telegram/route.ts` добавить ветки:

- `/sub` — выдать ссылку на страницу загрузки (как было для `/dub`)
- `/ok` — найти активную задачу чата в статусе `awaiting`; если есть блокирующие предупреждения, ответить «Сначала поправь строки: N, M»; иначе ответить «Рендерю» и вызвать `/api/sub/render` с `tickKey`
- `/cancel` — пометить задачу `failed`, удалить исходник, ответить подтверждением
- `/status` — показать активные задачи
- `/help` — справка с описанием формата правки
- Текст без команды — `parseEdit`; попал — обновить реплику, снять `needsManual` и `warning`, пересчитать `validateCue` по геометрии, сохранить и прислать обновлённый список; не попал — ответить подсказкой про формат «номер новый текст»

- [ ] **Step 4: Переписать README под субтитры**

Полностью заменить содержимое `sub-bot/README.md`: что делает бот, поток, команды с форматом правки, таблица переменных окружения, подключение вебхука, probe-эндпоинт с описанием, что значит каждое поле отчёта, типичные проблемы (нет текста в кадре → шрифт; ffmpeg код 1 → смотреть хвост stderr; задача висит в awaiting → у неё сутки), ссылка на спеку. Обновить `.env.example` под новый набор переменных.

- [ ] **Step 5: Прогнать всё и задеплоить**

```bash
cd /Users/alanalmassuly/Desktop/qurany/sub-bot
npx tsc --noEmit && npm test
vercel env add TELEGRAM_SUB_BOT_TOKEN production
vercel env add TELEGRAM_ALLOWED_CHAT_IDS production
vercel env add TELEGRAM_WEBHOOK_SECRET production
vercel env add ELEVENLABS_API_KEY production
vercel env add OPENAI_API_KEY production
vercel env add CRON_SECRET production
vercel env add SUB_BASE_URL production
vercel deploy --prod
```

- [ ] **Step 6: Подключить вебхук**

```bash
curl -sS -X POST "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<домен>/api/telegram","secret_token":"<TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message"]}'
curl -sS "https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo"
```

Expected: `url` совпадает, `last_error_message` пуст.

- [ ] **Step 7: Смоук на живых роликах**

1. Ролик 15 секунд, русская речь, фоновый нашид → приходит список реплик, музыка в текст не попала.
2. Правка одной строки → список обновился, номер тот же, тайминги не поехали.
3. `/ok` → приходит видео, субтитры читаются, не залезают на UI сторис.
4. Ролик 61 секунда с высоким битрейтом → замерить время рендера, записать в README. Не уложилось в 800 с — переключить `preset` на `ultrafast`.
5. Ролик с кораническим фрагментом → реплика помечена ⚠, `/ok` отказывает.

- [ ] **Step 8: Коммит**

```bash
cd /Users/alanalmassuly/Desktop/qurany
git add sub-bot
git commit -m "feat(sub-bot): команды бота, уборка по статусам и документация"
```

---

## Самопроверка плана

**Покрытие спеки.** Поток — задачи 12–14. Компоненты — все из таблицы спеки заведены: `scribe` (7), `cues` (4), `translate` (9), `validate`/`sacred`/`glossary` (8), `ass` (5), `render`/`media` (6), `binaries`/`probe` (2–3), `jobs` (10), `commands` (11), `pipeline` (12), `deliver` (13), `cleanup` (14). Состояние задачи — 10. Стиль субтитров — 5, значения перенесены дословно. Глоссарий и валидатор — 8. Обработка ошибок — покрыта тестами в 12, 13, 14. Безопасность — каркас из 1 плюс проверки ключей в роутах 3, 12, 13. Переменные окружения — 14. Тестирование — в каждой задаче. Неизвестные №1 и №2 — гейт в задаче 3, №3 — шаг 7 задачи 14, №4 — шаг 6 задачи 13.

**Плейсхолдеры.** Один осознанный: в задаче 13 шаг 5 и в задаче 14 шаг 3 описаны прозой, а не кодом, потому что оба целиком состоят из связывания уже определённых функций, чьи сигнатуры заданы в блоках Interfaces выше. Всё остальное — рабочий код.

**Согласованность типов.** `Word` и `Cue` объявлены в задаче 4 и используются везде. `Runner` объявлен в 6, потребляется в 6 и 12. `Job` расширен в 10, потребляется в 11–14. `fontFamily` как строка добирается из probe (3) до `buildAss` (5) через `RenderDeps` (13). Имя `assEscape` объявлено в 3, импортируется в 6 — при исполнении задачи 6 проверить, что импорт `from "./probe"` не тянет за собой лишнего; если тянет, вынести `assEscape` в отдельный модуль `lib/escape.ts` и поправить оба импорта.
