import assert from 'node:assert/strict';
import { getDatabaseConnectionConfig } from '../src/db/connection.ts';

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
console.log('Database configuration checks passed.');
