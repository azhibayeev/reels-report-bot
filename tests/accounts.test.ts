import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ACCOUNTS,
  DARISTEPPE,
  QURANY_APP,
  accountByKey,
  accountConfigured,
  accountUserId,
  accountsToRun,
  historyTabOf,
  reelsTabOf,
} from "../lib/accounts";

describe("account configs", () => {
  it("keeps daristeppe on the blob paths the bot already writes to", () => {
    // Эти пути существуют в проде с 20.07: сменишь — потеряется вся история.
    expect(DARISTEPPE.snapshotPrefix).toBe("snapshots/");
    expect(DARISTEPPE.tokenPath).toBe("state/token.enc");
    expect(DARISTEPPE.durationsPath).toBe("state/durations.json");
    expect(DARISTEPPE.userIdEnv).toBe("IG_USER_ID");
    expect(DARISTEPPE.tokenEnv).toBe("IG_ACCESS_TOKEN");
  });

  it("puts qurany_app snapshots outside the daristeppe prefix", () => {
    // list({ prefix: "snapshots/" }) забрал бы вложенные ключи вместе со своими,
    // и чужие рилсы уехали бы в отчёт daristeppe.
    expect(QURANY_APP.snapshotPrefix.startsWith(DARISTEPPE.snapshotPrefix)).toBe(false);
    expect(DARISTEPPE.snapshotPrefix.startsWith(QURANY_APP.snapshotPrefix)).toBe(false);
  });

  it("gives every account its own state files", () => {
    const tokens = ACCOUNTS.map((a) => a.tokenPath);
    const durations = ACCOUNTS.map((a) => a.durationsPath);
    expect(new Set(tokens).size).toBe(ACCOUNTS.length);
    expect(new Set(durations).size).toBe(ACCOUNTS.length);
  });

  it("finds an account by key and ignores unknown ones", () => {
    expect(accountByKey("daristeppe")).toBe(DARISTEPPE);
    expect(accountByKey("qurany-app")).toBe(QURANY_APP);
    expect(accountByKey("nope")).toBeNull();
  });
});

describe("account env", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.IG_USER_ID;
    delete process.env.IG_USER_ID_QURANY_APP;
    delete process.env.SHEETS_TAB;
    delete process.env.SHEETS_TAB_QURANY_APP;
    delete process.env.SHEETS_HISTORY_TAB;
    delete process.env.SHEETS_HISTORY_TAB_QURANY_APP;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the IG user id from the account's own variable", () => {
    process.env.IG_USER_ID = "17841413773053161";
    process.env.IG_USER_ID_QURANY_APP = "17841444197238385";
    expect(accountUserId(DARISTEPPE)).toBe("17841413773053161");
    expect(accountUserId(QURANY_APP)).toBe("17841444197238385");
  });

  it("names the missing variable when the account is not set up", () => {
    expect(() => accountUserId(QURANY_APP)).toThrow(/IG_USER_ID_QURANY_APP/);
  });

  it("reports an account as configured only when its id is set", () => {
    expect(accountConfigured(QURANY_APP)).toBe(false);
    process.env.IG_USER_ID_QURANY_APP = "17841444197238385";
    expect(accountConfigured(QURANY_APP)).toBe(true);
  });

  it("runs every configured account when nothing is asked for in particular", () => {
    process.env.IG_USER_ID = "1";
    process.env.IG_USER_ID_QURANY_APP = "2";
    expect(accountsToRun(null)).toEqual([DARISTEPPE, QURANY_APP]);
  });

  it("skips an account that has no id yet, instead of failing the whole run", () => {
    process.env.IG_USER_ID = "1";
    expect(accountsToRun(null)).toEqual([DARISTEPPE]);
  });

  it("narrows the run to one account on request", () => {
    process.env.IG_USER_ID = "1";
    process.env.IG_USER_ID_QURANY_APP = "2";
    expect(accountsToRun("qurany-app")).toEqual([QURANY_APP]);
  });

  it("refuses a misspelled account instead of silently doing nothing", () => {
    process.env.IG_USER_ID = "1";
    expect(() => accountsToRun("quranyapp")).toThrow(/quranyapp/);
  });

  it("keeps default sheet tabs apart and lets env override them", () => {
    expect(reelsTabOf(DARISTEPPE)).toBe("Reels");
    expect(historyTabOf(DARISTEPPE)).toBe("History");
    expect(reelsTabOf(QURANY_APP)).not.toBe(reelsTabOf(DARISTEPPE));
    expect(historyTabOf(QURANY_APP)).not.toBe(historyTabOf(DARISTEPPE));

    process.env.SHEETS_TAB_QURANY_APP = "Reels app";
    expect(reelsTabOf(QURANY_APP)).toBe("Reels app");
  });
});
