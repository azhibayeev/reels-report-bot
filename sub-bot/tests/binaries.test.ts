import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { ffmpegPath, ffprobePath, fontPath, FFMPEG_SHA256 } from "../lib/binaries";

describe("binaries", () => {
  it("находит все три файла", () => {
    expect(existsSync(ffmpegPath())).toBe(true);
    expect(existsSync(ffprobePath())).toBe(true);
    expect(existsSync(fontPath())).toBe(true);
  });

  it("держит зафиксированный хеш линуксовой сборки", () => {
    expect(FFMPEG_SHA256).toBe(
      "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99"
    );
  });

  it("уважает переопределение путей через окружение", () => {
    process.env.SUB_FONT_PATH = "/nope/font.ttf";
    expect(fontPath()).toBe("/nope/font.ttf");
    delete process.env.SUB_FONT_PATH;
  });
});
