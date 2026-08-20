import { batchesToKick } from "./commands";
import { normalizeSchedule } from "./schedule";
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
}

export interface SweepResult {
  kicked: string[];
  failed: { batchId: string; error: string }[];
  /** Сколько роликов пришлось расселить из совпавших слотов. */
  respaced: number;
}

export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
  // Нечитаемый список не глушим: молчаливый пустой результат выглядел бы как
  // «работы нет», и будильник рапортовал бы об успехе, ничего не сделав.
  const items = await deps.listItems();
  const batches = batchesToKick(items, deps.now());

  // Расселяем слипшиеся слоты. Замок при выдаче работает внутри процесса, а
  // ролики рендерятся на разных инстансах одновременно — гонку между ними
  // закрывает только вот такой регулярный проход (см. lib/farm/schedule.ts).
  let respaced = 0;
  for (const change of normalizeSchedule(items, deps.now(), deps.nextFreeSlot)) {
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
