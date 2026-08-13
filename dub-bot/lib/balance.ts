import { requireEnv } from "./config";
import { getSubscription } from "./elevenlabs";
import { verifyToken } from "./tokens";

// Остаток кредитов — приватная цифра аккаунта, а страница загрузки публична,
// поэтому отдаём его только по тому же токену, что открывает саму страницу.
export async function remainingCredits(token: string, nowMs: number): Promise<number> {
  const claim = verifyToken(token, requireEnv("DUB_TOKEN_SECRET"), nowMs);
  if (!claim) throw new Error("Ссылка просрочена — запроси новую через /dub");

  const subscription = await getSubscription(requireEnv("ELEVENLABS_API_KEY"));
  return subscription.remaining;
}
