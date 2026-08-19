import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTrialContainer, fetchPermalink, publishContainer, waitForContainer } from "../lib/farm/instagram";

const deps = { token: "TK", igUserId: "17841400000000000", sleep: async () => {} };

beforeEach(() => vi.unstubAllGlobals());

describe("createTrialContainer", () => {
  it("отправляет media_type=REELS и trial_params с ручным выпуском", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "C1" }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await createTrialContainer("https://blob/out.mp4", "описание", deps);

    expect(id).toBe("C1");
    const body = String(fetchMock.mock.calls[0][1]!.body);
    expect(body).toContain("media_type=REELS");
    expect(body).toContain(encodeURIComponent('{"graduation_strategy":"MANUAL"}'));
    expect(body).toContain("video_url=");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://graph.facebook.com/v23.0/17841400000000000/media");
  });

  it("отказ по правам или параметру отдаёт текст ответа наружу", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "(#3) Application does not have permission", code: 3 },
    }), { status: 400 })));

    await expect(createTrialContainer("u", "c", deps)).rejects.toThrow(/does not have permission/);
  });
});

describe("waitForContainer", () => {
  it("ждёт IN_PROGRESS и выходит на FINISHED", async () => {
    const codes = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: codes.shift() }))));
    await expect(waitForContainer("C1", deps)).resolves.toBeUndefined();
    expect(codes).toHaveLength(0);
  });

  it("ERROR — исключение, повторять нечего", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: "ERROR" }))));
    await expect(waitForContainer("C1", deps)).rejects.toThrow(/ERROR/);
  });

  it("не ждёт дольше отведённого времени", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: "IN_PROGRESS" }))));
    await expect(waitForContainer("C1", deps, { timeoutMs: 0 })).rejects.toThrow(/не дождался/);
  });
});

describe("publishContainer", () => {
  it("возвращает id опубликованного медиа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "M1" }))));
    expect(await publishContainer("C1", deps)).toBe("M1");
  });
});

describe("fetchPermalink", () => {
  it("возвращает ссылку на ролик и спрашивает поле permalink", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ permalink: "https://instagram.com/reel/ABC" }))
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchPermalink("M1", deps)).toBe("https://instagram.com/reel/ABC");
    expect(String(fetchMock.mock.calls[0][0])).toContain("fields=permalink");
  });

  it("отказ не роняет заливку: отдаёт пустую строку", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await expect(fetchPermalink("M1", deps)).resolves.toBe("");
  });
});
