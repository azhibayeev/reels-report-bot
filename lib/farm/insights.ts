// Facebook Login, как и в lib/farm/instagram.ts: ферма публикует через
// graph.facebook.com, и media id, который она сохранила, читается тем же
// токеном на том же хосте. Через graph.instagram.com (как в lib/instagram.ts)
// эти id не открываются.
const G = "https://graph.facebook.com/v23.0";

export interface ReelMetrics {
  views: number | null;
  reach: number | null;
  shares: number | null;
  saved: number | null;
  comments: number | null;
  likes: number | null;
  // Именно МИЛЛИсекунды: ig_reels_avg_watch_time Graph отдаёт в них, а не в
  // секундах. Делить на 1000 — задача того, кто печатает отчёт; хранить и
  // передавать честнее сырое значение, чтобы округление случилось один раз.
  avgWatchMs: number | null;
  error: string | null;
}

export interface InsightsDeps {
  token: string;
  fetchImpl?: typeof globalThis.fetch;
}

// Имена сверены с документацией Meta по /{ig-media-id}/insights для REELS
// (август 2026). Ловушки, на которых легко обжечься:
//   - «сохранения» называются saved, а не saves;
//   - impressions и video_views выпилены (v22), вместо них один views;
//   - plays для рилсов больше нет — тоже схлопнулся в views;
//   - total_interactions числится «in development», поэтому его тут нет:
//     сумму лайков/комментов/сохранений/репостов мы и так соберём сами,
//     а держать в наборе метрику, которую Graph может отвергнуть, — значит
//     регулярно уходить в откат ради ничего.
export const REEL_METRICS: string[] = [
  "views",
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "ig_reels_avg_watch_time",
];

// Набор для отката. Ровно те две метрики, которые Meta сама называет заменой
// снятым impressions/video_views — они есть у любого типа медиа и переживают
// смену версии API. Смысл отката не в перестраховке: набор метрик отличается
// между REELS, обычным видео и каруселью, а Graph на неподдерживаемое имя
// отвечает 400 на ВЕСЬ запрос — то есть из-за одной лишней метрики ролик
// остался бы вообще без цифр.
const FALLBACK_REEL_METRICS: string[] = ["views", "reach"];

// Graph отдаёт лимит запросов заметно раньше, чем кажется по документации:
// восемь одновременных чтений инсайтов он переваривает, дальше начинает
// отвечать 4/17-ошибками. Тот же приём, что READ_CONCURRENCY в store.ts.
const INSIGHTS_CONCURRENCY = 8;

interface RawInsight {
  name?: string;
  total_value?: { value?: number };
  values?: Array<{ value?: number }>;
}

function empty(): ReelMetrics {
  return {
    views: null,
    reach: null,
    shares: null,
    saved: null,
    comments: null,
    likes: null,
    avgWatchMs: null,
    error: null,
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message || text;
  } catch {
    return text;
  }
}

type GraphResult =
  | { ok: true; raw: RawInsight[] }
  | { ok: false; status: number; message: string };

async function requestMetrics(
  mediaId: string,
  metrics: string[],
  token: string,
  fetchImpl: typeof globalThis.fetch
): Promise<GraphResult> {
  const url =
    `${G}/${encodeURIComponent(mediaId)}/insights` +
    `?metric=${encodeURIComponent(metrics.join(","))}` +
    `&access_token=${encodeURIComponent(token)}`;
  // cache: "no-store" — цифры меняются каждый час, а отчёт строится по свежим.
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res.ok) return { ok: false, status: res.status, message: await readError(res) };
  const body = (await res.json()) as { data?: RawInsight[] };
  return { ok: true, raw: body.data ?? [] };
}

// Форма ответа Graph непостоянна: у метрик с total_value значение лежит в
// total_value.value, у старых периодических — в values[0].value. Оба варианта
// встречаются в одном и том же ответе, поэтому проверяем каждый.
// Ноль тут — значимое значение (ролик без комментариев), поэтому только ??,
// никаких ||: иначе настоящий ноль неотличим от отсутствующей метрики.
function pick(raw: RawInsight[], name: string): number | null {
  const found = raw.find((m) => m.name === name);
  if (!found) return null;
  const value = found.total_value?.value ?? found.values?.[0]?.value;
  return typeof value === "number" ? value : null;
}

async function readOne(
  mediaId: string,
  token: string,
  fetchImpl: typeof globalThis.fetch
): Promise<ReelMetrics> {
  let result: GraphResult;
  try {
    result = await requestMetrics(mediaId, REEL_METRICS, token, fetchImpl);
    // 400 — единственный код, на котором откат осмыслен: так Graph отвечает на
    // неизвестное имя метрики. Отличить «метрика не та» от «медиа не то» можно
    // только разбором текста ошибки, а он у Meta меняется без предупреждения,
    // поэтому пробуем повтор на любой 400: лишний запрос дешевле молчаливой
    // потери всех метрик ролика.
    if (!result.ok && result.status === 400) {
      result = await requestMetrics(mediaId, FALLBACK_REEL_METRICS, token, fetchImpl);
    }
  } catch (error) {
    return { ...empty(), error: `сбой запроса: ${(error as Error).message}` };
  }

  if (!result.ok) {
    return { ...empty(), error: `Graph отказал (HTTP ${result.status}): ${result.message}` };
  }

  const raw = result.raw;
  return {
    views: pick(raw, "views"),
    reach: pick(raw, "reach"),
    shares: pick(raw, "shares"),
    saved: pick(raw, "saved"),
    comments: pick(raw, "comments"),
    likes: pick(raw, "likes"),
    avgWatchMs: pick(raw, "ig_reels_avg_watch_time"),
    error: null,
  };
}

// Отказ по одному media id не должен ронять остальные: ролик мог быть удалён
// из аккаунта, а журнал публикаций живёт вечно и такие id будет приносить.
// Поэтому наружу всегда карта на все запрошенные id — с error там, где не
// получилось, и без исключений.
export async function fetchReelMetrics(
  mediaIds: string[],
  deps: InsightsDeps
): Promise<Map<string, ReelMetrics>> {
  const out = new Map<string, ReelMetrics>();
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= mediaIds.length) return;
      const id = mediaIds[i];
      out.set(id, await readOne(id, deps.token, fetchImpl));
    }
  }

  // Math.min здесь заодно закрывает пустой список: рабочих ноль, значит и
  // походов в Graph ноль. Отдельная проверка на length === 0 была бы мёртвым
  // кодом — не возвращайте её.
  await Promise.all(
    Array.from({ length: Math.min(INSIGHTS_CONCURRENCY, mediaIds.length) }, () => worker())
  );

  return out;
}
