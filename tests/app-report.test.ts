import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { notifyAppReportFailure, sendAppReport } from "../lib/app-report";

const NOW = new Date("2026-10-05T05:45:00Z");

// Ответы PostHog по виду запроса: два дня DAU (график есть), установки, MAU, функции.
function posthogResults(q: string): unknown[][] {
  if (q.includes("minIf(")) return [["2026-10-04", 3]];
  if (q.includes("multiIf(")) return [["Чтение", 10]];
  if (q.includes("GROUP BY d")) return [["2026-10-03", 8], ["2026-10-04", 12]];
  return [[40]];
}

describe("sendAppReport", () => {
  const telegram: string[] = [];
  let quickchartStatus = 200;

  beforeEach(() => {
    telegram.length = 0;
    quickchartStatus = 200;
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "phx_test");
    vi.stubEnv("POSTHOG_APP_PROJECT_ID", "222");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: unknown }) => {
        if (url.includes("posthog.com")) {
          const q = JSON.parse(init.body as string).query.query as string;
          return new Response(JSON.stringify({ results: posthogResults(q) }), { status: 200 });
        }
        if (url.includes("quickchart.io")) {
          return quickchartStatus === 200
            ? new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })
            : new Response("boom", { status: quickchartStatus });
        }
        if (url.includes("api.telegram.org")) {
          telegram.push(url.split("/").pop() as string);
          return new Response("{}", { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("шлёт сообщение, потом график", async () => {
    const r = await sendAppReport(NOW);
    expect(telegram).toEqual(["sendMessage", "sendPhoto"]);
    expect(r.chart).toMatch(/^отправлен/);
  });

  it("сбой сводки виден в чате, а не только в логах Vercel", async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body).text);
        return new Response("{}", { status: 200 });
      })
    );
    await notifyAppReportFailure(
      new Error(`PostHog query failed (403): {"detail":"You don't have access to the project."}`)
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Сводка по приложению не ушла");
    expect(sent[0]).toContain("POSTHOG_APP_PERSONAL_API_KEY");
    expect(sent[0]).toContain("<code>PostHog query failed (403)");
  });

  it("сломанный график не отменяет уже отправленное сообщение", async () => {
    quickchartStatus = 500;
    const r = await sendAppReport(NOW);
    expect(telegram).toEqual(["sendMessage"]);
    expect(r.chart).toMatch(/^ошибка/);
  });
});
