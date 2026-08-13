"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { estimateCredits, formatDuration } from "../../../lib/credits";

type Stage = "idle" | "uploading" | "starting" | "done" | "error";

// Длительность нужна, чтобы показать цену до запуска. На части .MOV браузер её
// не отдаёт — тогда просто не показываем оценку, а не блокируем загрузку.
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

export default function UploadForm({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");

  async function onPick(picked: File | null) {
    setFile(picked);
    setStage("idle");
    setMessage("");
    setDurationSec(picked ? await readDuration(picked) : 0);
  }

  async function onSubmit() {
    if (!file) return;
    try {
      setStage("uploading");
      const blob = await upload(`dub/sources/${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: token,
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });

      setStage("starting");
      const res = await fetch("/api/dub/start", {
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

  const credits = estimateCredits(durationSec);

  return (
    <div>
      <input
        type="file"
        accept="video/*"
        onChange={(event) => void onPick(event.target.files?.[0] ?? null)}
        disabled={stage === "uploading" || stage === "starting"}
      />

      {file && durationSec > 0 && (
        <p>
          Длительность {formatDuration(durationSec)} — примерно {credits} кредитов.
        </p>
      )}
      {file && durationSec === 0 && <p>Длительность не определилась — посчитаю на сервере.</p>}

      <button
        onClick={() => void onSubmit()}
        disabled={!file || stage === "uploading" || stage === "starting" || stage === "done"}
      >
        Дублировать
      </button>

      {stage === "uploading" && <p>Загрузка: {progress}%</p>}
      {stage === "starting" && <p>Отправляю в обработку…</p>}
      {stage === "done" && <p>Готово. Ролик придёт в Telegram — вкладку можно закрыть.</p>}
      {stage === "error" && <p style={{ color: "crimson" }}>Ошибка: {message}</p>}
    </div>
  );
}
