import { readFileSync } from "node:fs";
import { fontPath } from "./binaries";

// Сегмент подтаблицы cmap формата 4: диапазон кодпоинтов и правило,
// по которому кодпоинт превращается в индекс глифа. idRangeOffsetAddr —
// абсолютный адрес самой записи idRangeOffset в буфере: когда idRangeOffset
// не ноль, спецификация TTF адресует glyphIdArray смещением ОТ ЭТОЙ ЗАПИСИ,
// а не от начала подтаблицы.
interface CmapSegment {
  startCode: number;
  endCode: number;
  idDelta: number;
  idRangeOffset: number;
  idRangeOffsetAddr: number;
}

interface FontMetrics {
  unitsPerEm: number;
  // Множитель нормировки кегля, которым libass делит Fontsize:
  // (usWinAscent + usWinDescent) / unitsPerEm. Вычислен из файла, не зашит.
  normalization: number;
  advanceWidths: number[]; // advance каждого глифа в юнитах шрифта, индекс — glyph id
  segments: CmapSegment[];
  buf: Buffer;
}

// Разбор шрифта — одноразовый: 128 КБ файла и таблицы cmap/hmtx незачем
// перечитывать на каждую реплику. Модульная переменная, не аргумент функции.
let cached: FontMetrics | null = null;

function readTableDirectory(buf: Buffer): Map<string, { offset: number; length: number }> {
  const numTables = buf.readUInt16BE(4);
  const dir = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = buf.toString("ascii", rec, rec + 4);
    dir.set(tag, { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) });
  }
  return dir;
}

function requireTable(
  dir: Map<string, { offset: number; length: number }>,
  tag: string,
  path: string
): { offset: number; length: number } {
  const t = dir.get(tag);
  if (!t) throw new Error(`не удалось разобрать шрифт ${path}: нет таблицы ${tag}`);
  return t;
}

function parseFont(path: string): FontMetrics {
  const buf = readFileSync(path);
  const dir = readTableDirectory(buf);

  const head = requireTable(dir, "head", path);
  const unitsPerEm = buf.readUInt16BE(head.offset + 18);

  const maxp = requireTable(dir, "maxp", path);
  const numGlyphs = buf.readUInt16BE(maxp.offset + 4);

  const hhea = requireTable(dir, "hhea", path);
  const numberOfHMetrics = buf.readUInt16BE(hhea.offset + 34);

  // hmtx хранит пары (advanceWidth, lsb) только для первых numberOfHMetrics
  // глифов; у следующих advance повторяет последний из таблицы (правило
  // спецификации TTF для «моноширинного хвоста»).
  const hmtx = requireTable(dir, "hmtx", path);
  const advanceWidths = new Array<number>(numGlyphs);
  let last = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numberOfHMetrics) last = buf.readUInt16BE(hmtx.offset + i * 4);
    advanceWidths[i] = last;
  }

  const os2 = requireTable(dir, "OS/2", path);
  const usWinAscent = buf.readUInt16BE(os2.offset + 74);
  const usWinDescent = buf.readUInt16BE(os2.offset + 76);
  const normalization = (usWinAscent + usWinDescent) / unitsPerEm;

  const cmap = requireTable(dir, "cmap", path);
  const numSubtables = buf.readUInt16BE(cmap.offset + 2);
  let subtableOffset = -1;
  for (let i = 0; i < numSubtables; i++) {
    const rec = cmap.offset + 4 + i * 8;
    const platformId = buf.readUInt16BE(rec);
    const encodingId = buf.readUInt16BE(rec + 2);
    if (platformId === 3 && encodingId === 1) {
      subtableOffset = cmap.offset + buf.readUInt32BE(rec + 4);
      break;
    }
  }
  if (subtableOffset < 0) {
    throw new Error(`не удалось разобрать шрифт ${path}: нет подтаблицы cmap платформа 3 кодировка 1`);
  }
  const format = buf.readUInt16BE(subtableOffset);
  if (format !== 4) {
    throw new Error(`не удалось разобрать шрифт ${path}: подтаблица cmap 3,1 не формата 4 (${format})`);
  }

  const segCountX2 = buf.readUInt16BE(subtableOffset + 6);
  const endCodesOff = subtableOffset + 14;
  const startCodesOff = endCodesOff + segCountX2 + 2; // +2 байта reservedPad
  const idDeltaOff = startCodesOff + segCountX2;
  const idRangeOffsetOff = idDeltaOff + segCountX2;

  const segments: CmapSegment[] = [];
  for (let i = 0; i < segCountX2 / 2; i++) {
    const startCode = buf.readUInt16BE(startCodesOff + i * 2);
    const endCode = buf.readUInt16BE(endCodesOff + i * 2);
    if (startCode === 0xffff && endCode === 0xffff) continue; // концевой сегмент-заглушка
    segments.push({
      startCode,
      endCode,
      idDelta: buf.readInt16BE(idDeltaOff + i * 2),
      idRangeOffset: buf.readUInt16BE(idRangeOffsetOff + i * 2),
      idRangeOffsetAddr: idRangeOffsetOff + i * 2,
    });
  }

  return { unitsPerEm, normalization, advanceWidths, segments, buf };
}

function getMetrics(): FontMetrics {
  if (!cached) cached = parseFont(fontPath());
  return cached;
}

// Символ вне cmap (глиф .notdef, id 0) не должен ронять функцию — считаем
// его по advance глифа 0, как это делает и сам рендерер при отсутствии
// глифа в шрифте.
function glyphForCodepoint(m: FontMetrics, cp: number): number {
  for (const seg of m.segments) {
    if (cp < seg.startCode || cp > seg.endCode) continue;
    if (seg.idRangeOffset === 0) return (cp + seg.idDelta) & 0xffff;
    const glyphIndexAddr = seg.idRangeOffsetAddr + seg.idRangeOffset + (cp - seg.startCode) * 2;
    if (glyphIndexAddr + 2 > m.buf.length) return 0;
    const raw = m.buf.readUInt16BE(glyphIndexAddr);
    return raw === 0 ? 0 : (raw + seg.idDelta) & 0xffff;
  }
  return 0;
}

// Ширина строки в пикселях по реальной метрике шрифта, а не по числу
// знаков (Ruling 8): сумма advance-ов глифов в em, домноженная на кегль,
// нормированный так же, как это делает libass при рендере — делением на
// (usWinAscent + usWinDescent) / unitsPerEm.
export function measureWidth(text: string, fontsize: number): number {
  if (text.length === 0) return 0;
  const m = getMetrics();
  let unitsSum = 0;
  for (const ch of text) {
    const gid = glyphForCodepoint(m, ch.codePointAt(0) ?? 0);
    unitsSum += gid < m.advanceWidths.length ? m.advanceWidths[gid] : 0;
  }
  return (unitsSum / m.unitsPerEm) * (fontsize / m.normalization);
}
