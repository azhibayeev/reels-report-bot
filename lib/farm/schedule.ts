import { SLOT_TAKEN_STATUSES } from "./queue";
import { Item } from "./types";

/**
 * Приведение расписания в порядок.
 *
 * Выдача слотов защищена замком, но замок действует внутри одного процесса, а
 * ролики рендерятся на разных инстансах Vercel одновременно — там он бессилен.
 * На проде это дало пятьдесят два уникальных времени на пятьдесят девять
 * роликов: часть слипшихся вышла бы в один момент, а в сетке остались бы дыры.
 *
 * Закрыть гонку между инстансами без общего хранилища блокировок нельзя,
 * поэтому вместо предотвращения — самовосстановление: проход раз в пять минут
 * из будильника (см. lib/farm/sweep.ts) расселяет совпавшие слоты. Проход
 * устойчив — повторный запуск ничего не меняет, иначе он гонял бы ролики по
 * сетке бесконечно и слал бы правки в Blob на пустом месте.
 */
export interface SlotChange {
  itemId: string;
  scheduledAt: string;
}

export function normalizeSchedule(
  items: Item[],
  nowMs: number,
  nextFreeSlot: (taken: string[], nowMs: number) => string
): SlotChange[] {
  // Двигать можно только то, что ещё ждёт: у posting слот уже сработал, у
  // posted — это история. Их время при этом занято и повторно не выдаётся.
  const frozen = items.filter((i) => i.scheduledAt && SLOT_TAKEN_STATUSES.has(i.status) && i.status !== "queued");
  const movable = items
    .filter((i) => i.status === "queued" && i.scheduledAt)
    // Кто стоял раньше, тот и уходит раньше: порядок пачки сохраняется, а при
    // равном времени решает номер ролика — иначе проход был бы неустойчив.
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!) || a.index - b.index);

  const taken = frozen.map((i) => i.scheduledAt as string);
  const changes: SlotChange[] = [];

  for (const item of movable) {
    const slot = item.scheduledAt as string;
    if (!taken.includes(slot)) {
      // Место свободно — оставляем как есть. Двигаем только опоздавших, иначе
      // расписание перетряхивалось бы целиком на каждом проходе.
      taken.push(slot);
      continue;
    }
    const fresh = nextFreeSlot(taken, nowMs);
    taken.push(fresh);
    changes.push({ itemId: item.itemId, scheduledAt: fresh });
  }

  return changes;
}

/**
 * Возврат очереди на сетку после паузы Instagram.
 *
 * Пауза по «too many actions» длится часами, а слоты за это время продолжают
 * наступать. К её концу набирается полтора десятка просроченных роликов, и
 * заливка выгребает их подряд с минимальным зазором: мимо дневного окна (на
 * проде 22.08.2026 ролик ушёл в 00:31 при сетке, начинающейся утром) и мимо
 * лимита роликов в сутки — сетка ограничивает частоту только пока по ней идут.
 *
 * Поэтому просрочку не догоняют, а переносят: каждый просроченный ролик
 * получает свой слот сетки начиная с момента выхода из паузы, в прежнем
 * порядке. Сколько роликов пауза съела, столько дней очередь и подвинется —
 * зато аккаунт вернётся к тому ритму, за отклонение от которого его и наказали.
 *
 * Проход устойчив: после переноса просроченных не остаётся, и повторный вызов
 * (будильник ходит каждые пять минут, а пауза — до восьми часов) не пишет ничего.
 */
export function rescheduleAfterPause(
  items: Item[],
  resumeAtMs: number,
  nextFreeSlot: (taken: string[], nowMs: number) => string
): SlotChange[] {
  const inSchedule = items.filter((i) => i.scheduledAt && SLOT_TAKEN_STATUSES.has(i.status));
  // Просрочены только те, кто ещё ждёт. У posting слот уже сработал, у posted —
  // это история; их время занято и второй раз не выдаётся.
  const late = inSchedule
    .filter((i) => i.status === "queued" && Date.parse(i.scheduledAt as string) < resumeAtMs)
    // Кто стоял раньше, тот и уходит раньше. Здесь это ещё и про ролик,
    // поймавший блок: он стоял первым, и первым же должен выйти после паузы.
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!) || a.index - b.index);
  if (late.length === 0) return [];

  const lateIds = new Set(late.map((i) => i.itemId));
  const taken = inSchedule.filter((i) => !lateIds.has(i.itemId)).map((i) => i.scheduledAt as string);

  const changes: SlotChange[] = [];
  for (const item of late) {
    const slot = nextFreeSlot(taken, resumeAtMs);
    taken.push(slot);
    changes.push({ itemId: item.itemId, scheduledAt: slot });
  }
  return changes;
}
