import { describe, it, expect, afterEach } from "vitest";
import { buildJwtClaim, loadCreds, sheetsConfigured } from "../lib/sheets";

const KEYS = ["GOOGLE_SA_EMAIL", "GOOGLE_SA_PRIVATE_KEY", "SHEETS_SPREADSHEET_ID"] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("buildJwtClaim", () => {
  it("targets Google's token endpoint with the spreadsheets scope", () => {
    const claim = buildJwtClaim("bot@proj.iam.gserviceaccount.com", 1_000_000);
    expect(claim.iss).toBe("bot@proj.iam.gserviceaccount.com");
    expect(claim.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claim.scope).toBe("https://www.googleapis.com/auth/spreadsheets");
  });

  it("expires one hour after issuing", () => {
    const claim = buildJwtClaim("bot@x.iam.gserviceaccount.com", 1_000_000);
    expect(claim.iat).toBe(1_000_000);
    expect(claim.exp).toBe(1_003_600);
  });
});

describe("loadCreds", () => {
  it("unescapes newlines in the PEM private key", () => {
    process.env.GOOGLE_SA_EMAIL = "bot@x.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n";
    expect(loadCreds().privateKey).toBe("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n");
  });

  it("throws when credentials are missing", () => {
    expect(() => loadCreds()).toThrow(/GOOGLE_SA_EMAIL/);
  });
});

describe("sheetsConfigured", () => {
  it("is false until email, key and spreadsheet id are all set", () => {
    expect(sheetsConfigured()).toBe(false);
    process.env.GOOGLE_SA_EMAIL = "bot@x.iam.gserviceaccount.com";
    process.env.GOOGLE_SA_PRIVATE_KEY = "k";
    expect(sheetsConfigured()).toBe(false);
    process.env.SHEETS_SPREADSHEET_ID = "abc";
    expect(sheetsConfigured()).toBe(true);
  });
});
