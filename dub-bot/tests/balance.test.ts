import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSubscriptionMock = vi.fn();

vi.mock("../lib/elevenlabs", () => ({
  getSubscription: (...a: unknown[]) => getSubscriptionMock(...a),
}));

const { remainingCredits } = await import("../lib/balance");
const { signToken } = await import("../lib/tokens");

const SECRET = "secret";

beforeEach(() => {
  process.env.DUB_TOKEN_SECRET = SECRET;
  process.env.ELEVENLABS_API_KEY = "key";
  getSubscriptionMock.mockResolvedValue({ tier: "free", used: 334, limit: 10000, remaining: 9666 });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("remainingCredits", () => {
  it("отдаёт остаток по действующему токену", async () => {
    const token = signToken(42, Date.now() + 60_000, SECRET);
    await expect(remainingCredits(token, Date.now())).resolves.toBe(9666);
    expect(getSubscriptionMock).toHaveBeenCalledWith("key");
  });

  it("не показывает баланс аккаунта по просроченному токену", async () => {
    const token = signToken(42, Date.now() - 1, SECRET);
    await expect(remainingCredits(token, Date.now())).rejects.toThrow(/ссылк/i);
    expect(getSubscriptionMock).not.toHaveBeenCalled();
  });

  it("не показывает баланс по подделанной подписи", async () => {
    const token = signToken(42, Date.now() + 60_000, "чужой секрет");
    await expect(remainingCredits(token, Date.now())).rejects.toThrow(/ссылк/i);
    expect(getSubscriptionMock).not.toHaveBeenCalled();
  });

  it("совсем без токена баланс не отдаёт", async () => {
    await expect(remainingCredits("", Date.now())).rejects.toThrow(/ссылк/i);
    expect(getSubscriptionMock).not.toHaveBeenCalled();
  });
});
