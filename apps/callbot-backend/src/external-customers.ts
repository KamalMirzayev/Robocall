import { and, eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { customers } from './db/schema.js';

export const EXTERNAL_CUSTOMER_SOURCE_SYSTEM = 'mobile_app';

// Find-or-create for consumers coming in via the external call-trigger API. Deliberately
// does NOT dedupe against existing PKS/collections customers by phone (see
// campaigns.ts's resolveExistingCustomer for that path) — mixing a self-registered
// mobile-app consumer with a debt-collection record on phone match alone would be a
// correctness/consent risk. Instead this is keyed on (sourceSystem, sourceRecordKey), the
// same "external system gives us a stable id" pattern PKS import uses, with
// externalConsumerId (the mobile app's own user id) as the key — exact match only, so
// replaying the same externalConsumerId is idempotent.
export async function resolveOrCreateExternalCustomer(params: {
  externalConsumerId: string;
  phone: string;
  name?: string;
  surname?: string;
}): Promise<{ id: number }> {
  const sourceRecordKey = params.externalConsumerId.trim();

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(
      eq(customers.sourceSystem, EXTERNAL_CUSTOMER_SOURCE_SYSTEM),
      eq(customers.sourceRecordKey, sourceRecordKey),
    ))
    .limit(1);

  if (existing) {
    await db.update(customers).set({
      phone: params.phone,
      mobilePhone: params.phone,
      lastSyncedAt: new Date(),
    }).where(eq(customers.id, existing.id));
    return existing;
  }

  const [created] = await db.insert(customers).values({
    name: params.name?.trim() || 'Müştəri',
    surname: params.surname?.trim() || '-',
    phone: params.phone,
    mobilePhone: params.phone,
    sourceSystem: EXTERNAL_CUSTOMER_SOURCE_SYSTEM,
    sourceRecordKey,
    importedAt: new Date(),
  }).returning({ id: customers.id });

  return created;
}
