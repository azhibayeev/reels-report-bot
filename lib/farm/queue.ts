import { Item } from "./types";

/**
 * Выдача слотов. Живёт отдельным модулем, потому что претендентов на слот
 * теперь двое: собравшийся ролик, который встаёт в очередь сам, и апрув
 * руками. Замок обязан быть у них общий — иначе они выдадут один слот дважды.
 *
 * Держать его в approve.ts не вышло: tick.ts импортировал бы approve.ts,
 * approve.ts тянет commands.ts, а тот — обратно tick.ts.
 */

// Статусы, чьи слоты уже кому-то принадлежат: их нельзя выдать второй раз.
export const SLOT_TAKEN_STATUSES = new Set<string>(["queued", "posting", "posted"]);

// Сериализует критическую секцию «прочитать занятые слоты → выбрать свободный →
// записать queued» в пределах ЭТОГО инстанса: без него два параллельных вызова
// оба читают listItems() до того, как первый запишет свой слот, и получают один
// слот на двоих. Межинстансную гонку это не закрывает — там спасает то, что
// слоты разъезжаются на следующем свободном.
let slotChain: Promise<void> = Promise.resolve();

/**
 * Слоты, выданные ЭТИМ процессом, и когда именно.
 *
 * Замка мало. Он выстраивает вызовы в очередь, но каждый заново читает занятые
 * слоты из Blob, а Blob отдаёт запись не мгновенно: следующий вызов не видит
 * слот предыдущего и выдаёт то же время второй раз. На проде так и вышло —
 * восемнадцать роликов встали в очередь на девять слотов.
 *
 * Память намеренно короткая. Она закрывает ровно отставание записи, а это
 * секунды; хранить дольше вредно — после чистки фермы слоты старой пачки
 * оставались бы «занятыми» и без нужды отодвигали расписание новой.
 */
const handedOut = new Map<string, number>();
const MEMO_TTL_MS = 5 * 60_000;

/** Только для тестов: память живёт на весь процесс и иначе течёт между ними. */
export function forgetHandedOutSlots(): void {
  handedOut.clear();
}

export async function withSlotLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = slotChain.catch(() => {});
  let release: () => void = () => {};
  slotChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export interface SlotDeps {
  now: () => number;
  listItems: () => Promise<Item[]>;
  saveItem: (item: Item) => Promise<void>;
  nextFreeSlot: (taken: string[], nowMs: number) => string;
}

export function takenSlots(items: Item[]): string[] {
  return items
    .filter((i) => SLOT_TAKEN_STATUSES.has(i.status))
    .map((i) => i.scheduledAt)
    .filter((s): s is string => s !== null);
}

/**
 * Ставит собранный ролик в очередь, выдав ему свободный слот. Возвращает слот.
 *
 * Апрув руками отменён сознательно: пачка — это шестьдесят роликов, и шестьдесят
 * нажатий превращают ферму в ручную работу. Ролики уходят в Trial Reels, то есть
 * видны только не-подписчикам, и цена ошибки невелика. Страховка осталась —
 * пока слот не наступил, ролик можно снять кнопкой «Выкинуть».
 */
export async function queueRendered(item: Item, deps: SlotDeps): Promise<string> {
  return withSlotLock(async () => {
    const nowMs = deps.now();
    // Забываем выданное давно: к этому моменту оно уже читается из Blob, а
    // прошедшие слоты nextFreeSlot и так не предложит.
    for (const [slot, at] of handedOut) {
      if (nowMs - at > MEMO_TTL_MS || Date.parse(slot) < nowMs) handedOut.delete(slot);
    }
    // Своё прежнее время ролик освобождает, вставая в очередь заново (так
    // бывает после правки описания). Без этого он конкурировал бы сам с собой:
    // память держала бы слот, который уже никем не занят, и в расписании
    // оставалась бы дыра.
    if (item.scheduledAt) handedOut.delete(item.scheduledAt);
    // Список из Blob плюс то, что этот процесс выдал сам. Одного списка мало:
    // Blob отдаёт запись не мгновенно, и следующий вызов не увидит слот
    // предыдущего, даже стоя за ним в очереди под замком.
    const taken = [...new Set([...takenSlots(await deps.listItems()), ...handedOut.keys()])];
    const slot = deps.nextFreeSlot(taken, nowMs);
    handedOut.set(slot, nowMs);
    await deps.saveItem({ ...item, status: "queued", scheduledAt: slot });
    return slot;
  });
}
