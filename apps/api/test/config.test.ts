import { describe, expect, it } from "bun:test";

import { readConfig } from "../src/config.ts";

const bucket = {
  BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  BACKUP_S3_BUCKET: "leaf-backups",
  BACKUP_S3_ACCESS_KEY_ID: "key-id",
  BACKUP_S3_SECRET_ACCESS_KEY: "key-secret",
};

describe("readConfig", () => {
  it("falls back to what local development needs", () => {
    expect(readConfig({})).toEqual({
      port: 3000,
      databasePath: "data/leaf.db",
      backupDirectory: "data/backups",
      backendUrl: "https://api.seqwawa.com",
      backendToken: undefined,
      sierraUrl: undefined,
      offsite: undefined,
      offsitePartlySet: [],
    });
  });

  it("reads Sierra's address for the awards feed", () => {
    expect(readConfig({ SIERRA_URL: "http://sequoia-sierra:8082" }).sierraUrl).toBe("http://sequoia-sierra:8082");
  });

  it("copies snapshots off the server when all four bucket variables are set", () => {
    expect(readConfig(bucket)).toMatchObject({
      offsite: {
        endpoint: "https://example.r2.cloudflarestorage.com",
        bucket: "leaf-backups",
        accessKeyId: "key-id",
        secretAccessKey: "key-secret",
      },
      offsitePartlySet: [],
    });
  });

  it("names the bucket variables that are set when some are missing, and copies nothing", () => {
    expect(readConfig({ ...bucket, BACKUP_S3_SECRET_ACCESS_KEY: "" })).toMatchObject({
      offsite: undefined,
      offsitePartlySet: ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID"],
    });
  });

  it("refuses a port that is not a port number", () => {
    expect(() => readConfig({ PORT: "eighty" })).toThrow("PORT is not a port number: eighty");
  });
});
