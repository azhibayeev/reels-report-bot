import { describe, expect, it } from "vitest";
import { ffmpegArgs, REEL_SECONDS } from "../lib/farm/render";

const spec = {
  sourcePath: "/tmp/src.mp4",
  overlayPath: "/tmp/hook.png",
  textPaths: [],
  outPath: "/tmp/out.mp4",
  fontPath: "/app/assets/hook.ttf",
  hookLines: ["Первая строка", "Вторая строка"],
  hasAudio: true,
  position: "top" as const,
};

describe("ffmpegArgs", () => {
  it("кадрирует в 1080x1920 и накладывает хук картинкой", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(args).toContain("crop=1080:1920");
    expect(args).toContain("[bg][1:v]overlay=0:0[v]");
    // drawtext в линуксовой сборке ffmpeg-static отсутствует — если он вернётся
    // в аргументы, прод снова упадёт с «Filter not found».
    expect(args).not.toContain("drawtext");
  });

  it("зацикливает подложку и режет по выбранной длине", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("-stream_loop -1");
    expect(args).toContain(`-t ${REEL_SECONDS}`);
    expect(args).toContain("-movflags +faststart");
  });

  it("выбранная длина попадает и в -t, и в обрезку музыки, и в затухание", () => {
    const args = ffmpegArgs({ ...spec, seconds: 15, musicPath: "/tmp/track.m4a" }).join(" ");
    expect(args).toContain("-t 15");
    expect(args).toContain("atrim=duration=15");
    expect(args).toContain("afade=t=out:st=14.4:d=0.6");
  });

  it("своя дорожка зацикливается фильтром и вытесняет звук подложки", () => {
    const args = ffmpegArgs({ ...spec, musicPath: "/tmp/track.m4a" }).join(" ");
    expect(args).toContain("aloop=loop=-1");
    expect(args).toContain("volume=0.5");
    // Второй -stream_loop на аудиовходе уводит ffmpeg в вечный цикл.
    expect(args.match(/-stream_loop/g) ?? []).toHaveLength(1);
    expect(args).not.toContain("anullsrc");
  });

  it("без звука в подложке подмешивает тишину: IG надёжнее принимает ролик с дорожкой", () => {
    const args = ffmpegArgs({ ...spec, hasAudio: false }).join(" ");
    expect(args).toContain("anullsrc");
  });

  it("звук подложки берётся необязательным маппингом: ролик без дорожки не роняет рендер", () => {
    const args = ffmpegArgs(spec).join(" ");
    expect(args).toContain("-map 0:a:0?");
  });

  it("без картинки хука кадр всё равно собирается", () => {
    const args = ffmpegArgs({ ...spec, overlayPath: undefined }).join(" ");
    expect(args).toContain("-map [bg]");
    expect(args).not.toContain("overlay");
  });
});
