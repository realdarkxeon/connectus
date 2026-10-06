// Connection settings for node-postgres and pg-boss. With a CA certificate (Supabase's
// prod CA, see certs/README.md) the server certificate and hostname are verified
// (verify-full). The sslmode query parameter is removed so it cannot override that.
// Without a CA (local development) the URL is used as is.
export type PostgresConnection = {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
};

export function postgresConnection(url: string, caCertificate?: string): PostgresConnection {
  if (!caCertificate) return { connectionString: url };
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  return {
    connectionString: parsed.toString(),
    ssl: { ca: caCertificate, rejectUnauthorized: true },
  };
}
