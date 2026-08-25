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
 * Возврат очереди на сетку текущего темпа.
 *
 * Обобщение прежней rescheduleAfterPause, которая двигала только просроченные
 * за паузу ролики. Поводов съехать с сетки два, и лечатся они одинаково: пауза
 * Instagram (слоты наступали, а публиковать было нельзя) и смена темпа (сетка
 * стала другой, и прежние слоты ей больше не принадлежат).
 *
 * Просрочку не догоняют, а переносят: каждый ролик получает свой слот сетки
 * начиная с пола, в прежнем порядке. Сколько времени пауза съела, на столько
 * очередь и подвинется — зато аккаунт вернётся к тому ритму, за отклонение от
 * которого его и наказали.
 *
 * Возвращаем только настоящие переносы: ролик, который и так стоит на своём
 * месте, писать в Blob незачем, а на этом же держится идемпотентность прохода.
 */
export function regrid(
  items: Item[],
  floorMs: number,
  nextFreeSlot: (taken: string[], nowMs: number) => string
): SlotChange[] {
  const inSchedule = items.filter((i) => i.scheduledAt && SLOT_TAKEN_STATUSES.has(i.status));
  const queued = inSchedule
    .filter((i) => i.status === "queued")
    // Кто стоял раньше, тот и уходит раньше. Здесь это ещё и про ролик,
    // поймавший блок: он стоял первым и первым же должен выйти после паузы.
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!) || a.index - b.index);
  if (queued.length === 0) return [];

  // posting и posted своё время уже отработали: занять его вторично значило бы
  // вернуть ту самую слипшуюся сетку, ради которой всё и затевалось.
  const taken = inSchedule.filter((i) => i.status !== "queued").map((i) => i.scheduledAt as string);

  const changes: SlotChange[] = [];
  for (const item of queued) {
    const slot = nextFreeSlot(taken, floorMs);
    taken.push(slot);
    if (slot !== item.scheduledAt) changes.push({ itemId: item.itemId, scheduledAt: slot });
  }
  return changes;
}

/**
 * Стоит ли очередь не там, где должна.
 *
 * Опоздавший ролик ВНЕ паузы поводом не считается: он не сломан, он наступил, и
 * его дело — опубликоваться. Иначе двухминутное опоздание внешнего таймера
 * перетряхивало бы всю очередь на каждом проходе будильника.
 */
export function queueOffGrid(
  items: Item[],
  floorMs: number,
  paused: boolean,
  onGrid: (iso: string) => boolean
): boolean {
  return items.some(
    (i) =>
      i.status === "queued" &&
      i.scheduledAt !== null &&
      (!onGrid(i.scheduledAt) || (paused && Date.parse(i.scheduledAt) < floorMs))
  );
}
