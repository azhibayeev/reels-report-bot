import { describe, it, expect } from "vitest";
import { assEscape } from "../lib/escape";

describe("assEscape", () => {
  it("экранирует двоеточие обратным слэшем", () => {
    expect(assEscape("C:/tmp/t.ass")).toBe("C\\:/tmp/t.ass");
  });

  it("экранирует обратный слэш удвоением", () => {
    expect(assEscape("C:\\tmp\\t.ass")).toBe("C\\:\\\\tmp\\\\t.ass");
  });

  it("экранирует апостроф", () => {
    expect(assEscape("/tmp/it's/t.ass")).toBe("/tmp/it\\'s/t.ass");
  });

  it("путь без спецсимволов не меняет", () => {
    expect(assEscape("/tmp/probe-abc123/t.ass")).toBe("/tmp/probe-abc123/t.ass");
  });
});
