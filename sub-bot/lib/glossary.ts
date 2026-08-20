import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Entry {
  ru: string[];
  id: string;
  forbidden: string[];
  note?: string;
}

let cache: Entry[] | null = null;

export function loadGlossary(): Entry[] {
  if (cache) return cache;
  const path = join(process.cwd(), "assets", "glossary.ru-id.json");
  cache = JSON.parse(readFileSync(path, "utf8")) as Entry[];
  return cache;
}

// В промпт уходит 5–15 записей, а не весь список: гигантский словарь
// модель начинает игнорировать.
export function relevant(entries: Entry[], ru: string): Entry[] {
  const low = ru.toLowerCase();
  return entries.filter((e) => e.ru.some((form) => low.includes(form.toLowerCase())));
}
