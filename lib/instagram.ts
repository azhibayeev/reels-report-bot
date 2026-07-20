const G = "https://graph.instagram.com";

export interface IgMedia {
  id: string;
  permalink: string;
  timestamp: string;
  caption: string;
}

interface RawMedia {
  id: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  caption?: string;
}

export async function fetchAllReels(token: string): Promise<IgMedia[]> {
  const out: RawMedia[] = [];
  let url: string | null =
    `${G}/me/media?fields=id,media_product_type,permalink,timestamp,caption&limit=100&access_token=${encodeURIComponent(token)}`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Instagram: не удалось получить список медиа (${res.status}): ${await res.text()}`);
    }
    const data: { data?: RawMedia[]; paging?: { next?: string } } = await res.json();
    out.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return out
    .filter((m) => m.media_product_type === "REELS")
    .map((m) => ({
      id: m.id,
      permalink: m.permalink ?? "",
      timestamp: m.timestamp ?? "",
      caption: m.caption ?? "",
    }));
}

const INSIGHTS_CONCURRENCY = 10;

export async function fetchViews(token: string, mediaIds: string[]): Promise<Map<string, number>> {
  const views = new Map<string, number>();
  let i = 0;
  async function worker(): Promise<void> {
    while (i < mediaIds.length) {
      const id = mediaIds[i++];
      try {
        const res = await fetch(
          `${G}/${id}/insights?metric=views&access_token=${encodeURIComponent(token)}`
        );
        if (!res.ok) {
          // Инсайты бывают недоступны для отдельных медиа — не роняем весь отчёт.
          console.error(`insights failed for ${id}: ${res.status} ${await res.text()}`);
          views.set(id, 0);
          continue;
        }
        const data: {
          data?: Array<{ total_value?: { value?: number }; values?: Array<{ value?: number }> }>;
        } = await res.json();
        const metric = data.data?.[0];
        views.set(id, metric?.total_value?.value ?? metric?.values?.[0]?.value ?? 0);
      } catch (e) {
        console.error(`insights error for ${id}:`, e);
        views.set(id, 0);
      }
    }
  }
  const workers = Array.from({ length: Math.min(INSIGHTS_CONCURRENCY, mediaIds.length) }, worker);
  await Promise.all(workers);
  return views;
}

export async function refreshLongLivedToken(token: string): Promise<string> {
  const res = await fetch(
    `${G}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) {
    throw new Error(`Instagram: не удалось продлить токен (${res.status}): ${await res.text()}`);
  }
  const data: { access_token?: string } = await res.json();
  if (!data.access_token) throw new Error("Instagram: пустой ответ при продлении токена");
  return data.access_token;
}
