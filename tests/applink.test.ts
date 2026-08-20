import { describe, it, expect } from "vitest";
import { AppLinkConfig, buildTargetUrl, detectPlatform, sanitizeSlug } from "../lib/applink";

const IOS_PENDING: AppLinkConfig = {
  providerToken: null,
  iosLive: false,
  iosFallbackUrl: "https://go.quranyy.com/gabung",
};
const IOS_LIVE: AppLinkConfig = { ...IOS_PENDING, iosLive: true, providerToken: "123456789" };

describe("detectPlatform", () => {
  it("recognises Android phones", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"
      )
    ).toBe("android");
  });

  it("recognises iPhone and iPad", () => {
    expect(
      detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
    ).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(
      "ios"
    );
  });

  it("recognises the Instagram in-app browser on both systems", () => {
    // Ссылка живёт в шапке Instagram — почти весь трафик придёт из его встроенного браузера.
    expect(
      detectPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 335.0.0.32.94"
      )
    ).toBe("ios");
    expect(
      detectPlatform("Mozilla/5.0 (Linux; Android 13; V2111) AppleWebKit/537.36 Chrome/125 Instagram 335.0.0.32.94")
    ).toBe("android");
  });

  it("falls back to other for desktop and unknown agents", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126")).toBe(
      "other"
    );
    expect(detectPlatform("")).toBe("other");
    expect(detectPlatform(null)).toBe("other");
  });
});

describe("sanitizeSlug", () => {
  it("keeps normal ambassador names", () => {
    expect(sanitizeSlug("bara")).toBe("bara");
    expect(sanitizeSlug("Zahid")).toBe("zahid");
    expect(sanitizeSlug("influencer_01")).toBe("influencer_01");
  });

  it("refuses anything that could leak into the store URL", () => {
    // Слаг уходит в query-параметры ссылки на стор — мусор туда попадать не должен.
    expect(sanitizeSlug("bara&utm_medium=hack")).toBeNull();
    expect(sanitizeSlug("../../etc")).toBeNull();
    expect(sanitizeSlug("")).toBeNull();
    expect(sanitizeSlug("a".repeat(33))).toBeNull();
  });
});

describe("buildTargetUrl", () => {
  it("sends Android to Play with the referrer Play Console reads", () => {
    const url = buildTargetUrl("android", "bara", IOS_PENDING)!;
    expect(url.startsWith("https://play.google.com/store/apps/details?id=com.qurany.app&referrer=")).toBe(true);
    // referrer должен приехать одним закодированным значением, иначе Play разберёт его как свои параметры
    const referrer = decodeURIComponent(new URL(url).searchParams.get("referrer")!);
    expect(referrer).toBe("utm_source=bara&utm_medium=influencer&utm_campaign=ambassador");
  });

  it("does NOT send iPhones to the App Store while the app is not there", () => {
    // В App Store по нашему id лежит чужой билд — вести туда людей нельзя.
    const url = buildTargetUrl("ios", "bara", IOS_PENDING)!;
    expect(url).not.toContain("apps.apple.com");
    expect(url.startsWith("https://go.quranyy.com/gabung")).toBe(true);
    const q = new URL(url).searchParams;
    // Метка обязана сохраниться: иначе iPhone-трафик Бары станет анонимным.
    expect(q.get("utm_source")).toBe("bara");
    expect(q.get("utm_medium")).toBe("influencer");
  });

  it("switches iPhones to the App Store campaign link once iOS is live", () => {
    const url = buildTargetUrl("ios", "bara", IOS_LIVE)!;
    const q = new URL(url).searchParams;
    expect(url.startsWith("https://apps.apple.com/id/app/id6760942823")).toBe(true);
    expect(q.get("ct")).toBe("bara");
    expect(q.get("pt")).toBe("123456789");
    expect(q.get("mt")).toBe("8");
  });

  it("still works on iOS release day before the provider token exists", () => {
    // pt выдаётся в App Store Connect; пока его нет, ссылка обязана вести в стор,
    // просто без разбивки по источнику в отчётах Apple.
    const url = buildTargetUrl("ios", "bara", { ...IOS_PENDING, iosLive: true })!;
    expect(url.startsWith("https://apps.apple.com/id/app/id6760942823")).toBe(true);
    expect(new URL(url).searchParams.get("pt")).toBeNull();
    expect(new URL(url).searchParams.get("ct")).toBe("bara");
  });

  it("has no single destination to pick on desktop", () => {
    expect(buildTargetUrl("other", "bara", IOS_PENDING)).toBeNull();
  });
});
