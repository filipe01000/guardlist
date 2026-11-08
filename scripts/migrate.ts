import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

let pool: Pool | undefined;

try {
  const { db, createPool } = await import('../src/db/index.ts');
  pool = createPool();
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log('Database migrations are up to date.');
} catch (error) {
  const failure = error as { code?: string; cause?: { code?: string } };
  const code = failure.cause?.code || failure.code;
  const safeCode = code && /^[A-Z0-9_]{2,32}$/.test(code) ? ` (${code})` : '';
  console.error(
    `Database migration failed${safeCode}. Check database connectivity and the versioned migration files.`
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
