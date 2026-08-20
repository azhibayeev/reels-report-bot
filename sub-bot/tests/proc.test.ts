import { describe, it, expect } from "vitest";
import { createCollector } from "../lib/proc";

describe("createCollector", () => {
  it("склеивает символ, разрезанный ровно на границе чанков", () => {
    const s = "ошибка: файл /tmp/тест.mp4 не найден";
    const buf = Buffer.from(s, "utf8");
    // Первая буква "о" кодируется двумя байтами (0xD0 0xBE). Режем поток
    // между ними — ровно посередине многобайтового символа.
    expect(buf[0]).toBe(0xd0);
    expect(buf[1]).toBe(0xbe);
    const chunk1 = buf.subarray(0, 1);
    const chunk2 = buf.subarray(1);

    const c = createCollector();
    c.push(chunk1);
    c.push(chunk2);
    expect(c.finish()).toBe(s);
  });

  it("без разбиения декодирует так же, как единый Buffer.toString", () => {
    const s = "ошибка: файл /tmp/тест.mp4 не найден";
    const c = createCollector();
    c.push(Buffer.from(s, "utf8"));
    expect(c.finish()).toBe(s);
  });

  it("склеивает символ, разрезанный не на первом байте, а внутри строки", () => {
    const s = "файл /tmp/тест.mp4 не найден";
    const buf = Buffer.from(s, "utf8");
    // Разрежем внутри слова "тест": ищем первый байт >= 0xC0 (начало
    // многобайтовой UTF-8 последовательности) после старта строки и режем
    // сразу за ним — граница чанков попадает ровно в середину символа.
    const splitAt = buf.findIndex((b, i) => i > 5 && b >= 0xc0) + 1;
    expect(splitAt).toBeGreaterThan(5);
    const c = createCollector();
    c.push(buf.subarray(0, splitAt));
    c.push(buf.subarray(splitAt));
    expect(c.finish()).toBe(s);
  });

  it("обрезка потолка происходит по символам и не рвёт многобайтовый символ", () => {
    // Строка из кириллических (двухбайтовых) символов. Потолок в 3 символа —
    // если бы резали по байтам, а не после decoder.write, кусок в 3 байта
    // отрезал бы половину третьего символа и дал бы "�" вместо целой буквы.
    const s = "абвгд";
    const c = createCollector(3);
    c.push(Buffer.from(s, "utf8"));
    const out = c.finish();
    expect(out).toBe("вгд");
    expect(out).not.toContain("�");
  });

  it("потолок применяется и когда данные приходят по одному байту", () => {
    const s = "абвгд";
    const buf = Buffer.from(s, "utf8");
    const c = createCollector(3);
    for (let i = 0; i < buf.length; i++) c.push(buf.subarray(i, i + 1));
    const out = c.finish();
    expect(out).toBe("вгд");
    expect(out).not.toContain("�");
  });
});
