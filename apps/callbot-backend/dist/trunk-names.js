import postgres from 'postgres';
// sip_trunks lives in the telephony service's own database (robocall_crm), not this
// service's (robocall_callbot) -- see schema.ts's telephonyJobs.trunkId comment and
// billing.ts's TrunkUsage comment. Used only by the usage export (a rare, admin-triggered
// action), so this connection is opened lazily on first use and reused, not created at
// startup like the main `db` export in db/index.ts.
let client = null;
/**
 * Best-effort id -> name lookup for the given trunk ids. Returns an empty map (never
 * throws) if TELEPHONY_CRM_DATABASE_URL isn't configured or the lookup fails -- callers
 * should fall back to displaying the raw id, not treat a missing name as an error.
 */
export async function resolveTrunkNames(trunkIds) {
    const ids = [...new Set(trunkIds.filter(Boolean))];
    if (ids.length === 0)
        return {};
    const url = process.env.TELEPHONY_CRM_DATABASE_URL;
    if (!url)
        return {};
    try {
        if (!client)
            client = postgres(url, { max: 1 });
        const rows = await client `SELECT id, name FROM sip_trunks WHERE id = ANY(${ids})`;
        return Object.fromEntries(rows.map((row) => [String(row.id), String(row.name)]));
    }
    catch (err) {
        console.warn('[trunk-names] Failed to resolve trunk names:', err);
        return {};
    }
}
