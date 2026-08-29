// ElevenLabs отдаёт перевод готовыми репликами с таймингами (SRT), поэтому свой
// разбор речи не нужен — нужен только разбор формата.

export interface Cue {
  startSec: number;
  endSec: number;
  /** Реплика одной строкой: переносы SRT сделаны под чужую ширину кадра. */
  text: string;
}

// 00:00:05,335 и 00:00:05.335 — SRT и WebVTT отличаются только этим знаком.
const TIMING = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function seconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

/**
 * Возвращает реплики по возрастанию времени. Всё, что не разобралось, молча
 * пропускается: одна кривая реплика не повод остаться вовсе без субтитров.
 */
export function parseSrt(srt: string): Cue[] {
  const cues: Cue[] = [];

  for (const block of srt.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;

    // Номер реплики необязателен: WebVTT его обычно не пишет.
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at === -1) continue;

    const m = TIMING.exec(lines[at]);
    if (!m) continue;
    const startSec = seconds(m[1], m[2], m[3], m[4]);
    const endSec = seconds(m[5], m[6], m[7], m[8]);

    const text = lines
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // теги вида <i> Telegram не покажет, а в кадр они попадут
      .replace(/\s+/g, " ")
      .trim();

    // Реплика нулевой длины никогда не покажется, а пустая — покажет пустоту.
    if (!text || endSec <= startSec) continue;
    cues.push({ startSec, endSec, text });
  }

  return cues.sort((a, b) => a.startSec - b.startSec);
}

/**
 * Наложенные друг на друга реплики дали бы два блока текста в одном кадре:
 * подрезаем конец предыдущей до начала следующей.
 */
export function trimOverlaps(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const [i, cue] of cues.entries()) {
    const next = cues[i + 1];
    const endSec = next && next.startSec < cue.endSec ? next.startSec : cue.endSec;
    if (endSec > cue.startSec) out.push({ ...cue, endSec });
  }
  return out;
}
