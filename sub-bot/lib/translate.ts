import { Cue, MAX_CHARS } from "./cues";
import { loadGlossary, relevant, Entry } from "./glossary";
import { detectSacred } from "./sacred";
import { validateCue, validateSpelling } from "./validate";

const MODEL = "gpt-5.1";

// Только записи, реально встретившиеся хоть в одной реплике ролика — 5–15
// штук вместо всех тридцати. Гигантский словарь модель начинает игнорировать
// (Ruling 6), поэтому набор строится через relevant() на каждой реплике и
// схлопывается по id, а не берётся из loadGlossary() целиком.
function pickRelevantEntries(entries: Entry[], cues: Cue[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const c of cues) {
    for (const e of relevant(entries, c.ru)) byId.set(e.id, e);
  }
  return [...byId.values()];
}

function systemPrompt(entries: Entry[]): string {
  // Поле forbidden проговаривается текстом явно (Ruling 7): модель надёжнее
  // избегает названного запрета, чем угадывает его — "dua" вместо "doa" это
  // "два" вместо "мольбы".
  const terms = entries
    .map(
      (e) =>
        `- «${e.ru[0]}» → ${e.id}${
          e.forbidden.length ? `; НИКОГДА не ${e.forbidden.join(", ")}` : ""
        }${e.note ? ` (${e.note})` : ""}`
    )
    .join("\n");

  return [
    "Ты переводишь субтитры исламского просветительского ролика с русского на индонезийский (Bahasa Indonesia).",
    "",
    "Правила:",
    // MAX_CHARS здесь — грубый ориентир для модели, не точная мерка (реальная
    // геометрия считается в пикселях через validateCue после перевода).
    `1. Каждая реплика — отдельный субтитр на экране. Держи её короткой, ориентировочно не длиннее ${MAX_CHARS} знаков.`,
    "2. Верни ровно столько элементов, сколько получил, с теми же номерами i. Не объединяй и не дроби реплики.",
    "3. Регистр — обращение на «kamu», разговорный, как в дакватских роликах.",
    "4. Соблюдай глоссарий буквально.",
    "5. После имени Пророка обязательно ставь SAW.",
    "",
    terms ? `Глоссарий:\n${terms}` : "Глоссарий: терминов в этом ролике нет.",
  ].join("\n");
}

// Орфографический режим общий на весь ролик (validateSpelling, lib/validate.ts):
// "sholat" и "salat" вместе в одном ролике — ошибка, даже если по отдельности
// каждая реплика прошла validateCue. Сообщение вешается на первую реплику,
// у которой ещё нет своего warning, — дублировать его на каждую реплику
// незачем, а перезаписывать чужую (более специфичную) причину нельзя.
function applySpellingWarning(cues: Cue[]): Cue[] {
  const message = validateSpelling(cues);
  if (!message) return cues;

  let applied = false;
  return cues.map((c) => {
    if (applied || c.warning !== null) return c;
    applied = true;
    return { ...c, warning: message };
  });
}

export async function translateCues(apiKey: string, cues: Cue[]): Promise<Cue[]> {
  const entries = loadGlossary();

  // Сакральное (аяты, дуа, хадисы) модели не отдаётся вообще — ни текстом
  // в запросе, ни намёком. Обнаружили detectSacred — помечаем needsManual
  // с её причиной и исключаем реплику из toTranslate ниже.
  const marked = cues.map((c) => {
    const sacred = detectSacred(c.ru);
    return sacred
      ? { ...c, id: null, needsManual: true, warning: sacred }
      : { ...c, needsManual: false, warning: null };
  });

  const toTranslate = marked.filter((c) => !c.needsManual);
  // Переводить нечего (все реплики сакральные) — к модели не ходим вовсе,
  // ни одного сетевого вызова.
  if (toTranslate.length === 0) return applySpellingWarning(marked);

  const relevantEntries = pickRelevantEntries(entries, toTranslate);

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

  // Ошибка API — это исключение с кодом, а не тихий возврат непереведённых
  // реплик: молчаливый провал здесь опаснее падения, ролик просто не выйдет.
  if (!res.ok) {
    throw new Error(`Переводчик вернул ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  const parsed = JSON.parse(body.choices[0].message.content) as {
    items: { i: number; id: string }[];
  };

  // Расхождение числа элементов означает, что перевод разъехался с
  // таймингом (тайминг привязан к границам русских реплик). Это не чинится
  // подгонкой — только явной ошибкой с указанием, сколько отправлено и
  // сколько получено.
  if (parsed.items.length !== toTranslate.length) {
    throw new Error(
      `перевод не совпал по числу реплик: отправлено ${toTranslate.length}, получено ${parsed.items.length}`
    );
  }

  const byIndex = new Map(parsed.items.map((x) => [x.i, x.id]));
  const translated = marked.map((c) => {
    if (c.needsManual) return c;
    const id = byIndex.get(c.i);
    // Число элементов совпало, но конкретный номер в ответе отсутствует
    // (например, модель перепутала i) — реплика помечается needsManual,
    // а не остаётся молча с id: null.
    if (id === undefined) {
      return { ...c, needsManual: true, warning: "перевод не вернулся — впиши текст руками" };
    }
    const withId = { ...c, id };
    return { ...withId, warning: validateCue(withId, entries) };
  });

  return applySpellingWarning(translated);
}
