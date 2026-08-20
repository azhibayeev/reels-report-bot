import { Cue, LINE_MAX_PX, MAX_CPS, SUBTITLE_FONTSIZE, fitLines } from "./cues";
import { measureWidth } from "./textwidth";
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
