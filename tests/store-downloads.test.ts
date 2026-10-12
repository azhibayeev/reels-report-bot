import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  ascJwt,
  getAppStoreDownloads,
  getPlayDownloads,
  parseAppStoreReport,
  parsePlayInstallsCsv,
} from "../lib/store-downloads";

// Крон в 12:45 Джакарты 05.10.
const NOW = new Date("2026-10-05T05:45:00Z");

// Шапка — ровно та, что отдаёт App Store Connect (SALES / SUMMARY / 1_1).
const ASC_HEADER = [
  "Provider", "Provider Country", "SKU", "Developer", "Title", "Version", "Product Type Identifier",
  "Units", "Developer Proceeds", "Begin Date", "End Date", "Customer Currency", "Country Code",
  "Currency of Proceeds", "Apple Identifier", "Customer Price", "Promo Code", "Parent Identifier",
  "Subscription", "Period", "Category", "CMB", "Device", "Supported Platforms", "Proceeds Reason",
  "Preserved Pricing", "Client", "Order Type", "Contingent App Name",
];

function ascRow(appleId: string, type: string, units: number): string {
  const r = ASC_HEADER.map(() => "");
  r[ASC_HEADER.indexOf("Apple Identifier")] = appleId;
  r[ASC_HEADER.indexOf("Product Type Identifier")] = type;
  r[ASC_HEADER.indexOf("Units")] = String(units);
  return r.join("\t");
}

// На аккаунте разработчика несколько приложений — считать надо только Qurany.
const ASC_TSV = [
  ASC_HEADER.join("\t"),
  ascRow("6760942823", "1F", 4),
  ascRow("6760942823", "1F", 3), // та же страна дважды не бывает, но строки по странам суммируются
  ascRow("6760942823", "3F", 5),
  ascRow("6760942823", "7F", 166), // обновления — не скачивания
  ascRow("6476192288", "1F", 1), // IQUP — чужое приложение аккаунта
  ascRow("6785792588", "1", 3), // TATAMI
].join("\n") + "\n";

// Play отдаёт CSV в UTF-16LE с BOM.
const PLAY_CSV =
  "Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events\n" +
  "2026-10-01,com.qurany.app,250,40,900,12000,210,35,8000,260,950,45\n" +
  "2026-10-02,com.qurany.app,230,38,880,12210,198,30,8100,240,930,41\n";
const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

describe("parseAppStoreReport", () => {
  it("считает новые и повторные скачивания только Qurany, без обновлений", () => {
    expect(parseAppStoreReport(ASC_TSV)).toEqual({ downloads: 7, redownloads: 5 });
  });

  it("незнакомая шапка — внятная ошибка, а не тихий ноль", () => {
    expect(() => parseAppStoreReport("A\tB\n1\t2\n")).toThrow(/Apple Identifier/);
  });
});

describe("parsePlayInstallsCsv", () => {
  it("берёт последний день файла и установки пользователей за него", () => {
    expect(parsePlayInstallsCsv(utf16(PLAY_CSV))).toEqual({ date: "2026-10-02", day: 198 });
  });

  it("читает и UTF-8", () => {
    expect(parsePlayInstallsCsv(Buffer.from(PLAY_CSV))).toEqual({ date: "2026-10-02", day: 198 });
  });

  it("файл без строк — null, чтобы взять прошлый месяц", () => {
    expect(parsePlayInstallsCsv(utf16(PLAY_CSV.split("\n")[0] + "\n"))).toBeNull();
  });

  it("без нужной колонки — ошибка со списком колонок", () => {
    expect(() => parsePlayInstallsCsv(Buffer.from("Date,Foo\n2026-10-01,1\n"))).toThrow(/Foo/);
  });
});

describe("App Store Connect", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  beforeEach(() => {
    vi.stubEnv("ASC_ISSUER_ID", "issuer-1");
    vi.stubEnv("ASC_KEY_ID", "KEY123");
    // В Vercel ключ лежит одной строкой с \n — как GOOGLE_SA_PRIVATE_KEY.
    vi.stubEnv("ASC_PRIVATE_KEY", pem.replace(/\n/g, "\\n"));
    vi.stubEnv("ASC_VENDOR_NUMBER", "11112222");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("подписывает JWT по ES256 с kid ключа", () => {
    const jwt = ascJwt(1_700_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({
      iss: "issuer-1",
      aud: "appstoreconnect-v1",
      iat: 1_700_000_000,
    });
    const ok = createVerify("sha256")
      .update(`${h}.${p}`)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  // Отчёт Apple с N скачиваниями Qurany (первые) — для месячных и дневных ответов.
  const tsvWith = (n: number) =>
    gzipSync(Buffer.from([ASC_HEADER.join("\t"), ascRow("6760942823", "1F", n), ascRow("6476192288", "1F", 50)].join("\n")));
  const notFound = () => new Response('{"errors":[{"code":"NOT_FOUND"}]}', { status: 404 });

  it("последний готовый день — от вчера назад; «+» за него = первые + повторные", async () => {
    const daily: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        expect(u.searchParams.get("filter[vendorNumber]")).toBe("11112222");
        const date = u.searchParams.get("filter[reportDate]") as string;
        if (u.searchParams.get("filter[frequency]") === "DAILY") daily.push(date);
        // Apple ещё не выложил 04.10 — как в жизни.
        if (date === "2026-10-04") return notFound();
        return new Response(gzipSync(Buffer.from(ASC_TSV)), { status: 200 });
      })
    );

    const r = await getAppStoreDownloads(NOW);
    expect(daily.slice(0, 2)).toEqual(["2026-10-04", "2026-10-03"]);
    expect(r).toMatchObject({ status: "ok", date: "2026-10-03", day: 12 });
  });

  it("всего за всё время = закрытые месяцы с выхода (18.08) + дни текущего до отчётного", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const freq = u.searchParams.get("filter[frequency]");
        const date = u.searchParams.get("filter[reportDate]") as string;
        asked.push(`${freq} ${date}`);
        if (freq === "MONTHLY") return date === "2026-08" ? new Response(tsvWith(1000), { status: 200 })
          : date === "2026-09" ? new Response(tsvWith(2000), { status: 200 }) : notFound();
        if (date === "2026-10-04") return notFound();
        return new Response(tsvWith(10), { status: 200 }); // 01–03.10 по 10
      })
    );

    const r = await getAppStoreDownloads(NOW);
    expect(r).toEqual({ status: "ok", date: "2026-10-03", day: 10, total: 1000 + 2000 + 3 * 10 });
    // Месяцы до выхода не спрашиваем.
    expect(asked.filter((a) => a.startsWith("MONTHLY"))).toEqual(["MONTHLY 2026-08", "MONTHLY 2026-09"]);
  });

  // 12.10 живой прогон: месячный отчёт с version=1_1 Apple отверг 400 PARAMETER_ERROR.INVALID,
  // дневной с 1_1 работает (с 1_0 дневной Apple отвергает с 2024 г.).
  it("месячный отчёт — версия 1_0, дневной — 1_1; отказ 400 по версии — пробует другую", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const freq = u.searchParams.get("filter[frequency]");
        const date = u.searchParams.get("filter[reportDate]") as string;
        const version = u.searchParams.get("filter[version]");
        asked.push(`${freq} ${date} ${version}`);
        const bad = (freq === "MONTHLY" && version !== "1_0") || (freq === "DAILY" && version !== "1_1");
        if (bad) return new Response(JSON.stringify({ errors: [{ status: "400", code: "PARAMETER_ERROR.INVALID", detail: "bad version" }] }), { status: 400 });
        if (freq === "MONTHLY") return new Response(tsvWith(date === "2026-08" ? 1000 : 2000), { status: 200 });
        if (date === "2026-10-04") return notFound();
        return new Response(tsvWith(10), { status: 200 });
      })
    );

    const r = await getAppStoreDownloads(NOW);
    expect(r).toEqual({ status: "ok", date: "2026-10-03", day: 10, total: 1000 + 2000 + 3 * 10 });
    expect(asked).toContain("MONTHLY 2026-08 1_0");
    expect(asked).toContain("DAILY 2026-10-03 1_1");
  });

  it("400 на всех версиях — ошибка с причиной Apple одной строкой и с тем, какой отчёт", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const freq = new URL(url).searchParams.get("filter[frequency]");
        if (freq === "DAILY") return new Response(tsvWith(10), { status: 200 });
        return new Response(
          JSON.stringify({ errors: [{ status: "400", code: "PARAMETER_ERROR.INVALID", title: "A parameter has an invalid value", detail: "Invalid reportDate" }] }, null, 2),
          { status: 400 }
        );
      })
    );

    const r = await getAppStoreDownloads(NOW);
    expect(r).toMatchObject({ status: "error" });
    const msg = (r as { message: string }).message;
    expect(msg).toContain("MONTHLY 2026-08");
    expect(msg).toContain("Invalid reportDate");
    expect(msg).not.toContain("\n");
  });

  it("месячного отчёта ещё нет (начало месяца) — месяц собирается из дневных", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const freq = u.searchParams.get("filter[frequency]");
        const date = u.searchParams.get("filter[reportDate]") as string;
        if (freq === "MONTHLY") return date === "2026-08" ? new Response(tsvWith(1000), { status: 200 }) : notFound();
        if (date.startsWith("2026-09")) return new Response(tsvWith(5), { status: 200 }); // 30 дней по 5
        if (date === "2026-10-01") return new Response(tsvWith(7), { status: 200 });
        return notFound();
      })
    );

    const r = await getAppStoreDownloads(new Date("2026-10-02T05:45:00Z"));
    expect(r).toEqual({ status: "ok", date: "2026-10-01", day: 7, total: 1000 + 30 * 5 + 7 });
  });

  it("без ключей — «не подключено», без запросов", async () => {
    vi.stubEnv("ASC_PRIVATE_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getAppStoreDownloads(NOW)).toEqual({ status: "off" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("отказ Apple (не 404) — ошибка с кодом, а не поиск дальше", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    const r = await getAppStoreDownloads(NOW);
    expect(r).toMatchObject({ status: "error" });
    expect((r as { message: string }).message).toContain("403");
  });
});

describe("Google Play", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  beforeEach(() => {
    vi.stubEnv("GOOGLE_SA_EMAIL", "bot@example.iam.gserviceaccount.com");
    vi.stubEnv("GOOGLE_SA_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    vi.stubEnv("PLAY_REPORTS_BUCKET", "pubsite_prod_123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Живой отчёт 12.10: колонка Total User Installs есть, но в ней 0 — Google её больше
  // не заполняет. Поэтому всего — всегда сумма Daily User Installs по всем месяцам.
  it("всего = сумма Daily User Installs по всем месячным файлам; «+» — последний день", async () => {
    const csv = (rows: string) => utf16("Date,Package Name,Daily User Installs\n" + rows);
    const files: Record<string, Buffer> = {
      "stats/installs/installs_com.qurany.app_202608_overview.csv": csv("2026-08-30,com.qurany.app,100\n2026-08-31,com.qurany.app,50\n"),
      "stats/installs/installs_com.qurany.app_202609_overview.csv": csv("2026-09-01,com.qurany.app,20\n"),
      "stats/installs/installs_com.qurany.app_202610_overview.csv": csv("2026-10-01,com.qurany.app,7\n2026-10-02,com.qurany.app,3\n"),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        const u = new URL(url);
        if (u.pathname.endsWith("/o")) {
          expect(u.searchParams.get("prefix")).toBe("stats/installs/installs_com.qurany.app_");
          const items = [...Object.keys(files), "stats/installs/installs_com.qurany.app_202610_country.csv"].map((name) => ({ name }));
          return new Response(JSON.stringify({ items }), { status: 200 });
        }
        const name = decodeURIComponent(u.pathname.split("/o/")[1]);
        return files[name] ? new Response(new Uint8Array(files[name]), { status: 200 }) : new Response("nf", { status: 404 });
      })
    );

    const r = await getPlayDownloads(NOW);
    expect(r).toEqual({ status: "ok", date: "2026-10-02", day: 3, total: 100 + 50 + 20 + 7 + 3 });
  });

  it("в начале месяца, пока в его файле пусто, последний день — из прошлого", async () => {
    const header = "Date,Package Name,Total User Installs,Daily User Installs\n";
    const files: Record<string, Buffer> = {
      "stats/installs/installs_com.qurany.app_202609_overview.csv": utf16(header + "2026-09-29,com.qurany.app,0,40\n2026-09-30,com.qurany.app,0,60\n"),
      "stats/installs/installs_com.qurany.app_202610_overview.csv": utf16(header),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        const u = new URL(url);
        if (u.pathname.endsWith("/o")) return new Response(JSON.stringify({ items: Object.keys(files).map((name) => ({ name })) }), { status: 200 });
        const name = decodeURIComponent(u.pathname.split("/o/")[1]);
        return files[name] ? new Response(new Uint8Array(files[name]), { status: 200 }) : new Response("nf", { status: 404 });
      })
    );

    const r = await getPlayDownloads(new Date("2026-10-01T05:45:00Z"));
    expect(r).toEqual({ status: "ok", date: "2026-09-30", day: 60, total: 100 });
  });

  it("без бакета — «не подключено»", async () => {
    vi.stubEnv("PLAY_REPORTS_BUCKET", "");
    expect(await getPlayDownloads(NOW)).toEqual({ status: "off" });
  });

  it("нет доступа к бакету — ошибка с подсказкой, кого пригласить", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://oauth2.googleapis.com/token")
          ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
          : new Response("denied", { status: 403 })
      )
    );
    const r = await getPlayDownloads(NOW);
    expect(r).toMatchObject({ status: "error" });
    expect((r as { message: string }).message).toContain("bot@example.iam.gserviceaccount.com");
  });
});
