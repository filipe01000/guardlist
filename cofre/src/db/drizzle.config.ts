import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';
import { getDatabaseConnectionConfig } from './connection.ts';

const connection = getDatabaseConnectionConfig();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: connection.connectionString
    ? { url: connection.connectionString, ssl: { rejectUnauthorized: true } }
    : process.env.SQL_HOST
      ? {
          host: process.env.SQL_HOST,
          database: process.env.SQL_DB_NAME!,
          user: process.env.SQL_ADMIN_USER || process.env.SQL_USER,
          password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD,
        }
      : undefined,
});
