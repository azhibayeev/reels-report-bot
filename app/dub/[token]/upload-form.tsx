"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { safeName } from "../../../lib/dub/uploads";

type Stage = "idle" | "uploading" | "done" | "error";

const button = {
  padding: "12px 20px",
  fontSize: 16,
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
} as const;

export default function UploadForm({
  token,
  jobId,
  maxBytes,
}: {
  token: string;
  jobId: string;
  maxBytes: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");

  const tooBig = file !== null && file.size > maxBytes;
  const busy = stage === "uploading";

  async function onSubmit() {
    if (!file || tooBig) return;
    setStage("uploading");
    setError("");
    try {
      // multipart: сотня мегабайт одним запросом с телефона рвётся на первом же
      // провале сети, а части докачиваются.
      await upload(`dub/sources/${jobId}-${safeName(file.name)}`, file, {
        access: "public",
        handleUploadUrl: "/api/dub/upload",
        clientPayload: token,
        multipart: true,
        onUploadProgress: ({ percentage }) => setPercent(Math.round(percentage)),
      });
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  if (stage === "done") {
    return (
      <section>
        <h2>Готово</h2>
        <p>Ролик у бота. Возвращайся в Telegram — статус и дубляж придут туда.</p>
        <p style={{ color: "#777" }}>Страницу можно закрыть.</p>
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <input
        type="file"
        accept="video/*,audio/*"
        disabled={busy}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setStage("idle");
          setPercent(0);
        }}
      />

      {file && (
        <div style={{ color: tooBig ? "#b00" : "#555" }}>
          {file.name} — {(file.size / 1024 / 1024).toFixed(1)} МБ
          {tooBig && ` (больше ${Math.round(maxBytes / 1024 / 1024)} МБ — такой не возьмём)`}
        </div>
      )}

      <button style={{ ...button, opacity: !file || tooBig || busy ? 0.5 : 1 }} disabled={!file || tooBig || busy} onClick={onSubmit}>
        {busy ? `Заливаю… ${percent}%` : "Загрузить"}
      </button>

      {busy && (
        <div style={{ height: 6, background: "#eee", borderRadius: 3 }}>
          <div style={{ height: "100%", width: `${percent}%`, background: "#111", borderRadius: 3 }} />
        </div>
      )}

      {stage === "error" && <div style={{ color: "#b00" }}>Не вышло: {error}</div>}
    </section>
  );
}
