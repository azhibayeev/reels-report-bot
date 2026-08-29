import { describe, expect, it, vi } from "vitest";
import { ageSec, dubbedName, JOB_DEADLINE_MS, PollDeps, pollJobs, SWEEP_MINUTE } from "../lib/dub/deliver";
import { DubJob, isDeliveryStuck, DELIVERY_TAKEOVER_MS } from "../lib/dub/jobs";
import { UPLOAD_LIMIT } from "../lib/dub/telegram";

const NOW = Date.parse("2026-08-24T10:00:00.000Z");

const base: DubJob = {
  jobId: "77-5",
  chatId: 77,
  statusMessageId: 5,
  dubbingId: "dub_1",
  filename: "reels.mp4",
  watermarked: false,
  createdAt: new Date(NOW - 60_000).toISOString(),
};

function deps(jobs: DubJob[], over: Partial<PollDeps> = {}): PollDeps & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    save: [],
    del: [],
    video: [],
    audio: [],
    edit: [],
    delMsg: [],
    delBlob: [],
    put: [],
    sweep: [],
    burn: [],
  };
  const d = {
    listJobs: async () => jobs,
    saveJob: async (j: DubJob) => void calls.save.push([j]),
    deleteJob: async (id: string) => void calls.del.push([id]),
    getStatus: async () => ({ status: "dubbed", error: null, contentType: "video/mp4" }),
    download: async () => Buffer.alloc(1024),
    sendVideo: async (...a: unknown[]) => void calls.video.push(a),
    sendAudio: async (...a: unknown[]) => void calls.audio.push(a),
    editMessage: async (...a: unknown[]) => void calls.edit.push(a),
    deleteMessage: async (...a: unknown[]) => void calls.delMsg.push(a),
    deleteBlob: async (url?: string) => void calls.delBlob.push([url]),
    putResult: async (pathname: string, video: Buffer, contentType: string) => {
      calls.put.push([pathname, video.length, contentType]);
      return "https://blob.example/dub/out/77-5-reels-id.mp4";
    },
    sweep: async (keep: Set<string>, nowMs: number) => {
      calls.sweep.push([[...keep], nowMs]);
      return 0;
    },
    burnSubtitles: async (video: Buffer, dubbingId: string) => {
      calls.burn.push([video.length, dubbingId]);
      return Buffer.alloc(video.length + 7); // «вжатый» ролик отличим по размеру
    },
    ...over,
  } as PollDeps;
  return Object.assign(d, { calls });
}

describe("pollJobs", () => {
  it("готовую задачу отдаёт и убирает и статус, и запись", async () => {
    const d = deps([base]);
    const res = await pollJobs(d, NOW);
    expect(res).toEqual({ checked: 1, delivered: 1, failed: 0 });
    expect(d.calls.video[0][2]).toBe("reels-id.mp4");
    expect(d.calls.delMsg[0]).toEqual([77, 5]);
    expect(d.calls.del[0]).toEqual(["77-5"]);
  });

  it("вторую готовую оставляет следующему тику — 50 МБ дважды за вызов не выгрузить", async () => {
    const d = deps([base, { ...base, jobId: "77-6", dubbingId: "dub_2" }]);
    const res = await pollJobs(d, NOW);
    expect(res.delivered).toBe(1);
    expect(d.calls.video).toHaveLength(1);
    expect(d.calls.del).toEqual([["77-5"]]);
  });

  it("незавершённой обновляет статус и ничего не удаляет", async () => {
    const d = deps([base], { getStatus: async () => ({ status: "dubbing", error: null, contentType: "video/mp4" }) });
    const res = await pollJobs(d, NOW);
    expect(res).toEqual({ checked: 1, delivered: 0, failed: 0 });
    expect(d.calls.edit[0]).toEqual([77, 5, "Дублирую… 60 с"]);
    expect(d.calls.del).toHaveLength(0);
  });

  it("сбой ElevenLabs объясняет человеку и снимает задачу", async () => {
    const d = deps([base], { getStatus: async () => ({ status: "failed", error: "no speech detected", contentType: null }) });
    const res = await pollJobs(d, NOW);
    expect(res.failed).toBe(1);
    expect(String(d.calls.edit[0][2])).toContain("no speech detected");
    expect(d.calls.del[0]).toEqual(["77-5"]);
  });

  it("просроченную снимает, не спрашивая ElevenLabs: иначе она опрашивалась бы вечно", async () => {
    const getStatus = vi.fn(async () => ({ status: "dubbing", error: null, contentType: null }));
    const stale = { ...base, createdAt: new Date(NOW - JOB_DEADLINE_MS - 1).toISOString() };
    const d = deps([stale], { getStatus });
    const res = await pollJobs(d, NOW);
    expect(res.failed).toBe(1);
    expect(getStatus).not.toHaveBeenCalled();
    expect(d.calls.del[0]).toEqual(["77-5"]);
  });

  it("живую чужую доставку не трогает — ролик уже качается в другом вызове", async () => {
    const busy = { ...base, deliveringAt: new Date(NOW - 1000).toISOString() };
    const d = deps([busy]);
    const res = await pollJobs(d, NOW);
    expect(res.delivered).toBe(0);
    expect(d.calls.video).toHaveLength(0);
  });

  it("зависшую доставку перехватывает: отдать ролик заново лучше, чем не отдать вовсе", async () => {
    const dead = { ...base, deliveringAt: new Date(NOW - DELIVERY_TAKEOVER_MS - 1).toISOString() };
    const d = deps([dead]);
    expect((await pollJobs(d, NOW)).delivered).toBe(1);
  });

  it("результат тяжелее 50 МБ уходит ссылкой: Telegram его не примет, но и терять готовое незачем", async () => {
    const d = deps([base], { download: async () => Buffer.alloc(UPLOAD_LIMIT + 1) });
    const res = await pollJobs(d, NOW);
    expect(res.delivered).toBe(1);
    expect(d.calls.video).toHaveLength(0);
    expect(d.calls.put[0][0]).toBe("dub/out/77-5-reels-id.mp4");
    expect(String(d.calls.edit[0][2])).toContain("50 МБ");
    expect(String(d.calls.edit[0][2])).toContain("https://blob.example/");
    expect(d.calls.del[0]).toEqual(["77-5"]);
  });

  it("исходник из страницы загрузки удаляется вместе с задачей — иначе он лежит в Blob вечно", async () => {
    const uploaded = { ...base, blobUrl: "https://blob.example/dub/sources/77-5-reels.mp4" };
    const ok = deps([uploaded]);
    await pollJobs(ok, NOW);
    expect(ok.calls.delBlob[0]).toEqual(["https://blob.example/dub/sources/77-5-reels.mp4"]);

    const broken = deps([uploaded], {
      getStatus: async () => ({ status: "failed", error: "no speech", contentType: null }),
    });
    await pollJobs(broken, NOW);
    expect(broken.calls.delBlob[0]).toEqual(["https://blob.example/dub/sources/77-5-reels.mp4"]);
  });

  it("уборка Blob идёт раз в час и щадит файлы живых задач", async () => {
    const hour = Date.parse("2026-08-24T10:00:00.000Z");
    const live = { ...base, blobUrl: "https://blob.example/dub/sources/live.mp4" };

    const quiet = deps([live], { getStatus: async () => ({ status: "dubbing", error: null, contentType: null }) });
    await pollJobs(quiet, hour + (SWEEP_MINUTE + 1) * 60_000);
    expect(quiet.calls.sweep).toHaveLength(0);

    const sweeping = deps([live], { getStatus: async () => ({ status: "dubbing", error: null, contentType: null }) });
    await pollJobs(sweeping, hour + SWEEP_MINUTE * 60_000);
    expect(sweeping.calls.sweep[0][0]).toEqual(["https://blob.example/dub/sources/live.mp4"]);
  });

  it("упавшая уборка не роняет проход: доставка важнее чистоты хранилища", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps([base], {
      sweep: async () => {
        throw new Error("Blob 500");
      },
    });
    const res = await pollJobs(d, Date.parse("2026-08-24T10:07:00.000Z"));
    expect(res.delivered).toBe(1);
    spy.mockRestore();
  });

  it("на «с субтитрами» уходит вжатый ролик, а не исходный дубляж", async () => {
    const d = deps([{ ...base, subtitles: true }]);
    await pollJobs(d, NOW);
    expect(d.calls.burn[0]).toEqual([1024, "dub_1"]);
    expect((d.calls.video[0][1] as Buffer).length).toBe(1031);
    expect(String(d.calls.edit[0][2])).toBe("Вжигаю субтитры…");
    expect(String(d.calls.video[0][3])).not.toContain("не легли");
  });

  it("без просьбы субтитры не трогаем", async () => {
    const d = deps([base]);
    await pollJobs(d, NOW);
    expect(d.calls.burn).toHaveLength(0);
  });

  it("голосовое вжигать некуда — субтитры пропускаем, дубляж отдаём", async () => {
    const d = deps([{ ...base, subtitles: true }], {
      getStatus: async () => ({ status: "dubbed", error: null, contentType: "audio/mpeg" }),
    });
    await pollJobs(d, NOW);
    expect(d.calls.burn).toHaveLength(0);
    expect(d.calls.audio).toHaveLength(1);
  });

  it("сорвавшиеся субтитры не съедают дубляж: ролик уходит как есть и с честной пометкой", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps([{ ...base, subtitles: true }], {
      burnSubtitles: async () => {
        throw new Error("ffmpeg вышел с кодом 1");
      },
    });
    const res = await pollJobs(d, NOW);
    expect(res.delivered).toBe(1);
    expect((d.calls.video[0][1] as Buffer).length).toBe(1024);
    expect(String(d.calls.video[0][3])).toContain("субтитры не легли");
    spy.mockRestore();
  });

  it("падение одной задачи не уносит остальные", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps([{ ...base, jobId: "77-4", dubbingId: "bad" }, base], {
      getStatus: async (id: string) => {
        if (id === "bad") throw new Error("500");
        return { status: "dubbed", error: null, contentType: "video/mp4" };
      },
    });
    const res = await pollJobs(d, NOW);
    expect(res.delivered).toBe(1);
    expect(d.calls.del).toEqual([["77-5"]]);
    spy.mockRestore();
  });

  it("размеры исходника уходят в Telegram — иначе он рисует ролик квадратом", async () => {
    const d = deps([{ ...base, width: 1080, height: 1920, duration: 17.9 }]);
    await pollJobs(d, NOW);
    expect(d.calls.video[0][4]).toEqual({ width: 1080, height: 1920, duration: 17.9 });
  });

  it("аудио отдаёт аудио-методом: голосовое не видео", async () => {
    const d = deps([base], {
      getStatus: async () => ({ status: "dubbed", error: null, contentType: "audio/mpeg" }),
    });
    await pollJobs(d, NOW);
    expect(d.calls.video).toHaveLength(0);
    expect(d.calls.audio[0][2]).toBe("reels-id.mp3");
  });

  it("водяной знак попадает в подпись, чистый дубляж — нет", async () => {
    const clean = deps([base]);
    await pollJobs(clean, NOW);
    expect(String(clean.calls.video[0][3])).not.toContain("водяным");

    const marked = deps([{ ...base, watermarked: true }]);
    await pollJobs(marked, NOW);
    expect(String(marked.calls.video[0][3])).toContain("водяным");
  });
});

describe("вспомогательные", () => {
  it("возраст задачи не уходит в минус при часах, сбитых назад", () => {
    expect(ageSec({ ...base, createdAt: new Date(NOW + 5000).toISOString() }, NOW)).toBe(0);
  });

  it("имя результата помечено языком и всегда mp4", () => {
    expect(dubbedName("reels.mov")).toBe("reels-id.mp4");
    expect(dubbedName("video-note")).toBe("video-note-id.mp4");
  });

  it("задача без отметки доставки считается свободной, иначе статус залипнет навсегда", () => {
    expect(isDeliveryStuck(base, NOW)).toBe(true);
    expect(isDeliveryStuck({ ...base, deliveringAt: "не дата" }, NOW)).toBe(true);
  });
});
