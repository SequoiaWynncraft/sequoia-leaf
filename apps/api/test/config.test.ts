import { describe, expect, it } from "bun:test";

import { Redacted } from "effect";

import { readSettings } from "./support.ts";

const bucket = {
  BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  BACKUP_S3_BUCKET: "leaf-backups",
  BACKUP_S3_ACCESS_KEY_ID: "key-id",
  BACKUP_S3_SECRET_ACCESS_KEY: "key-secret",
};

describe("settings", () => {
  it("falls back to what local development needs", () => {
    expect(readSettings({})).toEqual({
      port: 3000,
      databasePath: "data/leaf.db",
      backupDirectory: "data/backups",
      backendUrl: "https://api.seqwawa.com",
      backendToken: undefined,
      sierraUrl: undefined,
      ratesWebhook: undefined,
      offsite: undefined,
      offsitePartlySet: [],
    });
  });

  it("treats a variable set to nothing as left out", () => {
    expect(readSettings({ PORT: "", BACKEND_INTERNAL_TOKEN: "", DATABASE_PATH: "" })).toMatchObject({
      port: 3000,
      databasePath: "data/leaf.db",
      backendToken: undefined,
    });
  });

  it("keeps the internal token out of anything that prints it", () => {
    const { backendToken } = readSettings({ BACKEND_INTERNAL_TOKEN: "internal-secret" });

    expect(backendToken === undefined ? undefined : Redacted.value(backendToken)).toBe("internal-secret");
    expect(Bun.inspect(backendToken)).not.toContain("internal-secret");
    expect(JSON.stringify({ backendToken })).not.toContain("internal-secret");
  });

  it("reads Sierra's address for the awards feed", () => {
    expect(readSettings({ SIERRA_URL: "http://sequoia-sierra:8082" }).sierraUrl).toBe("http://sequoia-sierra:8082");
  });

  it("copies snapshots off the server when all four bucket variables are set", () => {
    const { offsite, offsitePartlySet } = readSettings(bucket);

    expect(offsite).toMatchObject({
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "leaf-backups",
      accessKeyId: "key-id",
    });
    expect(offsite === undefined ? undefined : Redacted.value(offsite.secretAccessKey)).toBe("key-secret");
    expect(offsitePartlySet).toEqual([]);
  });

  it("names the bucket variables that are set when some are missing, and copies nothing", () => {
    expect(readSettings({ ...bucket, BACKUP_S3_SECRET_ACCESS_KEY: "" })).toMatchObject({
      offsite: undefined,
      offsitePartlySet: ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID"],
    });
  });

  it("refuses a port that is not a port number", () => {
    expect(() => readSettings({ PORT: "eighty" })).toThrow("PORT");
  });
});
