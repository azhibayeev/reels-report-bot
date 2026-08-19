import { describe, expect, it } from "vitest";
import { parseBlocks } from "../lib/farm/parse";

describe("parseBlocks", () => {
  it("первая строка блока — хук, остальное — описание", () => {
    const { pairs, errors } = parseBlocks("Хук один\nОписание раз\nвторая строка\n---\nХук два\nОписание два");
    expect(errors).toEqual([]);
    expect(pairs).toEqual([
      { hook: "Хук один", caption: "Описание раз\nвторая строка" },
      { hook: "Хук два", caption: "Описание два" },
    ]);
  });

  it("переносит \\r\\n и терпит лишние разделители и пустые блоки", () => {
    const { pairs, errors } = parseBlocks("Хук\r\nСтрока1\r\nСтрока2\r\n---\n---\n\n---\nХук два\nОписание два\n");
    expect(errors).toEqual([]);
    expect(pairs).toEqual([
      { hook: "Хук", caption: "Строка1\nСтрока2" },
      { hook: "Хук два", caption: "Описание два" },
    ]);
  });

  it("блок без описания — ошибка с номером блока", () => {
    const { pairs, errors } = parseBlocks("Только хук");
    expect(pairs).toHaveLength(0);
    expect(errors).toEqual(["блок 1: есть хук, но нет описания"]);
  });

  it("описание длиннее 2200 знаков — ошибка", () => {
    const { errors } = parseBlocks(`Хук\n${"я".repeat(2201)}`);
    expect(errors).toEqual(["блок 1: описание 2201 знаков, лимит 2200"]);
  });
});
