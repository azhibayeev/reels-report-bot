import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

export type Runner = (bin: string, args: string[]) => Promise<RunResult>;

// Хвост stderr режем, а не копим целиком: ffmpeg на ошибке может насыпать
// мегабайты диагностики построчно на каждый кадр — ни в тексте исключения,
// ни в памяти процесса это не нужно.
const STDERR_CAP = 8000;

// Общий низкоуровневый раннер процесса: он нужен и lib/probe.ts (самопроверка
// окружения), и lib/render.ts / lib/media.ts (запуск ffmpeg и ffprobe) —
// логика запуска и накопления вывода у них была дословно одинаковой, поэтому
// вынесена сюда одним модулем вместо нескольких копий одного и того же spawn.
export const spawnRunner: Runner = (bin, args) =>
  new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    p.stdout.on("data", (d) => {
      stdout += String(d);
    });
    p.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-STDERR_CAP);
    });
    p.on("close", (code) => resolve({ code, stderr, stdout }));
    p.on("error", (e) => resolve({ code: null, stderr: String(e), stdout: "" }));
  });
