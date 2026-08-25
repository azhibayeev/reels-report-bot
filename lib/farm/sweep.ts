import { batchesToKick } from "./commands";
import { Cooldown, isPaused } from "./cooldown";
import { normalizeSchedule, queueOffGrid, regrid, SlotChange } from "./schedule";
import { Item } from "./types";

/**
 * Будильник цепочки рендера.
 *
 * Раньше следующее звено запускал сам рендер — тик дорабатывал бюджет вызова и
 * дёргал свой же роут. На длинной пачке Vercel это глушит: функция, вызывающая
 * саму себя, ловит HTTP 508 «Loop Detected», и повторы не помогают, потому что
 * отказ не временный, а по существу. На проде так встали три последних ролика
 * из шестидесяти, а до этого — все тринадцать.
 *
 * Отсюда разделение: пинок делает отдельная функция по расписанию. Для
 * платформы это вызов A → B, а не B → B, и защита от рекурсии не срабатывает.
 * Само-вызов из тика остаётся быстрым путём, а это — тот, который не подведёт.
 */
export interface SweepDeps {
  now: () => number;
  listItems: () => Promise<Item[]>;
  triggerRender: (batchId: string) => Promise<void>;
  saveItem: (item: Item) => Promise<void>;
  nextFreeSlot: (taken: string[], nowMs: number) => string;
  /**
   * Пауза, объявленная Instagram (см. lib/farm/cooldown.ts). Будильнику она
   * нужна не чтобы стоять — он ничего не публикует, — а чтобы знать, с какого
   * момента очередь вообще имеет право стоять: см. regrid.
   */
  loadCooldown: () => Promise<Cooldown | null>;
  /**
   * Принадлежит ли время сетке текущего темпа (isOnGrid в lib/farm/slots.ts).
   * Роут собирает эту функцию из темпа, а будильник только спрашивает.
   */
  onGrid: (iso: string) => boolean;
}

export interface SweepResult {
  kicked: string[];
  failed: { batchId: string; error: string }[];
  /** Сколько роликов пришлось передвинуть: из совпавших слотов и из-под паузы. */
  respaced: number;
}

export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
  // Нечитаемый список не глушим: молчаливый пустой результат выглядел бы как
  // «работы нет», и будильник рапортовал бы об успехе, ничего не сделав.
  const items = await deps.listItems();
  const batches = batchesToKick(items, deps.now());

  // Съехать с сетки очередь может по двум причинам, и лечатся они одинаково:
  // пауза Instagram (слоты наступали, а публиковать было нельзя) и смена темпа
  // (сетка стала другой). Поэтому здесь не событие, а правило: очередь обязана
  // стоять на сетке текущего темпа начиная с пола — и если это не так,
  // пересобираем целиком.
  let cooldown: Cooldown | null = null;
  try {
    cooldown = await deps.loadCooldown();
  } catch (error) {
    // Нечитаемая пауза — не повод срывать будильник: расселение и пинки сборки
    // от неё не зависят, а перенос попробуем на следующем проходе.
    console.error("farm sweep: пауза не прочиталась, расписание не переносим", error);
  }
  const paused = isPaused(cooldown, deps.now());
  const floor = paused ? Date.parse((cooldown as Cooldown).until) : deps.now();

  const changes: SlotChange[] = [];
  let scheduled = items;
  if (queueOffGrid(items, floor, paused, deps.onGrid)) {
    const moved = regrid(items, floor, deps.nextFreeSlot);
    if (moved.length) {
      changes.push(...moved);
      // Дальше расселение должно видеть уже новые времена, иначе оно приняло бы
      // освободившиеся слоты за занятые и погнало бы ролики по сетке впустую.
      const byId = new Map(moved.map((c) => [c.itemId, c.scheduledAt]));
      scheduled = items.map((i) => (byId.has(i.itemId) ? { ...i, scheduledAt: byId.get(i.itemId)! } : i));
    }
  }

  // Расселяем слипшиеся слоты. Замок при выдаче работает внутри процесса, а
  // ролики рендерятся на разных инстансах одновременно — гонку между ними
  // закрывает только вот такой регулярный проход (см. lib/farm/schedule.ts).
  changes.push(...normalizeSchedule(scheduled, deps.now(), deps.nextFreeSlot));

  let respaced = 0;
  // По одной записи на ролик: перенос и расселение в одном проходе пересечься
  // не могут, но лишний put в Blob на пустом месте здесь не нужен и подавно.
  const lastPerItem = new Map(changes.map((c) => [c.itemId, c]));
  for (const change of lastPerItem.values()) {
    const item = items.find((i) => i.itemId === change.itemId);
    if (!item) continue;
    try {
      await deps.saveItem({ ...item, scheduledAt: change.scheduledAt });
      respaced += 1;
    } catch (error) {
      // Неудачная правка не должна отменять пинок сборки: расселение — вторая
      // задача этого прохода, и следующий проход попробует снова.
      console.error("farm sweep: не удалось передвинуть ролик", change.itemId, error);
    }
  }

  const kicked: string[] = [];
  const failed: { batchId: string; error: string }[] = [];
  for (const batchId of batches) {
    try {
      await deps.triggerRender(batchId);
      kicked.push(batchId);
    } catch (error) {
      // Одна упавшая пачка не должна лишать пинка остальные: будильник —
      // последняя линия обороны, и до следующего срабатывания они простояли бы
      // без всякой причины.
      failed.push({ batchId, error: (error as Error).message });
    }
  }
  return { kicked, failed, respaced };
}
