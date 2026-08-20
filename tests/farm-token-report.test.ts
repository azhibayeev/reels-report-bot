import { describe, expect, it, vi } from "vitest";
import { formatTokenReport, redactSecrets, REQUIRED_SCOPES } from "../lib/farm/token-report";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const GOOD = ["instagram_basic", "instagram_content_publish", "pages_show_list"];
const TOKEN = "EAAG" + "x".repeat(60);

const deps = (check: Partial<Parameters<typeof mkCheck>[0]> = {}) => ({
  now: () => NOW,
  checkToken: vi.fn(async () => mkCheck(check)),
});
function mkCheck(over: { valid?: boolean; expiresAt?: number | null; scopes?: string[] }) {
  return { valid: over.valid ?? true, expiresAt: over.expiresAt ?? null, scopes: over.scopes ?? GOOD };
}

describe("redactSecrets", () => {
  it("вырезает сам токен из текста", () => {
    const text = `Graph отверг ${TOKEN} как просроченный`;
    const safe = redactSecrets(text, [TOKEN]);
    expect(safe).not.toContain(TOKEN);
    expect(safe).toContain("Graph отверг");
  });

  it("режет и незнакомую длинную строку: отчёт уходит в чат, а чат пересылают", () => {
    const stray = "B".repeat(80);
    expect(redactSecrets(`ошибка ${stray}`, [])).not.toContain(stray);
  });

  it("короткие слова не трогает — иначе отчёт станет нечитаемым", () => {
    expect(redactSecrets("токен истёк вчера", [])).toBe("токен истёк вчера");
  });
});

describe("formatTokenReport", () => {
  const subject = { label: "Заливка", env: "FARM_IG_TOKEN", value: TOKEN };

  it("живой токен с правами — зелёный вердикт", async () => {
    const text = await formatTokenReport([subject], deps());
    expect(text).toContain("✅ действителен");
    expect(text).toContain("бессрочный");
    expect(text).toContain("прав на публикацию хватает");
  });

  it("нет прав на публикацию — говорит, каких именно", async () => {
    const text = await formatTokenReport([subject], deps({ scopes: ["instagram_basic"] }));
    expect(text).toContain("не хватает прав");
    expect(text).toContain("instagram_content_publish");
  });

  it("отозванный токен — прямо об этом", async () => {
    const text = await formatTokenReport([subject], deps({ valid: false }));
    expect(text).toContain("❌ недействителен");
  });

  it("пробел внутри значения ловится ДО обращения к Graph", async () => {
    // Самая частая порча при вставке в Vercel, и ровно она даёт
    // «Cannot parse access token». Graph про это скажет невнятно, мы — прямо.
    const d = deps();
    const text = await formatTokenReport([{ ...subject, value: `EAAG${"x".repeat(60)}\n` }], d);
    expect(text).toContain("перенос строки");
    expect(d.checkToken).not.toHaveBeenCalled();
  });

  it("переменная не задана — так и пишет, не притворяясь проверкой", async () => {
    const d = deps();
    const text = await formatTokenReport([{ ...subject, value: undefined }], d);
    expect(text).toContain("не задан");
    expect(d.checkToken).not.toHaveBeenCalled();
  });

  it("отчёт никогда не содержит сам токен — ни в успехе, ни в ошибке", async () => {
    const failing = {
      now: () => NOW,
      checkToken: vi.fn(async () => {
        throw new Error(`Graph не ответил про токен: bad token ${TOKEN}`);
      }),
    };
    const text = await formatTokenReport([subject], failing);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("не удалось проверить");
  });

  it("несколько ключей — каждый со своим вердиктом", async () => {
    const text = await formatTokenReport(
      [subject, { label: "Отчёты", env: "IG_ACCESS_TOKEN", value: undefined }],
      deps()
    );
    expect(text).toContain("FARM_IG_TOKEN");
    expect(text).toContain("IG_ACCESS_TOKEN");
    expect(text).toContain("не задан");
  });

  it("срок жизни считается в днях", async () => {
    const text = await formatTokenReport([subject], deps({ expiresAt: NOW + 10 * 86_400_000 }));
    expect(text).toContain("истекает через 10 дн.");
  });

  it("список обязательных прав не пуст — иначе проверка ничего не проверяет", () => {
    expect(REQUIRED_SCOPES).toContain("instagram_content_publish");
  });
});
