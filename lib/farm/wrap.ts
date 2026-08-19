export const HOOK_LINE_CHARS = 26;
export const HOOK_MAX_LINES = 3;

// drawtext сам не переносит: длинный хук уехал бы за кадр. Считаем перенос здесь,
// а страница загрузки не пропускает хук, для которого перенос невозможен.
export function wrapHook(
  hook: string,
  maxChars: number = HOOK_LINE_CHARS,
  maxLines: number = HOOK_MAX_LINES
): string[] | null {
  const words = hook.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.some((w) => w.length > maxChars)) return null;

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);

  return lines.length <= maxLines ? lines : null;
}
