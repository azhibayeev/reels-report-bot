import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

export interface Download {
  /** Путь к локальной копии файла. */
  path: string;
  /**
   * Удаляет временный каталог со скачанным файлом. Вызывающий обязан
   * дёрнуть её сам, когда файл больше не нужен, — на любом пути, включая
   * отказ: на тёплом переиспользуемом инстансе функции /tmp переживает
   * между вызовами вплоть до холодного старта, и без явной уборки ролики по
   * 40–90 МБ забьют лимит /tmp в 500 МБ за несколько задач подряд.
   * Идемпотентна: повторный вызов или отсутствующий каталог не бросает.
   */
  dispose: () => void;
}

// Качает файл по ссылке из Blob во временный каталог и возвращает путь к
// локальной копии вместе с функцией уборки — ffprobe и ffmpeg работают с
// файлом на диске, а не со ссылкой. Каталог создаётся через mkdtemp в
// tmpdir(), тем же приёмом, что runProbe в lib/probe.ts: своя папка на
// каждый вызов, без коллизий имён между параллельными задачами.
export async function downloadToTmp(url: string): Promise<Download> {
  const res = await fetch(url);
  if (!res.ok) {
    // Тело ответа читаем и на отказе: под undici непрочитанное тело держит
    // соединение открытым до тайм-аута вместо возврата в пул (тот же приём,
    // что в lib/scribe.ts и lib/translate.ts) — заодно кусок тела попадает
    // в текст ошибки и делает диагностику полезнее.
    const body = (await res.text()).slice(0, 300);
    throw new Error(`не удалось скачать исходник (${res.status}): ${url} — ${body}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), "sub-src-"));
  // Расширение берём из ссылки, если оно есть, — ffprobe его не требует, но
  // так локальный файл легче узнать глазами при отладке. По умолчанию .mp4:
  // это самый частый формат экспорта с телефона.
  const ext = extname(new URL(url).pathname) || ".mp4";
  const path = join(dir, `source${ext}`);
  writeFileSync(path, bytes);

  return {
    path,
    dispose: () => {
      try {
        // force: true — не бросает, если каталог уже удалён предыдущим
        // вызовом dispose() или не существует по другой причине.
        rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        console.error("downloadToTmp: не удалось удалить временный каталог", dir, error);
      }
    },
  };
}
