import { describe, it, expect, vi } from "vitest";
import { renderArgs, renderSubs } from "../lib/render";

const opts = {
  srcPath: "/tmp/x/src.mp4",
  assPath: "/tmp/x/cues.ass",
  fontsDir: "/var/task/assets",
  outPath: "/tmp/x/out.mp4",
  preset: "veryfast" as const,
};

describe("renderArgs", () => {
  it("не трогает звук", () => {
    expect(renderArgs(opts)).toContain("copy");
    const a = renderArgs(opts);
    expect(a[a.indexOf("-c:a") + 1]).toBe("copy");
  });

  it("вшивает субтитры фильтром subtitles с fontsdir", () => {
    const a = renderArgs(opts);
    const vf = a[a.indexOf("-vf") + 1];
    expect(vf).toContain("subtitles=");
    expect(vf).toContain("fontsdir=");
  });

  it("экранирует двоеточия в путях", () => {
    const a = renderArgs({ ...opts, assPath: "/tmp/a:b/cues.ass" });
    expect(a[a.indexOf("-vf") + 1]).toContain("a\\:b");
  });

  it("ставит переданный пресет", () => {
    expect(renderArgs({ ...opts, preset: "ultrafast" })).toContain("ultrafast");
  });

  it("готовит файл к быстрому старту в плеере", () => {
    expect(renderArgs(opts)).toContain("+faststart");
  });
});

describe("renderSubs", () => {
  it("на ненулевом коде бросает ошибку с хвостом stderr", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stderr: "boom".repeat(400), stdout: "" });
    await expect(renderSubs(run, opts)).rejects.toThrow(/ffmpeg вышел с кодом 1/);
  });

  it("на нулевом коде не бросает", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stderr: "", stdout: "" });
    await expect(renderSubs(run, opts)).resolves.toBeUndefined();
  });
});
