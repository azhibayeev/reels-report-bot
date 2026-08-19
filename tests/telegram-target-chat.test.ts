import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "../lib/telegram";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "BOT";
  process.env.TELEGRAM_CHAT_ID = "-100500";
  delete process.env.TELEGRAM_THREAD_ID;
  vi.unstubAllGlobals();
});

// Сигнатура у мока не для красоты: без неё tsc выводит тип calls как пустой
// кортеж, и обращение к call[1].body становится ошибкой типов.
function stubOk() {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof stubOk>) =>
  JSON.parse(String(fetchMock.mock.calls[0][1]!.body)) as Record<string, unknown>;

describe("адресация ответов", () => {
  it("без chat в опциях шлёт в группу из env — поведение до появления лички", async () => {
    const fetchMock = stubOk();
    await sendMessage("привет", { thread: null });
    expect(bodyOf(fetchMock).chat_id).toBe("-100500");
  });

  it("с chat в опциях шлёт туда, откуда пришла команда", async () => {
    const fetchMock = stubOk();
    await sendMessage("привет", { thread: null, chat: 777001 });
    expect(bodyOf(fetchMock).chat_id).toBe("777001");
  });

  it("личный чат не получает message_thread_id: в личке тем нет", async () => {
    const fetchMock = stubOk();
    await sendMessage("привет", { thread: null, chat: 777001 });
    expect(bodyOf(fetchMock)).not.toHaveProperty("message_thread_id");
  });

  it("тема форума сохраняется вместе с явным чатом", async () => {
    const fetchMock = stubOk();
    await sendMessage("привет", { thread: 42, chat: -100500 });
    expect(bodyOf(fetchMock).message_thread_id).toBe(42);
    expect(bodyOf(fetchMock).chat_id).toBe("-100500");
  });
});
