import { refreshLongLivedToken } from "./instagram";
import { loadTokenState, saveTokenState, sha256Hex } from "./storage";

const TOKEN_REFRESH_AGE_H = 24;

export async function resolveToken(): Promise<string> {
  const stored = await loadTokenState();
  const envToken = process.env.IG_ACCESS_TOKEN;

  if (envToken) {
    const envHash = sha256Hex(envToken);
    if (!stored || stored.seedHash !== envHash) {
      const now = new Date().toISOString();
      await saveTokenState({ token: envToken, refreshedAt: now, seedHash: envHash });
      return envToken;
    }
    const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
    if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
    try {
      const fresh = await refreshLongLivedToken(stored.token);
      await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString(), seedHash: envHash });
      return fresh;
    } catch (e) {
      // Продление не удалось — работаем на старом токене, ошибка видна в логах.
      console.error("token refresh failed:", e);
      return stored.token;
    }
  }

  if (!stored) throw new Error("IG_ACCESS_TOKEN is not set");
  const ageH = (Date.now() - Date.parse(stored.refreshedAt)) / 3_600_000;
  if (ageH < TOKEN_REFRESH_AGE_H) return stored.token;
  try {
    const fresh = await refreshLongLivedToken(stored.token);
    await saveTokenState({ token: fresh, refreshedAt: new Date().toISOString(), seedHash: stored.seedHash });
    return fresh;
  } catch (e) {
    console.error("token refresh failed:", e);
    return stored.token;
  }
}
