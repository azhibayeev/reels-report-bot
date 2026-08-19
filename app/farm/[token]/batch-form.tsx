"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { parseBlocks } from "../../../lib/farm/parse";
import { validateBatch } from "../../../lib/farm/start";
import type { HookPosition } from "../../../lib/farm/types";

type Stage = "idle" | "uploading" | "starting" | "done" | "error";

const POSITION_LABELS: Record<HookPosition, string> = {
  top: "Верх",
  center: "Центр",
  bottom: "Низ",
};

export default function BatchForm({
  token,
  defaultPosition,
}: {
  token: string;
  defaultPosition: HookPosition;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [position, setPosition] = useState<HookPosition>(defaultPosition);
  const [stage, setStage] = useState<Stage>("idle");
  const [done, setDone] = useState(0);
  const [message, setMessage] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  // Результаты заливки переживают неудачную попытку (ретрай не льёт заново уже
  // загруженные файлы). Ref, а не state: обновление на каждый файл в трёх
  // воркерах не должно дёргать ре-рендер — рендер дёргает только setDone.
  const resultsRef = useRef<({ url: string; bytes: number } | undefined)[]>([]);

  // Порядок файлов задаёт пары «файл N ↔ блок N» — без сортировки по имени он
  // молча зависел бы от порядка выбора в системном диалоге.
  function onPick(list: FileList | null) {
    const picked = list ? [...list] : [];
    picked.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setFiles(picked);
    setStage("idle");
    setMessage("");
    setDone(0);
    setTotal(null);
    resultsRef.current = []; // новый выбор файлов — новая пачка, старые ссылки не годятся
  }

  // Пересчитывается на каждый рендер, без useEffect: цена — лишние вызовы
  // parseBlocks/validateBatch на ввод текста, а не рассинхрон состояния.
  const { pairs, errors: parseErrors } = parseBlocks(text);
  const picked = files.map((f) => ({ url: f.name, bytes: f.size }));
  const errors = [...parseErrors, ...validateBatch({ pairs, files: picked })];
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
  const pairCount = Math.min(files.length, pairs.length);
  // Инвариант parseBlocks: каждый блок текста даёт либо одну пару, либо ровно
  // одну ошибку — значит число блоков это pairs.length + число ошибок разбора,
  // а не pairs.length (иначе битый блок молча пропадает из счётчика).
  const blockCount = pairs.length + parseErrors.length;

  const busy = stage === "uploading" || stage === "starting";
  const disabled = errors.length > 0 || files.length === 0 || busy || stage === "done";

  async function onSubmit() {
    try {
      setStage("uploading");

      // Если ретраим после частичной заливки, массив уже содержит часть
      // результатов с прошлой попытки — их пропускаем в воркере. Длина не
      // совпадёт только на первом заходе или после onPick, где кэш обнулён.
      if (resultsRef.current.length !== files.length) {
        resultsRef.current = new Array(files.length);
      }
      const results = resultsRef.current;
      let next = 0;
      let uploaded = results.filter(Boolean).length;
      setDone(uploaded);

      async function worker() {
        for (;;) {
          const i = next++;
          if (i >= files.length) return;
          if (results[i]) continue; // уже залито в прошлой попытке — не льём мегабайты повторно
          const safe = files[i].name.replace(/[^a-zA-Z0-9._-]+/g, "-");
          const blob = await upload(`farm/sources/${Date.now()}-${i}-${safe}`, files[i], {
            access: "public",
            handleUploadUrl: "/api/farm/upload",
            clientPayload: token,
            multipart: true,
          });
          results[i] = { url: blob.url, bytes: files[i].size };
          uploaded += 1;
          setDone(uploaded);
        }
      }

      // Ровно три воркера: 30+ файлов параллельно уложили бы Blob API,
      // а по одному — слишком долго для пачки такого размера.
      await Promise.all([worker(), worker(), worker()]);

      setStage("starting");
      const res = await fetch("/api/farm/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, files: results, text, position }),
      });
      const data = (await res.json()) as { ok?: boolean; total?: number; error?: string };
      if (!res.ok || !data.ok) {
        // Роут сам удаляет уже проверенные файлы из Blob при своей ошибке —
        // сохранённые url мертвы, ретрай с ними отправил бы ссылки в никуда.
        resultsRef.current = [];
        throw new Error(data.error ?? "не вышло");
      }

      setTotal(data.total ?? results.length);
      setStage("done");
      resultsRef.current = []; // успех — следующая пачка начнётся с чистого кэша
    } catch (error) {
      setStage("error");
      setMessage((error as Error).message);
    }
  }

  return (
    <div>
      <p>
        <input
          type="file"
          multiple
          accept="video/*"
          onChange={(event) => onPick(event.target.files)}
          disabled={busy || stage === "done"}
        />
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={12}
        style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace" }}
        placeholder={"Первый хук\nОписание первого ролика.\n---\nВторой хук\nОписание второго ролика."}
        disabled={busy || stage === "done"}
      />

      <p>
        Позиция хука на видео:{" "}
        {(Object.keys(POSITION_LABELS) as HookPosition[]).map((value) => (
          <label key={value} style={{ marginRight: 12 }}>
            <input
              type="radio"
              name="position"
              value={value}
              checked={position === value}
              onChange={() => setPosition(value)}
              disabled={busy || stage === "done"}
            />{" "}
            {POSITION_LABELS[value]}
          </label>
        ))}
      </p>

      <p>
        Блоков {blockCount} / файлов {files.length}, суммарный вес {totalMb} МБ.
      </p>

      {pairCount > 0 && parseErrors.length === 0 && (
        <ol>
          {files.slice(0, pairCount).map((f, i) => (
            <li key={f.name + i}>
              {f.name} → {pairs[i].hook}
            </li>
          ))}
        </ol>
      )}

      {errors.length > 0 && (
        <ul style={{ color: "crimson" }}>
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}

      <button onClick={() => void onSubmit()} disabled={disabled}>
        Загрузить пачку
      </button>

      {stage === "uploading" && (
        <p>
          Загружено {done}/{files.length}
        </p>
      )}
      {stage === "starting" && <p>Создаю задачи…</p>}
      {stage === "done" && (
        <p>
          Взял пачку: {total} роликов. Ролики придут в Telegram с кнопками — вкладку можно
          закрыть.
        </p>
      )}
      {stage === "error" && <p style={{ color: "crimson" }}>Ошибка: {message}</p>}
    </div>
  );
}
