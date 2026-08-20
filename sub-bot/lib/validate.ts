import { Cue, LINE_MAX_PX, MAX_CPS, SUBTITLE_FONTSIZE, fitLines } from "./cues";
import { measureWidth } from "./textwidth";
import { Entry, relevant } from "./glossary";

// Одна нормализация для ОБЕИХ сторон сравнения (термин и проверяемый
// текст): нижний регистр, апострофы вырезать, дефисы ЗАМЕНИТЬ пробелом
// (не вырезать), повторные пробелы схлопнуть. Раньше дефис вырезался
// ТОЛЬКО из термина ("Al-Qur'an" → "alqur'an"), а текст с дефисом на
// месте — никогда, поэтому термин "Коран" не засчитывался ни одним
// переводом (Фикс-раунд 1, находка 1). Дальше выяснилось, что вырезание
// дефиса ПОЛНОСТЬЮ (не заменой на пробел) — само по себе регрессия:
// индонезийская редупликация "ayat-ayat" схлопывалась в нечленимое
// "ayatayat", которое не собирается ни из какой пары приставка+корень
// (Фикс-раунд 2, находка 4). Замена на пробел превращает "ayat-ayat" в
// два токена "ayat ayat", каждый чисто матчится корнем как обычное слово.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Текст режется на токены отдельной функцией (не просто .split(" ")),
// чтобы случайная пунктуация, прилипшая к слову (запятая, точка), не
// ломала сравнение — non-a-z считается разделителем наравне с пробелом.
function tokenize(s: string): string[] {
  return s.split(/[^a-z]+/).filter(Boolean);
}

// Индонезийские приставки и суффиксы (без грамматического разбора,
// просто конечный список форм из брифа): doa → berdoa, berdoalah, doanya.
const PREFIXES = [
  "", "ber", "be", "me", "mem", "men", "meng", "meny",
  "pe", "pem", "pen", "peng", "di", "ter", "se", "ke",
];
const SUFFIXES = ["", "kan", "i", "nya", "lah", "an", "ku", "mu"];

// Слово засчитывается за корень, только если оно СОБИРАЕТСЯ из
// приставка? + корень + суффикс? целиком, без остатка. Это отличает
// "berdoalah" (ber + doa + lah — совпадение) от "melayat" (me + layat —
// remainder "layat" не начинается с корня "ayat", совпадения нет: корень
// не на морфемной границе, а просто где-то внутри слова).
function matchesRoot(word: string, root: string): boolean {
  for (const p of PREFIXES) {
    if (!word.startsWith(p)) continue;
    const afterPrefix = word.slice(p.length);
    if (!afterPrefix.startsWith(root)) continue;
    const afterRoot = afterPrefix.slice(root.length);
    if (SUFFIXES.includes(afterRoot)) return true;
  }
  return false;
}

// Индонезийская аффиксация: doa → berdoa, berdoalah, doanya. Прямое
// совпадение подстроки (регэксп "везде внутри слова") дало бы ложные
// срабатывания вроде "ayat" внутри "melayat" ("навестить с
// соболезнованием" — к аяту отношения не имеет), поэтому термин ищется
// по морфемной границе через matchesRoot, а не как произвольная
// подстрока.
//
// Многословные термины ("insya Allah", "Nabi Muhammad SAW", "Al-Qur'an" →
// "al quran") засчитываются двумя способами: (1) их слова встречаются в
// тексте ПОДРЯД — обычное раздельное написание; (2) термин со снятыми
// пробелами матчится как ОДИН токен по правилам корня — это покрывает
// слитное написание вроде "Alquran" (Фикс-раунд 2, находка 4).
function containsTerm(text: string, term: string): boolean {
  const termTokens = tokenize(normalize(term));
  if (termTokens.length === 0) return false;
  const textTokens = tokenize(normalize(text));

  if (termTokens.length === 1) {
    return textTokens.some((w) => matchesRoot(w, termTokens[0]));
  }

  for (let i = 0; i + termTokens.length <= textTokens.length; i++) {
    if (termTokens.every((t, j) => textTokens[i + j] === t)) return true;
  }
  const merged = termTokens.join("");
  return textTokens.some((w) => matchesRoot(w, merged));
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word.toLowerCase())}\\b`, "i").test(text.toLowerCase());
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// \b в JS размечает границы только по ASCII \w — кириллица в него не
// входит, поэтому /\b(пророк|мухаммад)/i никогда не совпадала (тот же
// баг, что чинился в lib/sacred.ts, Фикс-раунд 1, находка 2). Эта
// проверка — подстраховка НА СЛУЧАЙ, когда containsTerm выше уже принял
// строчный "saw" как совпадение с термином "Nabi Muhammad SAW" (термин
// регистронезависим по конструкции — это верно для терминов вообще, но
// не для аббревиатуры SAW): без рабочей границы подстраховка молчала, и
// "nabi muhammad saw bersabda" проходило без требования заглавных букв.
const PROROK_RE = /(?<![\p{L}\p{N}])(пророк|мухаммад)(?![\p{L}\p{N}])/iu;

export function validateCue(cue: Cue, entries: Entry[]): string | null {
  const id = cue.id;
  if (!id || id.trim().length === 0) return null;

  // Геометрия проверяется ВСЕГДА, в том числе на тексте, вписанном руками:
  // ширина в пикселях кадра — это физика, а не богословие. Счёт знаков как
  // мерка ширины отвергнут замером (Ruling 8 плана): "Menyampaikan
  // keberkahan" (23 знака) занимает 884px и вылезает за поля, а "Bacalah
  // doa ini" (15 знаков) — всего 473px, разброс ширины знака доходит до
  // 1.7×. Поэтому геометрию проверяем через fitLines — ту же функцию,
  // что режет переносы строк при рендере: null означает, что текст не
  // влезает ни в одну строку, ни в разбивку на две.
  if (fitLines(id) === null) {
    const px = Math.round(measureWidth(id, SUBTITLE_FONTSIZE));
    return `не влезает в кадр: ${px} px при потолке ${LINE_MAX_PX}`;
  }

  // Скорость чтения — знаки в секунду, здесь знаки правильная единица:
  // речь о темпе чтения, а не о ширине глифов.
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

  // Сама проверка SAW регистрочувствительна (без /i) намеренно: строчное
  // "saw" — обычное индонезийское слово, не салляват.
  if (PROROK_RE.test(cue.ru) && !/\bSAW\b/.test(id)) {
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
