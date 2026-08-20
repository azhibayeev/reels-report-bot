"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";

type Stage = "idle" | "uploading" | "starting" | "done" | "error";

// Совпадает с MAX_DURATION_SEC в lib/media.ts: телефонные экспорты
// «минутного» ролика сплошь дают 60.03–60.5 с (переменный битрейт, округление
// контейнера), и жёсткая шестидесятка отфутболила бы нормальные ролики.
// Значение не импортируется из lib/media.ts напрямую — тот модуль тянет
// node:fs через lib/binaries.ts и не должен попасть в клиентский бандл.
// Финальная правда всё равно за ffprobe на сервере (Task 12): эта проверка —
// быстрый отказ до загрузки тяжёлого файла, а не единственная защита.
const MAX_DURATION_SEC = 61.0;

// Длительность нужна дальнейшей обработке. На части .MOV браузер её не отдаёт —
// тогда просто не показываем её, а не блокируем загрузку.
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(0);
    };
    video.src = URL.createObjectURL(file);
  });
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.round(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function UploadForm({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");

  const tooLong = durationSec > MAX_DURATION_SEC;

  async function onPick(picked: File | null) {
    setFile(picked);
    setStage("idle");
    setMessage("");
    setDurationSec(picked ? await readDuration(picked) : 0);
  }

  async function onSubmit() {
    if (!file || tooLong) return;
    try {
      setStage("uploading");
      const blob = await upload(`sub/sources/${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: token,
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });

      setStage("starting");
      const res = await fetch("/api/sub/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, blobUrl: blob.url, durationSec }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "не вышло");

      setStage("done");
    } catch (error) {
      setStage("error");
      setMessage((error as Error).message);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept="video/*"
        onChange={(event) => void onPick(event.target.files?.[0] ?? null)}
        disabled={stage === "uploading" || stage === "starting"}
      />

      {file && durationSec > 0 && !tooLong && <p>Длительность {formatDuration(durationSec)}.</p>}
      {file && durationSec === 0 && <p>Длительность не определилась — посчитаю на сервере.</p>}
      {file && tooLong && (
        <p style={{ color: "crimson" }}>
          Ролик длиннее 61 секунды ({formatDuration(durationSec)}). Обрежь и загрузи снова.
        </p>
      )}

      <button
        onClick={() => void onSubmit()}
        disabled={!file || tooLong || stage === "uploading" || stage === "starting" || stage === "done"}
      >
        Загрузить
      </button>

      {stage === "uploading" && <p>Загрузка: {progress}%</p>}
      {stage === "starting" && <p>Отправляю в обработку…</p>}
      {stage === "done" && <p>Готово. Ролик придёт в Telegram — вкладку можно закрыть.</p>}
      {stage === "error" && <p style={{ color: "crimson" }}>Ошибка: {message}</p>}
    </div>
  );
}
