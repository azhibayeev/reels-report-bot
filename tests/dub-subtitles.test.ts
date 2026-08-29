import { describe, expect, it } from "vitest";
import { burnArgs } from "../lib/dub/subtitles";

const cues = [
  { startSec: 0.739, endSec: 5.335, text: "A" },
  { startSec: 5.335, endSec: 9.529, text: "B" },
];

describe("burnArgs", () => {
  const args = burnArgs({ videoPath: "/t/src.mp4", pngPaths: ["/t/0.png", "/t/1.png"], cues, outPath: "/t/out.mp4" });
  const filter = args[args.indexOf("-filter_complex") + 1];

  it("на каждую реплику — свой вход и своё звено overlay", () => {
    expect(args.filter((a) => a === "-i")).toHaveLength(3); // видео + две картинки
    expect(filter.split(";")).toHaveLength(2);
  });

  it("окно реплики задано enable — вне его композитинга нет вовсе", () => {
    expect(filter).toContain("overlay=0:0:enable='between(t,0.739,5.335)'");
    expect(filter).toContain("overlay=0:0:enable='between(t,5.335,9.529)'");
  });

  it("звенья идут цепочкой: выход предыдущего — вход следующего", () => {
    const [first, second] = filter.split(";");
    expect(first.startsWith("[0:v][1:v]")).toBe(true);
    expect(first.endsWith("[v0]")).toBe(true);
    expect(second.startsWith("[v0][2:v]")).toBe(true);
    expect(args[args.indexOf("-map") + 1]).toBe("[v1]");
  });

  it("звук копируется, а не пережимается: наложение картинки его не касается", () => {
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
    expect(args).toContain("0:a:0?");
  });

  it("масштабирования нет: картинка нарисована в размер кадра и обязана лечь пиксель в пиксель", () => {
    expect(filter).not.toContain("scale=");
  });

  it("рассинхрон картинок и реплик ловится сразу, а не кривым фильтром", () => {
    expect(() =>
      burnArgs({ videoPath: "/t/src.mp4", pngPaths: ["/t/0.png"], cues, outPath: "/t/out.mp4" })
    ).toThrow(/картинок 1.*реплик 2/);
  });
});
