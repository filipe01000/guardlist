import type { PoolConfig } from 'pg';

/**
 * Dentro do GuardList (DONUTVAULT_EMBEDDED=1) o cofre usa só as variáveis com prefixo DONUTVAULT_.
 * O DATABASE_URL de lá é o banco da equipe, que também tem uma tabela "users": nunca pode ser usado.
 */
export function isEmbedded(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DONUTVAULT_EMBEDDED === '1';
}

export function hasDatabaseConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEmbedded(env)
    ? Boolean(env.DONUTVAULT_DATABASE_URL || env.DONUTVAULT_SQL_HOST)
    : Boolean(env.DATABASE_URL || env.SQL_HOST);
}

export function getDatabaseConnectionConfig(
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  const embedded = isEmbedded(env);
  const databaseUrl = embedded ? env.DONUTVAULT_DATABASE_URL : env.DATABASE_URL;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
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

  if (embedded) {
    if (!env.DONUTVAULT_SQL_HOST) {
      throw new Error('Defina DONUTVAULT_DATABASE_URL para o cofre (banco próprio, separado do GuardList).');
    }
    return {
      host: env.DONUTVAULT_SQL_HOST,
      port: env.DONUTVAULT_SQL_PORT ? Number(env.DONUTVAULT_SQL_PORT) : undefined,
      user: env.DONUTVAULT_SQL_USER,
      password: env.DONUTVAULT_SQL_PASSWORD,
      database: env.DONUTVAULT_SQL_DB_NAME,
    };
  }

  return {
    host: env.SQL_HOST,
    user: env.SQL_USER,
    password: env.SQL_PASSWORD,
    database: env.SQL_DB_NAME,
  };
}
