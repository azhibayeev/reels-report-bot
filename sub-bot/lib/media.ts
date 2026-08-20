import { ffprobePath } from "./binaries";
import type { Runner } from "./render";

// Порог 61.0, а не 60.0: телефонные экспорты «минутного» ролика сплошь дают
// 60.03–60.5 с (переменный битрейт, округление контейнера), и жёсткая
// шестидесятка отфутболила бы совершенно нормальные ролики.
export const MAX_DURATION_SEC = 61.0;

export interface MediaInfo {
  durationSec: number;
  hasAudio: boolean;
}

interface ProbeJson {
  format?: { duration?: string };
  streams?: { codec_type?: string }[];
}

const STDERR_TAIL = 300;

// Длительность и наличие звука — единственная правда о ролике: то, что
// сообщил браузер при загрузке, не более чем оценка. Любой сбой здесь
// обязан бросить исключение с понятным текстом, а не тихо вернуть 0 —
// нулевая длительность означала бы «ролик нулевой длины» и увела бы
// диагностику не в ту сторону.
export async function probeMedia(run: Runner, path: string): Promise<MediaInfo> {
  const { code, stderr, stdout } = await run(ffprobePath(), [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe вышел с кодом ${code}: ${stderr.slice(-STDERR_TAIL)}`);
  }

  let parsed: ProbeJson;
  try {
    parsed = JSON.parse(stdout) as ProbeJson;
  } catch {
    throw new Error("ffprobe вернул не JSON");
  }

  const durationSec = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSec)) {
    throw new Error("ffprobe не отдал длительность");
  }

  return {
    durationSec,
    hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}
