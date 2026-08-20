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
    const slot = deps.nextFreeSlot(takenSlots(await deps.listItems()), deps.now());
    await deps.saveItem({ ...item, status: "queued", scheduledAt: slot });
    return slot;
  });
}
