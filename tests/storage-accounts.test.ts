import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DARISTEPPE, QURANY_APP } from "../lib/accounts";
import { Snapshot } from "../lib/types";

// Blob подменяем целиком: тесты проверяют, по каким ключам бот пишет и читает.
const store = vi.hoisted(() => ({
  puts: [] as Array<{ pathname: string; body: string }>,
  blobs: [] as Array<{ pathname: string; body: string }>,
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: string) => {
    store.puts.push({ pathname, body });
    store.blobs = store.blobs.filter((b) => b.pathname !== pathname).concat({ pathname, body });
    return { url: `https://blob.test/${pathname}` };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: store.blobs
      .filter((b) => b.pathname.startsWith(prefix))
      .map((b) => ({ pathname: b.pathname, url: `https://blob.test/${b.pathname}` })),
  })),
}));

const { saveSnapshot, loadPreviousSnapshot, loadRecentSnapshots, loadDurations, saveDurations } = await import(
  "../lib/storage"
);

function snap(takenAt: string, views: number): Snapshot {
  return {
    takenAt,
    reels: [{ id: "r1", permalink: "https://ig/r1", publishedAt: "2026-08-01T00:00:00Z", caption: "", views }],
  };
}

beforeEach(() => {
  store.puts.length = 0;
  store.blobs.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const pathname = decodeURIComponent(String(url).replace("https://blob.test/", "").split("?")[0]);
      const blob = store.blobs.find((b) => b.pathname === pathname);
      return { ok: Boolean(blob), text: async () => blob?.body ?? "", json: async () => JSON.parse(blob!.body) } as never;
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("snapshots per account", () => {
  it("writes each account's snapshot under its own prefix", async () => {
    await saveSnapshot("2026-08-19", snap("2026-08-19T05:30:00Z", 10), DARISTEPPE);
    await saveSnapshot("2026-08-19", snap("2026-08-19T05:30:00Z", 20), QURANY_APP);

    expect(store.puts.map((p) => p.pathname)).toEqual([
      "snapshots/2026-08-19.json",
      "snapshots-qurany-app/2026-08-19.json",
    ]);
  });

  it("never returns another account's snapshot as the previous one", async () => {
    await saveSnapshot("2026-08-18", snap("2026-08-18T05:30:00Z", 111), DARISTEPPE);
    await saveSnapshot("2026-08-18", snap("2026-08-18T05:30:00Z", 222), QURANY_APP);

    const forDari = await loadPreviousSnapshot("2026-08-19", DARISTEPPE);
    const forApp = await loadPreviousSnapshot("2026-08-19", QURANY_APP);

    expect(forDari?.reels[0].views).toBe(111);
    expect(forApp?.reels[0].views).toBe(222);
  });

  it("returns null when the account has no snapshots yet", async () => {
    await saveSnapshot("2026-08-18", snap("2026-08-18T05:30:00Z", 111), DARISTEPPE);
    expect(await loadPreviousSnapshot("2026-08-19", QURANY_APP)).toBeNull();
  });

  it("collects the recent series only from the account's own snapshots", async () => {
    await saveSnapshot("2026-08-17", snap("2026-08-17T05:30:00Z", 1), DARISTEPPE);
    await saveSnapshot("2026-08-18", snap("2026-08-18T05:30:00Z", 2), DARISTEPPE);
    await saveSnapshot("2026-08-18", snap("2026-08-18T05:30:00Z", 99), QURANY_APP);

    const series = await loadRecentSnapshots(10, QURANY_APP);
    expect(series.map((s) => s.reels[0].views)).toEqual([99]);
  });
});

describe("durations cache per account", () => {
  it("keeps each account's measured durations in its own file", async () => {
    await saveDurations({ r1: 8.1 }, DARISTEPPE);
    await saveDurations({ r9: 30.2 }, QURANY_APP);

    expect(store.puts.map((p) => p.pathname)).toEqual([
      "state/durations.json",
      "state/durations-qurany-app.json",
    ]);
    expect(await loadDurations(QURANY_APP)).toEqual({ r9: 30.2 });
    expect(await loadDurations(DARISTEPPE)).toEqual({ r1: 8.1 });
  });
});
