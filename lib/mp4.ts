// ── Длительность ролика из заголовка mp4.
// Instagram не отдаёт длительность полем API (проверено: duration/video_duration/length
// — «nonexisting field»), но отдаёт media_url. Качать ролик целиком незачем: длительность
// лежит в боксе moov→mvhd, а он у файлов из CDN Instagram идёт в начале файла.
// Поэтому читаем только первые килобайты через HTTP Range.

const HEADER = 8; // размер (4 байта) + тип (4 байта)

function boxType(buf: Uint8Array, at: number): string {
  return String.fromCharCode(buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]);
}

// Размер бокса: 1 — реальный размер 64-битный и лежит следом, 0 — бокс до конца файла.
function boxSize(view: DataView, at: number): { size: number; header: number } {
  const size = view.getUint32(at);
  if (size === 1) return { size: Number(view.getBigUint64(at + HEADER)), header: 16 };
  return { size, header: HEADER };
}

/** Длительность в секундах из бокса mvhd, начинающегося на offset. null — распарсить не вышло. */
export function parseMvhd(buf: Uint8Array, offset: number): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = buf[offset + 8];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (offset + 40 > buf.byteLength) return null;
    timescale = view.getUint32(offset + 28);
    duration = Number(view.getBigUint64(offset + 32));
  } else {
    if (offset + 28 > buf.byteLength) return null;
    timescale = view.getUint32(offset + 20);
    duration = view.getUint32(offset + 24);
  }
  // Фрагментированный mp4 пишет в mvhd нули — это «не знаю», а не «ноль секунд».
  if (!timescale || !duration) return null;
  return duration / timescale;
}

export interface Walk {
  /** Длительность в секундах, если moov→mvhd нашёлся целиком в этом куске. */
  duration: number | null;
  /** С какого смещения в файле продолжать, если ещё не нашли. null — продолжать негде. */
  continueAt: number | null;
}

/**
 * Обходит боксы верхнего уровня в куске файла, начинающемся со смещения baseOffset.
 * Возвращает длительность либо подсказку, откуда дочитывать.
 */
export function walkForDuration(buf: Uint8Array, baseOffset = 0): Walk {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 0;

  while (at + HEADER <= buf.byteLength) {
    const { size, header } = boxSize(view, at);
    const type = boxType(buf, at);

    if (type === "moov") {
      // Ищем mvhd среди детей moov — обычно он первый.
      let child = at + header;
      const end = size > 0 ? Math.min(at + size, buf.byteLength) : buf.byteLength;
      while (child + HEADER <= end) {
        const c = boxSize(view, child);
        if (boxType(buf, child) === "mvhd") return { duration: parseMvhd(buf, child), continueAt: null };
        if (c.size <= 0) break;
        child += c.size;
      }
      // moov начался, но в кусок не поместился — дочитываем с его начала.
      return { duration: null, continueAt: at + size > buf.byteLength ? baseOffset + at : null };
    }

    if (size <= 0) return { duration: null, continueAt: null }; // бокс до конца файла — moov за ним нет
    if (at + size > buf.byteLength) return { duration: null, continueAt: baseOffset + at + size };
    at += size;
  }

  return { duration: null, continueAt: baseOffset + at };
}

const CHUNK = 128 * 1024;
const MAX_HOPS = 3;

/** Длительность ролика по ссылке на mp4. null — не удалось определить, это не ошибка. */
export async function fetchMp4Duration(url: string): Promise<number | null> {
  let from = 0;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetch(url, { headers: { range: `bytes=${from}-${from + CHUNK - 1}` } });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return null;

    const { duration, continueAt } = walkForDuration(buf, from);
    if (duration != null) return duration;
    if (continueAt == null || continueAt <= from) return null;
    from = continueAt;
  }
  return null;
}
