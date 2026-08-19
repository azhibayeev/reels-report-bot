import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DARISTEPPE, QURANY_APP } from "../lib/accounts";

const store = vi.hoisted(() => ({
  blobs: [] as Array<{ pathname: string; body: string }>,
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: string) => {
    store.blobs = store.blobs.filter((b) => b.pathname !== pathname).concat({ pathname, body });
    return { url: `https://blob.test/${pathname}` };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: store.blobs
      .filter((b) => b.pathname.startsWith(prefix))
      .map((b) => ({ pathname: b.pathname, url: `https://blob.test/${b.pathname}` })),
  })),
}));

const { resolveToken } = await import("../lib/token");
const { loadTokenState, saveTokenState, sha256Hex } = await import("../lib/storage");

const refreshCalls: string[] = [];

beforeEach(() => {
  store.blobs.length = 0;
  refreshCalls.length = 0;
  process.env.CRON_SECRET = "test-secret";
  process.env.IG_ACCESS_TOKEN = "dari-token";
  process.env.IG_ACCESS_TOKEN_QURANY_APP = "app-token";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("refresh_access_token")) {
        refreshCalls.push(u);
        return { ok: true, json: async () => ({ access_token: `${u.match(/access_token=([^&]+)/)![1]}-refreshed`}) } as never;
      }
      const pathname = decodeURIComponent(u.replace("https://blob.test/", "").split("?")[0]);
      const blob = store.blobs.find((b) => b.pathname === pathname);
      return { ok: Boolean(blob), text: async () => blob?.body ?? "" } as never;
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveToken per account", () => {
  it("seeds each account from its own env variable", async () => {
    expect(await resolveToken(DARISTEPPE)).toBe("dari-token");
    expect(await resolveToken(QURANY_APP)).toBe("app-token");

    expect(store.blobs.map((b) => b.pathname).sort()).toEqual([
      "state/token-qurany-app.enc",
      "state/token.enc",
    ]);
  });

  it("does not hand one account the other's token", async () => {
    await resolveToken(DARISTEPPE);
    delete process.env.IG_ACCESS_TOKEN_QURANY_APP;

    // Токена нет ни в env, ни в Blob этого аккаунта — молча взять чужой нельзя.
    await expect(resolveToken(QURANY_APP)).rejects.toThrow(/IG_ACCESS_TOKEN_QURANY_APP/);
  });

  it("refreshes a stale token and stores it back under the account's own path", async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
    await saveTokenState(
      { token: "app-old", refreshedAt: twoDaysAgo, seedHash: sha256Hex("app-token") },
      QURANY_APP
    );

    expect(await resolveToken(QURANY_APP)).toBe("app-old-refreshed");
    expect(refreshCalls).toHaveLength(1);
    expect((await loadTokenState(QURANY_APP))?.token).toBe("app-old-refreshed");
    // Чужой токен продление не трогает.
    expect(await loadTokenState(DARISTEPPE)).toBeNull();
  });
});
