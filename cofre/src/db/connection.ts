import type { PoolConfig } from 'pg';

export function getDatabaseConnectionConfig(
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
    }
    // pg URL SSL parameters override the explicit, verified TLS configuration.
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      url.searchParams.delete(key);
    }
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true },
    };
  }

  return {
    host: env.SQL_HOST,
    user: env.SQL_USER,
    password: env.SQL_PASSWORD,
    database: env.SQL_DB_NAME,
  };
}
