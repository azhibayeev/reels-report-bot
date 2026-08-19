"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import { parseHookList } from "../../../lib/farm/parse";
import { validateGroups } from "../../../lib/farm/start";
import {
  DEFAULT_DURATION,
  REEL_DURATIONS,
  type HookPosition,
  type ReelDuration,
} from "../../../lib/farm/types";

type Stage = "idle" | "uploading" | "starting" | "done" | "error";

interface Group {
  hooksText: string;
  caption: string;
  music: File | null;
}

const POSITION_LABELS: Record<HookPosition, string> = {
  top: "Верх",
  center: "Центр",
  bottom: "Низ",
};

const EMPTY_GROUP: Group = { hooksText: "", caption: "", music: null };

// Черновик текста живёт в браузере: хуки и описания набираются долго, а
// обновление страницы или случайное закрытие вкладки стирало их подчистую.
// Файлы так сохранить нельзя — их придётся выбрать заново.
const DRAFT_KEY = "farm-batch-draft";

interface Draft {
  groups: { hooksText: string; caption: string }[];
  position: HookPosition;
  seconds: ReelDuration;
}

export default function BatchForm({
  token,
  defaultPosition,
}: {
  token: string;
  defaultPosition: HookPosition;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [groups, setGroups] = useState<Group[]>([{ ...EMPTY_GROUP }]);
  const [position, setPosition] = useState<HookPosition>(defaultPosition);
  const [seconds, setSeconds] = useState<ReelDuration>(DEFAULT_DURATION);
  const [stage, setStage] = useState<Stage>("idle");
  const [done, setDone] = useState(0);
  const [message, setMessage] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  // Восстановление после монтирования, а не в useState: на сервере localStorage
  // нет, и чтение при первом рендере разошлось бы с серверной разметкой.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<Draft>;
      if (Array.isArray(draft.groups) && draft.groups.length > 0) {
        setGroups(draft.groups.map((g) => ({ hooksText: g.hooksText ?? "", caption: g.caption ?? "", music: null })));
      }
      if (draft.position) setPosition(draft.position);
      if (draft.seconds) setSeconds(draft.seconds);
    } catch {
      // Битый черновик — не повод ломать форму: начнём с пустой.
    }
  }, []);

  useEffect(() => {
    try {
      const draft: Draft = {
        groups: groups.map((g) => ({ hooksText: g.hooksText, caption: g.caption })),
        position,
        seconds,
      };
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Переполнилось хранилище или приватный режим — черновик не критичен.
    }
  }, [groups, position, seconds]);

  // Результаты заливки переживают неудачную попытку (ретрай не льёт заново уже
  // загруженные файлы). Ref, а не state: обновление на каждый файл в трёх
  // воркерах не должно дёргать ре-рендер — рендер дёргает только setDone.
  const resultsRef = useRef<({ url: string; bytes: number } | undefined)[]>([]);

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

  function patchGroup(index: number, patch: Partial<Group>) {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
    setStage("idle");
    setMessage("");
  }

  // Пересчитывается на каждый рендер, без useEffect: цена — лишние вызовы
  // разбора на ввод текста, а не рассинхрон состояния.
  const parsed = groups.map((g) => ({ hooks: parseHookList(g.hooksText), caption: g.caption }));
  const picked = files.map((f) => ({ url: f.name, bytes: f.size }));
  const errors = validateGroups(parsed, picked);
  const hookCount = parsed.reduce((sum, g) => sum + g.hooks.length, 0);
  const totalMb = (files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1);

  const busy = stage === "uploading" || stage === "starting";
  const disabled = errors.length > 0 || busy || stage === "done";

  async function onSubmit() {
    try {
      setStage("uploading");

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

      // Дорожки льём после видео и по одной: их мало, а параллелить ради двух
      // файлов нечего.
      const groupsPayload = [];
      for (const [i, group] of groups.entries()) {
        let musicUrl: string | null = null;
        if (group.music) {
          const safe = group.music.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
          const blob = await upload(`farm/sources/music-${Date.now()}-${i}-${safe}`, group.music, {
            access: "public",
            handleUploadUrl: "/api/farm/upload",
            clientPayload: token,
            multipart: true,
          });
          musicUrl = blob.url;
        }
        groupsPayload.push({ hooks: parsed[i].hooks, caption: group.caption, musicUrl });
      }

      setStage("starting");
      const res = await fetch("/api/farm/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, files: results, groups: groupsPayload, position, seconds }),
      });
      const data = (await res.json()) as { ok?: boolean; total?: number; error?: string };
      if (!res.ok || !data.ok) {
        // Роут сам удаляет уже проверенные файлы из Blob при своей ошибке —
        // сохранённые url мертвы, ретрай с ними отправил бы ссылки в никуда.
        resultsRef.current = [];
        throw new Error(data.error ?? "не вышло");
      }

      setTotal(data.total ?? hookCount);
      setStage("done");
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Не смогли убрать черновик — он просто перезапишется следующей пачкой.
      }
      resultsRef.current = []; // успех — следующая пачка начнётся с чистого кэша
    } catch (error) {
      setStage("error");
      setMessage((error as Error).message);
    }
  }

  const box = {
    width: "100%",
    boxSizing: "border-box" as const,
    fontFamily: "monospace",
    fontSize: "0.9rem",
  };
  const card = {
    border: "1px solid #d5ded7",
    borderRadius: 6,
    padding: "1rem",
    marginBottom: "1rem",
  };

  return (
    <div>
      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".3rem" }}>1. Видео-подложки</h2>
        <p style={{ margin: "0 0 .5rem", color: "#566b60" }}>
          Общий пул: бот сам раздаёт их хукам по кругу. Подложек может быть меньше, чем хуков.
        </p>
        <input
          type="file"
          multiple
          accept="video/*"
          onChange={(event) => onPick(event.target.files)}
          disabled={busy || stage === "done"}
        />
        <p style={{ margin: ".4rem 0 0", color: "#566b60", fontSize: ".9rem" }}>
          Тексты сохраняются в браузере и переживут обновление страницы. Файлы — нет, их придётся
          выбрать заново.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".3rem" }}>2. Хуки и описания</h2>
        <p style={{ margin: "0 0 .75rem", color: "#566b60" }}>
          Одна строка — один хук, нумерацию можно оставить, бот её срежет. Описание общее для всей
          группы: оно уйдёт в подпись под каждым её роликом.
        </p>

        {groups.map((group, i) => (
          <div key={i} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".4rem" }}>
              <strong>Группа {i + 1}</strong>
              <span style={{ color: "#566b60" }}>
                хуков: {parsed[i].hooks.length}
                {groups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setGroups((prev) => prev.filter((_, k) => k !== i))}
                    disabled={busy || stage === "done"}
                    style={{ marginLeft: ".75rem" }}
                  >
                    убрать
                  </button>
                )}
              </span>
            </div>

            <textarea
              value={group.hooksText}
              onChange={(event) => patchGroup(i, { hooksText: event.target.value })}
              rows={8}
              style={box}
              placeholder={"1. Первый хук\n2. Второй хук\n3. Третий хук"}
              disabled={busy || stage === "done"}
            />

            <textarea
              value={group.caption}
              onChange={(event) => patchGroup(i, { caption: event.target.value })}
              rows={5}
              style={{ ...box, marginTop: ".6rem" }}
              placeholder="Описание под все ролики этой группы: текст, призыв, кодовое слово."
              disabled={busy || stage === "done"}
            />

            <p style={{ margin: ".7rem 0 0", fontSize: ".9rem" }}>
              Музыка группы:{" "}
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => patchGroup(i, { music: event.target.files?.[0] ?? null })}
                disabled={busy || stage === "done"}
              />
              <br />
              <span style={{ color: "#566b60" }}>
                Не выбрана — останется звук подложки. Трек короче ролика зациклится.
              </span>
            </p>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setGroups((prev) => [...prev, { ...EMPTY_GROUP }])}
          disabled={busy || stage === "done"}
        >
          + ещё группа
        </button>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: ".3rem" }}>3. Длина ролика</h2>
        <p style={{ margin: "0 0 .4rem", color: "#566b60" }}>
          Одна на всю пачку. Подложка длиннее — обрежется с начала, короче — зациклится.
        </p>
        <p style={{ margin: "0 0 1.2rem" }}>
          {REEL_DURATIONS.map((value) => (
            <label key={value} style={{ marginRight: "1.2rem" }}>
              <input
                type="radio"
                name="seconds"
                checked={seconds === value}
                onChange={() => setSeconds(value)}
                disabled={busy || stage === "done"}
              />{" "}
              {value} сек
            </label>
          ))}
        </p>

        <h2 style={{ fontSize: "1.1rem", marginBottom: ".3rem" }}>4. Позиция хука</h2>
        <p style={{ margin: 0 }}>
          {(Object.keys(POSITION_LABELS) as HookPosition[]).map((value) => (
            <label key={value} style={{ marginRight: "1.2rem" }}>
              <input
                type="radio"
                name="position"
                checked={position === value}
                onChange={() => setPosition(value)}
                disabled={busy || stage === "done"}
              />{" "}
              {POSITION_LABELS[value]}
            </label>
          ))}
        </p>
      </section>

      <p style={{ marginTop: "1.5rem" }}>
        Получится <strong>{hookCount}</strong>{" "}
        {hookCount === 1 ? "ролик" : hookCount < 5 ? "ролика" : "роликов"} из {files.length}{" "}
        {files.length === 1 ? "подложки" : "подложек"}, суммарный вес {totalMb} МБ.
      </p>

      {errors.length > 0 && (
        <ul style={{ color: "crimson", paddingLeft: "1.2rem" }}>
          {errors.slice(0, 8).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errors.length > 8 && <li>…и ещё {errors.length - 8}</li>}
        </ul>
      )}

      <button onClick={() => void onSubmit()} disabled={disabled}>
        Загрузить пачку
      </button>

      {stage === "uploading" && (
        <p>
          Загрузка: {done} / {files.length}
        </p>
      )}
      {stage === "starting" && <p>Собираю пачку…</p>}
      {stage === "done" && (
        <p>
          Готово: {total} роликов в работе. Первые придут в чат через минуту-две — вкладку можно
          закрыть.
        </p>
      )}
      {stage === "error" && <p style={{ color: "crimson" }}>Ошибка: {message}</p>}
    </div>
  );
}
