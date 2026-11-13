import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// How many calls a trunk may carry at once. A trunk without a row carries one call.
// Set with: INSERT INTO trunk_capacity (trunk_id, max_calls) VALUES ('<id>', 2)
//           ON CONFLICT (trunk_id) DO UPDATE SET max_calls = EXCLUDED.max_calls;
export async function ensureTrunkCapacitySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS trunk_capacity (
      trunk_id text PRIMARY KEY,
      max_calls integer NOT NULL DEFAULT 1 CHECK (max_calls BETWEEN 1 AND 30)
    )
  `);
}
