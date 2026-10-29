import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as schema from './schema.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
try {
    await migrate(drizzle(migrationClient), {
        migrationsFolder: join(__dirname, '../../drizzle'),
    });
}
catch (err) {
    // As of the 0000_baseline squash (2026-07-29), every already-deployed
    // server has been marked caught-up in drizzle.__drizzle_migrations, so
    // this should never fire in normal operation — a failure here means a
    // genuinely new migration is broken or the DB is unreachable, not (as
    // the old migration history made likely) "tables already exist". Log
    // loudly rather than swallowing it as a harmless warning; the app still
    // starts non-fatally since a transient DB hiccup here shouldn't take
    // down an otherwise-healthy process.
    console.error('[DB] Migration FAILED — schema may be out of date:', err);
}
await migrationClient.end();
const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
