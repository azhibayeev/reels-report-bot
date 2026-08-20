import { describe, it, expect, vi, afterEach } from "vitest";
import { translateCues } from "../lib/translate";
import type { Cue } from "../lib/cues";

const cue = (i: number, ru: string): Cue => ({
  i, start: i, end: i + 2, ru, id: null, needsManual: false, warning: null,
});

const reply = (items: { i: number; id: string }[]) =>
  vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] }),
    text: async () => "",
  });

afterEach(() => vi.unstubAllGlobals());

describe("translateCues", () => {
  it("проставляет перевод по номерам", async () => {
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah doa" }, { i: 2, id: "Setelah sholat" }]));
    const out = await translateCues("k", [cue(1, "Читай дуа"), cue(2, "После намаза")]);
    expect(out.map((c) => c.id)).toEqual(["Bacalah doa", "Setelah sholat"]);
  });

  it("сакральные реплики не отдаёт модели и помечает вручную", async () => {
    const f = reply([{ i: 2, id: "Setelah sholat" }]);
    vi.stubGlobal("fetch", f);
    const out = await translateCues("k", [cue(1, "Бисмилляхи-р-рахман"), cue(2, "После намаза")]);
    expect(out[0].needsManual).toBe(true);
    expect(out[0].id).toBeNull();
    expect(out[0].warning).toMatch(/руками/);
    const body = JSON.parse(f.mock.calls[0][1].body as string);
    expect(JSON.stringify(body)).not.toContain("Бисмилляхи");
  });

  it("на расхождении числа элементов бросает ошибку", async () => {
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah doa" }]));
    await expect(translateCues("k", [cue(1, "Читай дуа"), cue(2, "После намаза")]))
      .rejects.toThrow(/2.*1|не совпад/);
  });

  it("проставляет warning на непрошедших валидатор", async () => {
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah dua" }]));
    const out = await translateCues("k", [cue(1, "Читай дуа")]);
    expect(out[0].warning).toMatch(/dua/);
  });

  it("если переводить нечего, к модели не ходит", async () => {
    const f = reply([]);
    vi.stubGlobal("fetch", f);
    const out = await translateCues("k", [cue(1, "Бисмилляхи-р-рахман")]);
    expect(f).not.toHaveBeenCalled();
    expect(out[0].needsManual).toBe(true);
  });

  it("на ошибке API бросает исключение с кодом", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => "rate limited", json: async () => ({}),
    }));
    await expect(translateCues("k", [cue(1, "Читай дуа")])).rejects.toThrow(/429/);
  });

  it("реплика, чей номер отсутствует в ответе, помечается needsManual, а не остаётся с id: null молча", async () => {
    // Число элементов в ответе совпало с отправленным (2 == 2), но модель
    // перепутала номер — i: 2 в ответе нет вообще. Это не то же самое, что
    // расхождение числа элементов, и должно ловиться отдельной веткой.
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Bacalah doa" }, { i: 99, id: "опечатка" }]));
    const out = await translateCues("k", [cue(1, "Читай дуа"), cue(2, "После намаза")]);
    expect(out[0].id).toBe("Bacalah doa");
    expect(out[1].needsManual).toBe(true);
    expect(out[1].id).toBeNull();
    expect(out[1].warning).toMatch(/руками/);
  });

  it("передаёт в промпт только релевантные термины глоссария и их forbidden, а не весь словарь", async () => {
    const f = reply([{ i: 1, id: "Bacalah doa" }]);
    vi.stubGlobal("fetch", f);
    await translateCues("k", [cue(1, "Читай дуа")]);
    const body = JSON.parse(f.mock.calls[0][1].body as string);
    const systemMsg = body.messages[0].content as string;
    expect(systemMsg).toContain("doa");
    expect(systemMsg).toContain("НИКОГДА не dua");
    // "закят" не встречается в реплике — его записи в промпте быть не должно.
    expect(systemMsg).not.toContain("zakat");
  });

  it("подключает validateSpelling: конфликт написания между репликами вешается на первую реплику без своего warning", async () => {
    // "азан" в глоссарии не участвует, поэтому per-cue validateCue тут не
    // видит нарушения (forbidden списка нет ни у одного термина на эти
    // реплики) — расхождение ловит именно отдельный проход validateSpelling
    // в конце translateCues, как того требует поправка к брифу (Ruling 2).
    vi.stubGlobal("fetch", reply([{ i: 1, id: "Adzan pertama" }, { i: 2, id: "Setelah azan" }]));
    const out = await translateCues("k", [cue(1, "Первый азан"), cue(2, "После азана")]);
    expect(out[0].warning).toMatch(/adzan/i);
    expect(out[0].warning).toMatch(/azan/i);
    expect(out[1].warning).toBeNull();
  });

  it("validateSpelling не перезаписывает уже выставленный warning первой реплики", async () => {
    // У первой реплики уже есть свой warning от validateCue (forbidden
    // "dua"). Сообщение validateSpelling должно уйти на следующую реплику
    // без warning, а не затереть более специфичную причину.
    vi.stubGlobal(
      "fetch",
      reply([
        { i: 1, id: "Bacalah dua" },
        { i: 2, id: "Adzan pertama" },
        { i: 3, id: "Setelah azan" },
      ])
    );
    const out = await translateCues("k", [
      cue(1, "Читай дуа"),
      cue(2, "Первый азан"),
      cue(3, "После азана"),
    ]);
    expect(out[0].warning).toMatch(/dua/);
    expect(out[1].warning).toMatch(/adzan|azan/i);
    expect(out[2].warning).toBeNull();
  });

  it("если все реплики сакральные, validateSpelling всё равно не падает на пустом переводе", async () => {
    const f = reply([]);
    vi.stubGlobal("fetch", f);
    const out = await translateCues("k", [cue(1, "Бисмилляхи-р-рахман")]);
    expect(f).not.toHaveBeenCalled();
    expect(out[0].warning).toMatch(/руками/);
  });
});
