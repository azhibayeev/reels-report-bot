import { measureWidth } from "./textwidth";

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

// Грубая прикидка длины реплики для сообщений в чат (не в переносе строк —
// там решает измеренная ширина, см. fitLines и Ruling 8 плана).
export const MAX_CHARS = 42;
export const MAX_LINES = 2;
// Полезная ширина строки кадра 1080×1920: поля по 130 px с каждой стороны
// (см. MarginL/MarginR стиля .ass в lib/probe.ts) — 1080 - 130 - 130 = 820.
export const LINE_MAX_PX = 820;
// Кегль субтитров из стиля .ass (Ruling 7 Task 3) — тот же должен идти
// в measureWidth, иначе мерка разойдётся с рендером.
export const SUBTITLE_FONTSIZE = 106;
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
    // Потолок длительности здесь НЕ проверяется (Ruling 11): по индукции
    // разрез ровно в момент переполнения означал, что splitLongGroup ниже
    // никогда не получал группу длиннее потолка — "умный" разрез по самой
    // длинной внутренней паузе был мёртвым кодом. Резать по превышению
    // MAX_DUR_SEC — работа splitLongGroup, у неё есть вся группа целиком и
    // она режет по естественной паузе, а не по случайному слову, на
    // котором истёк лимит.
    const breakHere =
      pause >= PAUSE_BREAK_SEC ||
      SENTENCE_END.test(words[i].text) ||
      CLAUSE_END.test(words[i].text);

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

// Группа длиннее потолка режется по самой длинной межсловной паузе внутри
// неё.
//
// Тай-брейк при равных паузах (Ruling 13, правка A): сравнение через
// строгое `>` раньше при равнотемповой речи (все паузы одинаковые)
// оставляло победителем ПЕРВУЮ позицию — группа вырождалась в «одно слово с
// фронта + остаток», рекурсия отгрызала слова по одному, а потом
// enforceTiming склеивала осколки обратно в блок неограниченной длины (на
// 40 словах — 11.45с при потолке 2.6с). Среди пауз, равных максимуму с
// допуском EPS (сравнивать double на точное равенство ненадёжно), выбираем
// позицию ближе к середине группы — тогда равнотемповый участок делится
// пополам, обе половины укладываются в потолок, и делить дальше нечего.
const SPLIT_TIE_EPS_SEC = 0.001;

function splitLongGroup(group: Word[]): Word[][] {
  const dur = group[group.length - 1].end - group[0].start;
  if (dur <= MAX_DUR_SEC || group.length < 2) return [group];

  const pauses = Array.from({ length: group.length - 1 }, (_, i) => group[i + 1].start - group[i].end);
  const maxPause = Math.max(...pauses);
  const mid = (pauses.length - 1) / 2;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pauses.length; i++) {
    if (pauses[i] < maxPause - SPLIT_TIE_EPS_SEC) continue; // не в числе лидеров
    const dist = Math.abs(i - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  const left = group.slice(0, bestIdx + 1);
  const right = group.slice(bestIdx + 1);
  return [...splitLongGroup(left), ...splitLongGroup(right)];
}

// Границы длительности и зазор между блоками. Порядок приоритетов
// (Ruling 13, правка B — уточняет Ruling 10 после того, как выяснилось,
// что неограниченное слияние само может пробить потолок: на 40 словах
// равнотемповой речи склеенный блок доходил до 11.45с), от сильного
// к слабому:
//   1. блоки не перекрываются — жёстко;
//   2. длительность не выше MAX_DUR_SEC — жёстко;
//   3. длительность не ниже MIN_DUR_SEC — уступает первым двум;
//   4. зазор не меньше GAP_SEC — уступает первым трём.
// Если растянутый до MIN_DUR_SEC блок залезает на следующий, слияние
// разрешено, ТОЛЬКО ЕСЛИ слитый блок укладывается в MAX_DUR_SEC (приоритет
// 2 сильнее приоритета 3). Если не укладывается — не сливаем, а подрезаем
// конец предыдущего блока к началу следующего (зазор до нуля, приоритет 1
// восстановлен) и принимаем предыдущий блок короче MIN_DUR_SEC: субтитр
// 0.7с честнее субтитра на 11с. Слияние ограничено потолком, поэтому
// повторный разрез результата не нужен и цикл не зацикливается.
function enforceTiming(cues: Cue[]): Cue[] {
  const merged: Cue[] = [];

  for (const c of cues) {
    let cur = { ...c };
    if (cur.end - cur.start < MIN_DUR_SEC) cur.end = cur.start + MIN_DUR_SEC;

    while (merged.length > 0 && cur.start < merged[merged.length - 1].end) {
      const prev = merged[merged.length - 1];
      const mergedEnd = Math.max(prev.end, cur.end);

      if (mergedEnd - prev.start > MAX_DUR_SEC) {
        // Слияние пробило бы потолок — приоритет 2 сильнее приоритета 1
        // в том смысле, что перекрытие устраняем НЕ слиянием, а подрезкой:
        // prev теряет хвост до начала cur и остаётся отдельным блоком,
        // пусть и короче MIN_DUR_SEC (приоритет 3 уступает).
        prev.end = cur.start;
        break;
      }

      merged.pop();
      cur = { ...prev, ru: `${prev.ru} ${cur.ru}`, end: mergedEnd };
      // Слитый блок почти всегда уже длиннее MIN_DUR_SEC, но перепроверяем:
      // мало ли оба исходных блока были короче нуля до стяжки координат.
      if (cur.end - cur.start < MIN_DUR_SEC) cur.end = cur.start + MIN_DUR_SEC;
    }

    merged.push(cur);
  }

  // Приоритет 4, самый слабый: подтягиваем зазор до GAP_SEC. Нижняя граница
  // сдвига — не MIN_DUR_SEC безусловно, а минимум из текущего конца блока
  // и его MIN_DUR_SEC-порога: если блок уже подрезан короче MIN_DUR_SEC
  // веткой выше (приоритет 2 уже забрал своё), этот шаг не должен НИ
  // сокращать его сильнее (незачем), НИ — что здесь критично — растягивать
  // его обратно к MIN_DUR_SEC, потому что это вернуло бы перекрытие с
  // next и нарушило бы приоритет 1 ради приоритета 4.
  for (let i = 0; i < merged.length - 1; i++) {
    const next = merged[i + 1];
    if (next.start - merged[i].end < GAP_SEC) {
      const floor = Math.min(merged[i].end, merged[i].start + MIN_DUR_SEC);
      merged[i].end = Math.max(floor, next.start - GAP_SEC);
    }
  }

  return merged.map((c, idx) => ({ ...c, i: idx + 1 }));
}

// Уровень 2: переносы строк внутри блока по индонезийскому тексту.
// Граница — измеренная ширина чернил в пикселях (Ruling 8), а не число
// знаков: разброс ширины символа между узкими (i, l, t) и широкими
// (m, k, b) доходит до 1.7×, и единый коэффициент «знаков на строку» его
// не покрывает — см. lib/textwidth.ts. Возвращает null, если текст
// физически не помещается — тогда блок получает warning и ждёт правки руками.
export function fitLines(text: string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.some((w) => measureWidth(w, SUBTITLE_FONTSIZE) > LINE_MAX_PX)) return null;

  const joined = words.join(" ");
  if (measureWidth(joined, SUBTITLE_FONTSIZE) <= LINE_MAX_PX) return [joined];

  // Кандидаты на разрыв: сначала позиции перед союзом, потом все остальные.
  const positions = Array.from({ length: words.length - 1 }, (_, i) => i + 1);
  const preferred = positions.filter((p) =>
    ID_CONJUNCTIONS.has(words[p].toLowerCase().replace(/[.,!?;:]+$/, ""))
  );

  for (const list of [preferred, positions]) {
    for (const p of list) {
      const first = words.slice(0, p).join(" ");
      const second = words.slice(p).join(" ");
      if (
        measureWidth(first, SUBTITLE_FONTSIZE) <= LINE_MAX_PX &&
        measureWidth(second, SUBTITLE_FONTSIZE) <= LINE_MAX_PX
      ) {
        return [first, second];
      }
    }
  }
  return null;
}
