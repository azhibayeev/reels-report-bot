// В filtergraph ffmpeg двоеточие разделяет опции фильтра, а обратный слэш
// экранирует. Путь, попавший внутрь subtitles=..., обязан быть экранирован,
// иначе /var/task/... с двоеточием (например, в кириллице Windows-путей или
// просто в /tmp/probe-XXXX:something) разъедет фильтр на два аргумента.
//
// Отдельный модуль, а не часть lib/probe.ts: probe.ts тянет за собой
// statfsSync, чтение TTF и spawn ffmpeg, а lib/render.ts (Task 6) нуждается
// только в этой чистой строковой функции — незачем ему тащить всё probe ради
// склейки строки.
export function assEscape(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
