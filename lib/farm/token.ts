const G = "https://graph.facebook.com/v23.0";

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message || text;
  } catch {
    return text;
  }
}

export async function exchangeForLongLived(
  shortToken: string,
  appId: string,
  appSecret: string
): Promise<string> {
  const url =
    `${G}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Обмен токена не прошёл: ${await readError(res)}`);
  const { access_token: token } = (await res.json()) as { access_token?: string };
  if (!token) throw new Error("Обмен токена не прошёл: в ответе нет access_token");
  return token;
}

// Page-токен, полученный по долгоживущему пользовательскому, не истекает вовсе —
// это и есть то, что кладётся в FARM_IG_TOKEN.
export async function fetchPageToken(userToken: string, igId: string): Promise<string> {
  const res = await fetch(
    `${G}/me/accounts?fields=name,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(userToken)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Список страниц не пришёл: ${await readError(res)}`);
  const { data } = (await res.json()) as {
    data?: { access_token?: string; instagram_business_account?: { id?: string } }[];
  };
  const page = (data ?? []).find((p) => p.instagram_business_account?.id === igId);
  if (!page?.access_token) throw new Error(`Аккаунт ${igId} не найден среди страниц этого токена`);
  return page.access_token;
}

export async function checkToken(token: string): Promise<{
  valid: boolean;
  expiresAt: number | null;
  scopes: string[];
}> {
  const res = await fetch(
    `${G}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return { valid: false, expiresAt: null, scopes: [] };
  const { data } = (await res.json()) as {
    data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] };
  };
  // expires_at = 0 у бессрочных токенов: это не «истёк вчера», а «не истекает».
  const expires = data?.expires_at;
  return {
    valid: Boolean(data?.is_valid),
    expiresAt: expires ? expires * 1000 : null,
    scopes: data?.scopes ?? [],
  };
}
