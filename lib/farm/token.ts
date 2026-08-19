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
  if (!res.ok) {
    const text = await res.text();
    let parsedError: { message?: string; type?: string; code?: number } | undefined;
    try {
      parsedError = (JSON.parse(text) as { error?: typeof parsedError }).error;
    } catch {
      parsedError = undefined;
    }
    // type === "OAuthException" — НЕ маркер отозванного токена: под ним Graph
    // прячет и «Application request limit reached» (#4), и #17/#32/#341/#613 —
    // упор в лимит запросов, а не вердикт про сам токен. Отзыв/протухание
    // различимы только по конкретному коду: 190 (истёк/отозван), 102 (сессия
    // недействительна), 463/467 (просроченный/недействительный OAuth-токен).
    // Всё остальное (включая 400+OAuthException с кодом 4/17/32/341/613, 5xx,
    // левый JSON, сетевой обрыв) ничего не говорит о токене — бросаем, чтобы
    // runDaily сказал «не смог проверить», а не выдал лимит за отзыв.
    if (res.status === 400 && [190, 102, 463, 467].includes(parsedError?.code ?? -1)) {
      return { valid: false, expiresAt: null, scopes: [] };
    }
    throw new Error(`Graph не ответил про токен: ${parsedError?.message || text}`);
  }
  const { data } = (await res.json()) as {
    data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] };
  };
  if (data?.is_valid === undefined) {
    throw new Error("Graph не вернул разбираемый вердикт про токен (нет data.is_valid)");
  }
  // expires_at = 0 у бессрочных токенов: это не «истёк вчера», а «не истекает».
  const expires = data.expires_at;
  return {
    valid: Boolean(data.is_valid),
    expiresAt: expires ? expires * 1000 : null,
    scopes: data.scopes ?? [],
  };
}
