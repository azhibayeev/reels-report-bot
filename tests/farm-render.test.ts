import { describe, expect, it, vi } from "vitest";
import { ffmpegArgs, renderHook } from "../lib/farm/render";

const spec = {
  sourcePath: "/tmp/src.mp4",
  textPaths: ["/tmp/hook-0.txt", "/tmp/hook-1.txt"],
  outPath: "/tmp/out.mp4",
  fontPath: "/app/assets/hook.ttf",
  hookLines: ["Jangan tunggu", "Ramadan"],
  hasAudio: true,
};

describe("ffmpegArgs", () => {
  it("кадрирует в 1080x1920 и берёт текст из файла, а не из строки фильтра", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(args).toContain("crop=1080:1920");
    expect(args).toContain("textfile=/tmp/hook-0.txt");
    expect(args).toContain("textfile=/tmp/hook-1.txt");
    expect(args).not.toMatch(/(?<!draw)text=/);
  });

  it("даёт ровно один drawtext на строку хука, с разными textfile и y", () => {
    const args = ffmpegArgs(spec).join(" ");
    const matches = args.match(/drawtext=/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(args).toContain("y=h*0.18");
    expect(args).toContain("y=h*0.18+64");
  });

  it("третья строка хука сдвигается на +128", () => {
    const args = ffmpegArgs({ ...spec, hookLines: ["a", "b", "c"], textPaths: ["/tmp/0", "/tmp/1", "/tmp/2"] }).join(
      " "
    );
    expect(args).toContain("y=h*0.18+128");
  });

  it.each([
    ["top", "0.18", undefined],
    ["center", "0.42", "center" as const],
    ["bottom", "0.62", "bottom" as const],
  ])("пресет позиции %s даёт множитель %s", (_label, multiplier, position) => {
    const args = ffmpegArgs({ ...spec, position }).join(" ");
    expect(args).toContain(`y=h*${multiplier}`);

    for (const other of ["0.18", "0.42", "0.62"]) {
      if (other === multiplier) continue;
      expect(args).not.toContain(`y=h*${other}`);
    }

    // подстрока "y=h*0.18" содержится и внутри "y=h*0.18+64" — считаем точные
    // вхождения, чтобы не спутать первую строку хука со второй
    const escaped = multiplier.replace(".", "\\.");
    const exact = args.match(new RegExp(`y=h\\*${escaped}(?:\\+\\d+)?(?=[, ]|$)`, "g")) ?? [];
    expect(exact).toHaveLength(spec.hookLines.length);
  });

  it("держит параметры стиля и потолок длительности", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("fontsize=54");
    expect(args).toContain("borderw=3");
    expect(args).toContain("bordercolor=black");
    expect(args).toContain("shadowcolor=black@0.5");
    expect(args).toContain("shadowx=2");
    expect(args).toContain("shadowy=3");
    expect(args).toContain("-t 90");
    expect(args).toContain("-movflags +faststart");
    expect(args).toContain("expansion=none");
  });

  it("expansion=none стоит в каждом блоке drawtext, а не в одном", () => {
    const twoLine = ffmpegArgs(spec).join(" ");
    expect(twoLine.match(/expansion=none/g) ?? []).toHaveLength(spec.hookLines.length);

    const threeLineSpec = { ...spec, hookLines: ["a", "b", "c"], textPaths: ["/tmp/0", "/tmp/1", "/tmp/2"] };
    const threeLine = ffmpegArgs(threeLineSpec).join(" ");
    expect(threeLine.match(/expansion=none/g) ?? []).toHaveLength(threeLineSpec.hookLines.length);
  });

  it("без звука в исходнике подмешивает тишину: IG надёжнее принимает ролик со звуковой дорожкой", () => {
    const args = ffmpegArgs({ ...spec, hasAudio: false }).join(" ");
    expect(args).toContain("anullsrc");
    expect(args).toContain("-shortest");
  });
});

describe("renderHook", () => {
  const fontReadable = async () => true;

  it("пишет каждую строку хука в свой файл перед запуском", async () => {
    const writeText = vi.fn(async () => {});
    const runner = vi.fn(async () => ({ code: 0, stderr: "" }));

    await renderHook(spec, { runner, writeText, ffmpegPath: "/bin/ffmpeg", fontReadable });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledWith("/tmp/hook-0.txt", "Jangan tunggu");
    expect(writeText).toHaveBeenCalledWith("/tmp/hook-1.txt", "Ramadan");
    expect(runner).toHaveBeenCalledWith("/bin/ffmpeg", expect.arrayContaining(["-i", "/tmp/src.mp4"]));
  });

  it("нечитаемый шрифт — отказ с путём к шрифту, ffmpeg не запускается", async () => {
    const writeText = vi.fn(async () => {});
    const runner = vi.fn(async () => ({ code: 0, stderr: "" }));

    await expect(
      renderHook(spec, { runner, writeText, ffmpegPath: "/bin/ffmpeg", fontReadable: async () => false })
    ).rejects.toThrow(/шрифт.*\/app\/assets\/hook\.ttf/i);

    expect(runner).not.toHaveBeenCalled();
  });

  it("рассинхрон hookLines и textPaths — отказ с обоими числами, без записи файлов и запуска ffmpeg", async () => {
    const writeText = vi.fn(async () => {});
    const runner = vi.fn(async () => ({ code: 0, stderr: "" }));
    const mismatched = { ...spec, hookLines: ["Jangan tunggu", "Ramadan", "lagi"], textPaths: ["/tmp/hook-0.txt"] };

    await expect(
      renderHook(mismatched, { runner, writeText, ffmpegPath: "/bin/ffmpeg", fontReadable })
    ).rejects.toThrow(/3.*1|1.*3/);

    expect(writeText).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it("ненулевой код возврата — ошибка с хвостом stderr", async () => {
    const runner = vi.fn(async () => ({ code: 1, stderr: "x".repeat(900) + "boom" }));
    await expect(
      renderHook(spec, { runner, writeText: async () => {}, ffmpegPath: "/bin/ffmpeg", fontReadable })
    ).rejects.toThrow(/boom/);
  });
});
