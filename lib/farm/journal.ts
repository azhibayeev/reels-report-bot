import { put } from "@vercel/blob";
import { listAllBlobs } from "./store";
import { DEFAULT_DURATION, DEFAULT_POSITION, Item } from "./types";

/**
 * Вечный журнал публикаций.
 *
 * Зачем он вообще: хук ролика лежит в farm/items/<id>.json, а суточная уборка
 * (PURGE_AFTER_MS в lib/farm/daily.ts) сносит эту запись через трое суток после
 * создания. Просмотры же набираются неделями. Без журнала вопрос «какой хук
 * собрал 300 тысяч» отвечать нечем: задачи уже нет, а у Instagram остался
 * только igMediaId, который ни с чем не связан. Журнал живёт под префиксом
 * farm/log/ — уборка про него не знает и трогает только farm/items/,
 * farm/sources/ и файлы видео, так что записи не истекают никогда.
 *
 * Почему один блоб на запись, а не общий .jsonl с дописыванием: в Blob нет
 * операции append. Единственный способ дописать в общий файл — «прочитать,
 * дополнить, записать», а это гонка: два ролика публикуются разными вызовами
 * функции одновременно, оба читают одну и ту же версию файла, и тот, кто
 * записал вторым, затирает чужую строку. Ролик при этом опубликован, а следа о
 * нём нет — то есть журнал молча врёт, ровно в том месте, ради которого он и
 * заведён. С отдельным блобом на ролик писатели физически не пересекаются:
 * путь уникален по (batchId, index, itemId).
 */
export const JOURNAL_PREFIX = "farm/log/";

export interface PublicationRecord {
  itemId: string;
  batchId: string;
  index: number;
  total: number;
  hook: string;
  caption: string;
  sourceUrl: string;
  musicUrl: string | null;
  position: string;
  seconds: number;
  scheduledAt: string | null;
  publishedAt: string;
  igMediaId: string;
  permalink: string | null;
}

export function journalPath(batchId: string, index: number, itemId: string): string {
  // itemId в пути помимо index — страховка от коллизии: если пачку когда-нибудь
  // перезапустят с теми же номерами, запись не затрёт чужую публикацию.
  return `${JOURNAL_PREFIX}${batchId}/${index}-${itemId}.json`;
}

/**
 * Снимок задачи на момент публикации.
 *
 * Возвращает null без igMediaId: в журнал попадает только то, что Instagram
 * действительно принял. Иначе отчёт «хук → просмотры» будет строиться по
 * роликам, которых в ленте нет, и вывод о том, какой хук работает, окажется
 * сделан по несуществующим публикациям.
 */
export function toRecord(item: Item, publishedAtIso: string): PublicationRecord | null {
  if (!item.igMediaId) return null;
  return {
    itemId: item.itemId,
    batchId: item.batchId,
    index: item.index,
    total: item.total,
    hook: item.hook,
    caption: item.caption,
    sourceUrl: item.sourceUrl,
    // position и seconds у задач необязательные (см. Item): старые записи в Blob
    // сериализованы без них. В журнале поля обязательные и подставлены явно —
    // отчёт сравнивает ролики между собой, и дыра в колонке означала бы, что
    // ролик выпадает из сравнения, хотя снят он был по умолчанию, а не «никак».
    musicUrl: item.musicUrl ?? null,
    position: item.position ?? DEFAULT_POSITION,
    seconds: item.seconds ?? DEFAULT_DURATION,
    scheduledAt: item.scheduledAt,
    publishedAt: publishedAtIso,
    igMediaId: item.igMediaId,
    permalink: item.permalink,
  };
}

export async function recordPublication(rec: PublicationRecord): Promise<void> {
  try {
    await put(journalPath(rec.batchId, rec.index, rec.itemId), JSON.stringify(rec), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      // Путь детерминированный, так что повторный вызов на том же ролике
      // перезапишет свою же запись, а не заведёт дубль.
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
  } catch (error) {
    // Сюда мы попадаем уже ПОСЛЕ media_publish: ролик в ленте, откатывать
    // нечего, а брошенное отсюда исключение увело бы задачу в failed и
    // спровоцировало повторную публикацию того же ролика. Поэтому глотаем —
    // но громко, чтобы пропажу записи было видно в логах вызова.
    console.error("farm journal: не удалось записать публикацию", rec.itemId, rec.igMediaId, error);
  }
}

function isRecord(value: unknown): value is PublicationRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  // Проверяем ровно то, без чего запись бесполезна для отчёта: чей это ролик,
  // какой хук и по какому igMediaId спрашивать метрики.
  return (
    typeof r.itemId === "string" &&
    typeof r.batchId === "string" &&
    typeof r.index === "number" &&
    typeof r.hook === "string" &&
    typeof r.igMediaId === "string" &&
    r.igMediaId !== ""
  );
}

async function fetchRecordOnce(url: string): Promise<PublicationRecord> {
  // Cache-busting обязателен: Blob раздаётся через CDN, и без него отчёт,
  // запрошенный дважды подряд, во второй раз увидел бы вчерашний журнал.
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`блоб ответил ${res.status}`);
  const parsed: unknown = await res.json();
  if (!isRecord(parsed)) throw new Error("запись журнала не похожа на публикацию");
  return parsed;
}

const READ_CONCURRENCY = 16;

/**
 * Читает журнал целиком или одну пачку.
 *
 * Про неполноту данных. Битая запись чтение не роняет — иначе один
 * недокачавшийся блоб лишил бы человека всего отчёта. Но и молчать нельзя:
 * «хук A собрал больше всех» — вывод, который меняется от того, читались ли
 * остальные записи. Поэтому число пропущенных возвращается ЯВНЫМ полем рядом с
 * записями, а не отдельным каналом.
 *
 * Сначала здесь было ненумеруемое поле `skipped` на самом массиве — чтобы не
 * заставлять читателя распаковывать объект ради числа, которое обычно ноль. Это
 * оказалось ошибкой: поле исчезало на первом же .filter() или .map(), и читатель
 * получал `undefined ?? 0`, то есть уверенное «прочитано всё» ровно в том случае,
 * ради которого счётчик и заведён. Тип, который нельзя потерять по невнимательности,
 * дороже пары лишних символов на вызове.
 */
export interface Journal {
  records: PublicationRecord[];
  /** Сколько записей не удалось прочитать. Больше нуля — выводы по журналу неполны. */
  skipped: number;
}

export async function loadJournal(batchId?: string): Promise<Journal> {
  // Пачка лежит в своей «папке», поэтому фильтрация по ней — это префикс, а не
  // чтение всего журнала с последующим отсевом: у Blob за листинг платят
  // временем вызова, и на годовом журнале разница в сотни блобов.
  const prefix = batchId ? `${JOURNAL_PREFIX}${batchId}/` : JOURNAL_PREFIX;
  const blobs = await listAllBlobs(prefix);

  const records: (PublicationRecord | null)[] = new Array(blobs.length).fill(null);
  let skipped = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= blobs.length) return;
      try {
        records[i] = await fetchRecordOnce(blobs[i].url);
      } catch {
        try {
          // Одна попытка повтора: моргание CDN не должно объявлять журнал
          // неполным. Повторяем только чтение — блоб уже в листинге, он есть.
          records[i] = await fetchRecordOnce(blobs[i].url);
        } catch (error) {
          // В отличие от farm/items/, где 404 означает честное «задачи больше
          // нет», журнал ничего не удаляет — поэтому здесь любой отказ, включая
          // 404, это именно потеря записи, а не нормальный ход дел.
          skipped += 1;
          console.error("farm journal: запись пропущена", blobs[i].pathname, error);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, blobs.length) }, () => worker()));

  // Порядок листинга Blob лексикографический: «10-…» встаёт перед «2-…».
  // Сортируем по номеру в пачке, чтобы отчёт читался как сама пачка.
  const kept = records.filter((r): r is PublicationRecord => r !== null).sort((a, b) => a.index - b.index);
  return { records: kept, skipped };
}

/** Список пачек в журнале, свежие первыми. */
export async function listJournalBatches(): Promise<string[]> {
  const blobs = await listAllBlobs(JOURNAL_PREFIX);
  // batchId — это UUID, лексикографически он не сортируется ни по чему
  // осмысленному. Поэтому порядок задаём по времени последней записи в пачке:
  // отчёту почти всегда нужна последняя пачка, и она должна быть первой.
  const latest = new Map<string, number>();
  for (const blob of blobs) {
    const rest = blob.pathname.slice(JOURNAL_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue;
    const id = rest.slice(0, slash);
    const at = blob.uploadedAt.getTime();
    const known = latest.get(id);
    if (known === undefined || at > known) latest.set(id, at);
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
