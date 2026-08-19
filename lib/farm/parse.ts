import { Pair } from "./types";

export const BLOCK_SEPARATOR = "---";
export const MAX_CAPTION = 2200;

export interface ParseResult {
  pairs: Pair[];
  errors: string[];
}

// Описания многострочные, поэтому «одна строка — один ролик» не годится: блоки
// разделяются строкой ---, а первая строка блока считается хуком.
export function parseBlocks(raw: string): ParseResult {
  const blocks = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce<string[][]>(
      (acc, line) => {
        if (line.trim() === BLOCK_SEPARATOR) acc.push([]);
        else acc[acc.length - 1].push(line);
        return acc;
      },
      [[]]
    )
    .map((lines) => lines.join("\n").trim())
    .filter((block) => block.length > 0);

  const pairs: Pair[] = [];
  const errors: string[] = [];

  blocks.forEach((block, i) => {
    const lines = block.split("\n");
    const hook = lines[0].trim();
    const caption = lines.slice(1).join("\n").trim();
    if (!caption) {
      errors.push(`блок ${i + 1}: есть хук, но нет описания`);
      return;
    }
    if (caption.length > MAX_CAPTION) {
      errors.push(`блок ${i + 1}: описание ${caption.length} знаков, лимит ${MAX_CAPTION}`);
      return;
    }
    pairs.push({ hook, caption });
  });

  return { pairs, errors };
}
