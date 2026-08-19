// ── Ссылка на установку приложения с метками источника.
// Один короткий адрес вида /go/bara ведёт человека в его стор и приносит с собой
// метку источника, по которой Google Play и App Store потом раскладывают установки.
// Это единственный способ платить амбассадорам за результат, а не за клики.

export type Platform = "android" | "ios" | "other";

export const PLAY_PACKAGE = "com.qurany.app";
export const APPSTORE_ID = "6743374163";
/** Кампания одна на всех амбассадоров; людей различает utm_source / ct. */
export const CAMPAIGN = "ambassador";

export function detectPlatform(userAgent: string | null | undefined): Platform {
  const ua = (userAgent ?? "").toLowerCase();
  // Порядок важен: встроенный браузер Instagram на iOS содержит и «mobile», и свою
  // подпись, но всегда несёт iphone/ipad — по ним и определяем.
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

const SLUG_RE = /^[a-z0-9_-]{1,32}$/;

/** Слаг уходит в параметры ссылки на стор, поэтому пропускаем только простые имена. */
export function sanitizeSlug(raw: string | null | undefined): string | null {
  const slug = (raw ?? "").trim().toLowerCase();
  return SLUG_RE.test(slug) ? slug : null;
}

export interface AppLinkConfig {
  /** Токен поставщика из App Store Connect: без него Apple не разложит установки по источникам. */
  providerToken: string | null;
  /** Вышло ли приложение в App Store. Пока нет — iPhone нельзя вести в стор. */
  iosLive: boolean;
  /** Куда ведём iPhone, пока приложения в App Store нет. */
  iosFallbackUrl: string;
}

export function appLinkConfig(): AppLinkConfig {
  return {
    providerToken: process.env.APPSTORE_PROVIDER_TOKEN || null,
    iosLive: process.env.APPSTORE_LIVE === "1",
    iosFallbackUrl: process.env.IOS_FALLBACK_URL || "https://go.quranyy.com/gabung",
  };
}

export function buildTargetUrl(platform: Platform, slug: string, cfg: AppLinkConfig): string | null {
  if (platform === "android") {
    // Play читает ОДИН параметр referrer, внутри которого лежит закодированная
    // utm-строка. Раскодированные параметры Play принял бы за свои и потерял метку.
    const referrer = `utm_source=${slug}&utm_medium=influencer&utm_campaign=${CAMPAIGN}`;
    return (
      `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}` +
      `&referrer=${encodeURIComponent(referrer)}`
    );
  }
  if (platform === "ios") {
    // Пока приложения в App Store нет, вести туда людей нельзя: по нашему id
    // лежит чужой билд. Отправляем их в комьюнити — там та же воронка, и метка
    // источника сохраняется, так что iPhone-трафик не пропадает из учёта.
    if (!cfg.iosLive) {
      const url = new URL(cfg.iosFallbackUrl);
      url.searchParams.set("utm_source", slug);
      url.searchParams.set("utm_medium", "influencer");
      url.searchParams.set("utm_campaign", CAMPAIGN);
      return url.toString();
    }
    // ct — метка кампании в App Analytics, pt — токен поставщика из App Store Connect.
    // Без pt Apple не разложит установки по источникам, но ссылка обязана работать.
    const params = new URLSearchParams({ ct: slug, mt: "8" });
    if (cfg.providerToken) params.set("pt", cfg.providerToken);
    return `https://apps.apple.com/id/app/id${APPSTORE_ID}?${params.toString()}`;
  }
  return null;
}
