import { describe, it, expect, vi } from "vitest";
import { probeMedia } from "../lib/media";

const json = (o: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify(o) });

describe("probeMedia", () => {
  it("читает длительность и наличие звука", async () => {
    const run = vi.fn().mockResolvedValue(
      json({ format: { duration: "47.2" }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] })
    );
    expect(await probeMedia(run, "/tmp/a.mp4")).toEqual({ durationSec: 47.2, hasAudio: true });
  });

  it("видит отсутствие звуковой дорожки", async () => {
    const run = vi.fn().mockResolvedValue(json({ format: { duration: "10" }, streams: [{ codec_type: "video" }] }));
    expect((await probeMedia(run, "/tmp/a.mp4")).hasAudio).toBe(false);
  });

  it("на мусорном выводе бросает ошибку, а не возвращает ноль", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stderr: "", stdout: "не json" });
    await expect(probeMedia(run, "/tmp/a.mp4")).rejects.toThrow(/ffprobe/);
  });

  it("на ненулевом коде бросает ошибку", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stderr: "нет такого файла", stdout: "" });
    await expect(probeMedia(run, "/tmp/a.mp4")).rejects.toThrow(/ffprobe/);
  });
});
