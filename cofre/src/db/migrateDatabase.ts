import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index.ts';

// Aplica as migrações versionadas (pasta drizzle). Usado pelo GuardList ao montar o cofre em /cofre.
export async function migrateDonutVaultDatabase(): Promise<void> {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
}
