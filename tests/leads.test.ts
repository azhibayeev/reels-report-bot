import { describe, it, expect } from "vitest";
import { investorLevel } from "../lib/leads";

// Зеркалит pilar-qurany/lib/quiz/investor.ts — тест фиксирует контракт мэппинга.
describe("investorLevel", () => {
  it("high budget → high", () => {
    expect(investorLevel({ kapasitas: "75-150" })).toBe("high");
    expect(investorLevel({ kapasitas: ">150" })).toBe("high");
    expect(investorLevel({ kapasitas: "langsung" })).toBe("high");
  });

  it("tier A + institutional → high even without high budget", () => {
    expect(investorLevel({ warisan: "lembaga" }, "A")).toBe("high");
  });

  it("mid budget → medium", () => {
    expect(investorLevel({ kapasitas: "30-75" })).toBe("medium");
  });

  it("institutional + autonomous → medium", () => {
    expect(investorLevel({ warisan: "lembaga", keputusan: "sendiri" })).toBe("medium");
  });

  it("tier B → medium", () => {
    expect(investorLevel({}, "B")).toBe("medium");
  });

  it("everything else → low", () => {
    expect(investorLevel({ kapasitas: "20-30" })).toBe("low");
    expect(investorLevel({})).toBe("low");
    expect(investorLevel({}, "C")).toBe("low");
  });
});
