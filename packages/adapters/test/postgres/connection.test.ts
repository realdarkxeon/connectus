import { describe, expect, it } from "vitest";
import { postgresConnection } from "../../src/postgres/connection.ts";

const CA = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";

describe("postgresConnection", () => {
  it("uses the URL as is when there is no CA (local development)", () => {
    const url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    expect(postgresConnection(url)).toEqual({ connectionString: url });
  });

  it("verifies the server certificate and hostname when a CA is given", () => {
    const result = postgresConnection("postgresql://u:p@db.example.com:5432/postgres", CA);
    expect(result.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it("removes sslmode so it cannot weaken the verification", () => {
    const result = postgresConnection(
      "postgresql://u:p@db.example.com:5432/postgres?sslmode=require&application_name=x",
      CA,
    );
    expect(result.connectionString).not.toContain("sslmode");
    expect(result.connectionString).toContain("application_name=x");
  });
});
