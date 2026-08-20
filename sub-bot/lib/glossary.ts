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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Триггер ищется как ЦЕЛОЕ СЛОВО, не голой подстрокой (Фикс-раунд 2,
// находка 5): "ад" не должен ловиться внутри "садака"/"хадис"/
// "награда"/"тахаджуд", а "Пророк" — внутри "лжепророк". \b в JS
// размечает границы только по ASCII \w — кириллица в него не входит (тот
// же баг, что чинился в lib/sacred.ts и lib/validate.ts), поэтому
// граница задаётся вручную через \p{L}\p{N} lookaround с флагом u.
// Многословный триггер ("Судный день") ищется как последовательность слов
// через один или более пробелов между ними — те же границы на краях
// фразы, но не между её собственными словами.
function matchesTrigger(text: string, trigger: string): boolean {
  const words = trigger.trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (words.length === 0) return false;
  const pattern = words.join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

// В промпт уходит 5–15 записей, а не весь список: гигантский словарь
// модель начинает игнорировать. Частичное совпадение сознательно НЕ
// делаем: оно вернуло бы проблему с другой стороны ("ад" начал бы ловить
// "адрес", "адвокат", "Адам"). Вместо этого недостающие словоформы
// (падежи, множественное число) перечислены явно в самом глоссарии —
// см. assets/glossary.ru-id.json.
export function relevant(entries: Entry[], ru: string): Entry[] {
  return entries.filter((e) => e.ru.some((form) => matchesTrigger(ru, form)));
}
