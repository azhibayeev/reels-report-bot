import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { GET } from "../app/api/app-report/route";

// Сводка по приложению — свой крон: её можно перезапустить одну (`vercel crons run
// /api/app-report`), не повторяя весь дневной отчёт и не упираясь в его защиту от дублей.
describe("/api/app-report", () => {
  const telegram: string[] = [];

  beforeEach(() => {
    telegram.length = 0;
    vi.stubEnv("CRON_SECRET", "s");
    vi.stubEnv("POSTHOG_APP_PERSONAL_API_KEY", "phx_app");
    vi.stubEnv("POSTHOG_APP_PROJECT_ID", "222");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.includes("posthog.com")) return new Response("no access", { status: 403 });
        if (url.includes("api.telegram.org")) {
          telegram.push(JSON.parse(init.body).text);
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

  const call = (auth?: string) =>
    GET(new NextRequest("https://x/api/app-report", { headers: auth ? { authorization: auth } : {} }));

  it("без секрета — 401, в чат ничего", async () => {
    expect((await call()).status).toBe(401);
    expect(telegram).toHaveLength(0);
  });

  it("сбой сводки на кроне виден в чате", async () => {
    const res = await call("Bearer s");
    expect(res.status).toBe(500);
    expect(telegram).toHaveLength(1);
    expect(telegram[0]).toContain("Сводка по приложению не ушла");
  });

  it("стоит в кронах Vercel отдельно от дневного отчёта", () => {
    const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons as { path: string }[];
    expect(crons.map((c) => c.path)).toContain("/api/app-report");
    const report = readFileSync("app/api/report/route.ts", "utf8");
    expect(report).not.toContain("sendAppReport");
  });
});
