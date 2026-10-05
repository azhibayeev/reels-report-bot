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
  it("берёт последний день файла и установки пользователей", () => {
    expect(parsePlayInstallsCsv(utf16(PLAY_CSV))).toEqual({ date: "2026-10-02", downloads: 198 });
  });

  it("читает и UTF-8", () => {
    expect(parsePlayInstallsCsv(Buffer.from(PLAY_CSV))).toEqual({ date: "2026-10-02", downloads: 198 });
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

  it("идёт назад от вчера до первого готового отчёта и называет его дату", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        expect(u.searchParams.get("filter[vendorNumber]")).toBe("11112222");
        const date = u.searchParams.get("filter[reportDate]") as string;
        asked.push(date);
        // Apple ещё не выложил 04.10 — как в жизни.
        if (date === "2026-10-04") return new Response('{"errors":[{"code":"NOT_FOUND"}]}', { status: 404 });
        return new Response(gzipSync(Buffer.from(ASC_TSV)), { status: 200 });
      })
    );

    const r = await getAppStoreDownloads(NOW);
    expect(asked).toEqual(["2026-10-04", "2026-10-03"]);
    expect(r).toEqual({ status: "ok", date: "2026-10-03", downloads: 7, redownloads: 5 });
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

  it("в начале месяца, пока файла нет, берёт прошлый месяц", async () => {
    const objects: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        const name = decodeURIComponent(new URL(url).pathname.split("/o/")[1]);
        objects.push(name);
        if (name.includes("202610")) return new Response("not found", { status: 404 });
        return new Response(utf16(PLAY_CSV.replace(/2026-10/g, "2026-09")), { status: 200 });
      })
    );

    const r = await getPlayDownloads(new Date("2026-10-01T05:45:00Z"));
    expect(objects).toEqual([
      "stats/installs/installs_com.qurany.app_202610_overview.csv",
      "stats/installs/installs_com.qurany.app_202609_overview.csv",
    ]);
    expect(r).toEqual({ status: "ok", date: "2026-09-02", downloads: 198 });
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
