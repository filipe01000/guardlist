import assert from 'node:assert/strict';
import { getDatabaseConnectionConfig, hasDatabaseConfig } from '../src/db/connection.ts';

const neon = getDatabaseConnectionConfig({
  DATABASE_URL: 'postgresql://test:example@db.example.test/test?ssl=false&sslmode=disable&sslrootcert=system',
});
assert.deepEqual(neon.ssl, { rejectUnauthorized: true });
const neonUrl = new URL(neon.connectionString!);
assert.equal(neonUrl.searchParams.has('sslmode'), false);
assert.equal(neonUrl.searchParams.has('ssl'), false);
assert.equal(neonUrl.searchParams.has('sslrootcert'), false);
assert.throws(() => getDatabaseConnectionConfig({ DATABASE_URL: 'https://example.test' }));
assert.deepEqual(
  getDatabaseConnectionConfig({ SQL_HOST: 'localhost', SQL_DB_NAME: 'test', SQL_USER: 'test', SQL_PASSWORD: 'example' }),
  { host: 'localhost', database: 'test', user: 'test', password: 'example' }
);
// Dentro do GuardList: só as variáveis DONUTVAULT_*, nunca o DATABASE_URL da equipe.
const embedded = getDatabaseConnectionConfig({
  DONUTVAULT_EMBEDDED: '1',
  DATABASE_URL: 'postgresql://equipe:x@guardlist.example.test/equipe',
  DONUTVAULT_DATABASE_URL: 'postgresql://cofre:x@cofre.example.test/cofre',
});
assert.equal(new URL(embedded.connectionString!).hostname, 'cofre.example.test');
assert.throws(() =>
  getDatabaseConnectionConfig({ DONUTVAULT_EMBEDDED: '1', DATABASE_URL: 'postgresql://equipe:x@guardlist.example.test/equipe' })
);
assert.equal(hasDatabaseConfig({ DONUTVAULT_EMBEDDED: '1', DATABASE_URL: 'postgresql://equipe:x@h/e' }), false);
assert.equal(hasDatabaseConfig({ DONUTVAULT_EMBEDDED: '1', DONUTVAULT_SQL_HOST: 'localhost' }), true);
assert.deepEqual(
  getDatabaseConnectionConfig({ DONUTVAULT_EMBEDDED: '1', DONUTVAULT_SQL_HOST: 'localhost', DONUTVAULT_SQL_PORT: '55433', DONUTVAULT_SQL_DB_NAME: 'cofre' }),
  { host: 'localhost', port: 55433, user: undefined, password: undefined, database: 'cofre' }
);
console.log('Database configuration checks passed.');
