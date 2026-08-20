import { Cue, fitLines, SUBTITLE_FONTSIZE } from "./cues";

// Округление сотых выполняется ОДИН РАЗ, до разбора на часы/минуты/секунды,
// а не после отдельного округления дробной части. Наивный вариант
// (Math.round((sec % 1) * 100) отдельно от Math.floor(sec)) может дать 100
// сотых на входе вроде 2.999 — и такой перенос пришлось бы либо тащить в
// секунды отдельным спецкейсом, либо (тише и хуже) откусывать до 99, тихо
// теряя точность. round-then-decompose переносит перенос в секунды/минуты/
// часы сам, через целочисленное деление — специального случая не нужно.
export function assTime(sec: number): string {
  const totalCs = Math.round(Math.max(0, sec) * 100);
  const cc = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

// В .ass фигурные скобки открывают блок тегов override — текст, пришедший
// от человека или модели, обязан быть экранирован, иначе случайная скобка
// съест кусок реплики как тег override. Перевод строки, оставленный
// fitLines, превращается в \N — управляющий код принудительного переноса
// строки формата ASS (в отличие от \n, который libass не переносит).
export function escapeText(s: string): string {
  return s.replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

export function buildAss(cues: Cue[], fontFamily: string): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    // Автопереноса нет намеренно: строки ломает fitLines той же меркой,
    // что измеряет ширину в пикселях (lib/cues.ts), а не число знаков.
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    // Полный набор 23 полей V4+ Style: libass сопоставляет значения со
    // строкой Format позиционно — урезанный набор даёт молча съехавший
    // стиль вместо ошибки.
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Fontsize берётся из SUBTITLE_FONTSIZE (lib/cues.ts), не зашивается
    // здесь вторым числом: та же константа участвует в измерении ширины
    // строки в fitLines, и разъехаться им нельзя. Сама причина числа 106
    // (а не «визуальных» 64) — в комментарии lib/probe.ts: libass
    // нормирует кегль по вертикальным метрикам шрифта
    // (usWinAscent + usWinDescent), а не по em-квадрату.
    `Style: Sub,${fontFamily},${SUBTITLE_FONTSIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,6.5,2,2,130,130,480,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = cues
    .filter((c): c is Cue & { id: string } => !!c.id && c.id.trim().length > 0)
    .map((c) => {
      // Не влезло (fitLines вернул null) — печатаем одной строкой: она
      // честно вылезет за поля и будет видна. Молчаливой перевёрстки
      // быть не должно.
      const lines = fitLines(c.id) ?? [c.id];
      const text = escapeText(lines.join("\n"));
      return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${text}`;
    });

  return [...header, ...events, ""].join("\n");
}
