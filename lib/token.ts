import { AccountConfig } from "./accounts";
import { refreshLongLivedToken } from "./instagram";
import { loadTokenState, saveTokenState, sha256Hex } from "./storage";

const TOKEN_REFRESH_AGE_H = 24;

// Токен Instagram живёт 60 дней, но продление сбрасывает срок заново. Пока бот
// ходит хотя бы раз в двое суток, токен аккаунта не истекает вовсе.
export async function resolveToken(acc: AccountConfig): Promise<string> {
  const stored = await loadTokenState(acc);
  const envToken = process.env[acc.tokenEnv];

  if (envToken) {
    const envHash = sha256Hex(envToken);
    if (!stored || stored.seedHash !== envHash) {
      const now = new Date().toISOString();
      await saveTokenState({ token: envToken, refreshedAt: now, seedHash: envHash }, acc);
      return envToken;
    }
    const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
    if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
    try {
      const fresh = await refreshLongLivedToken(stored.token);
      await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString(), seedHash: envHash }, acc);
      return fresh;
    } catch (e) {
      // Продление не удалось — работаем на старом токене, ошибка видна в логах.
      console.error(`token refresh failed (${acc.key}):`, e);
      return stored.token;
    }
  }

  if (!stored) throw new Error(`${acc.tokenEnv} is not set`);
  const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
  if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
  try {
    const fresh = await refreshLongLivedToken(stored.token);
    await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString(), seedHash: stored.seedHash }, acc);
    return fresh;
  } catch (e) {
    console.error(`token refresh failed (${acc.key}):`, e);
    return stored.token;
  }
}
