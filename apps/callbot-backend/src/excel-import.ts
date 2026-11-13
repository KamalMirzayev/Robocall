import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { EXCEL_SOURCE, splitCar } from './campaign-results.js';

// Customers for the service and credit-offer campaigns come as an Excel sheet. Columns are
// recognised by their header text (Azerbaijani or English); any other column is kept and
// shown to the bot as extra info.

type Field = 'name' | 'phone' | 'brand' | 'model' | 'last_service_date' | 'last_talk';

const HEADER_PATTERNS: Array<[Field, RegExp]> = [
  ['phone', /(telefon|nömrə|nomre|mobil|phone|tel\b|gsm)/i],
  ['last_service_date', /(servis|gəliş|gelis|son\s*tarix|last\s*service|visit)/i],
  ['last_talk', /(danışıq|danisiq|qeyd|şərh|serh|comment|note|son\s*əlaqə|son\s*elaqe)/i],
  ['brand', /(marka|maşın|masin|avtomobil|brand|car)/i],
  ['model', /(model)/i],
  ['name', /(ad|soyad|müştəri|musteri|name|client|customer)/i],
];

const MAX_ROWS = 20_000;

export interface ParsedSheet {
  columns: Array<{ header: string; field: Field | null }>;
  rows: Array<{ name: string; phone: string | null; rawPhone: string; brand: string; model: string; last_service_date: string; last_talk: string; extra: Record<string, string> }>;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
  }
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }>; hyperlink?: string };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? '').join('').trim();
    if (v.text != null) return cellText(v.text);
    if (v.result != null) return cellText(v.result);
    return '';
  }
  return String(value).trim();
}

// 994XXXXXXXXX, from 0XX..., +994..., 994... or a bare 9-digit mobile number.
export function normalizePhone(raw: string): string | null {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00994')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = `994${d.slice(1)}`;
  if (d.length === 9) d = `994${d}`;
  return /^994\d{9}$/.test(d) ? d : null;
}

export async function parseCustomerSheet(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) throw new Error('Excel faylında məlumat yoxdur');

  // The header is the first row that has at least two non-empty cells.
  let headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const vals = (ws.getRow(r).values as unknown[]).slice(1).map(cellText).filter(Boolean);
    if (vals.length >= 2) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) throw new Error('Başlıq sətri tapılmadı');

  const header = (ws.getRow(headerRow).values as unknown[]).slice(1).map(cellText);
  const used = new Set<Field>();
  const columns = header.map((h) => {
    let field: Field | null = null;
    for (const [f, re] of HEADER_PATTERNS) {
      if (!used.has(f) && h && re.test(h)) {
        field = f;
        used.add(f);
        break;
      }
    }
    return { header: h, field };
  });
  if (!used.has('phone')) throw new Error('Telefon sütunu tapılmadı (başlıqda "telefon" və ya "nömrə" olmalıdır)');

  const rows: ParsedSheet['rows'] = [];
  for (let r = headerRow + 1; r <= ws.rowCount && rows.length < MAX_ROWS; r++) {
    const vals = (ws.getRow(r).values as unknown[]).slice(1);
    if (!vals.some((v) => cellText(v))) continue;
    const row = { name: '', phone: null as string | null, rawPhone: '', brand: '', model: '', last_service_date: '', last_talk: '', extra: {} as Record<string, string> };
    columns.forEach((col, i) => {
      const text = cellText(vals[i]).slice(0, 1000);
      if (!text) return;
      if (col.field === 'phone') {
        row.rawPhone = text;
        row.phone = normalizePhone(text);
      } else if (col.field) {
        row[col.field] = text;
      } else if (col.header) {
        row.extra[col.header.slice(0, 60)] = text;
      }
    });
    const car = splitCar(row.brand, row.model);
    row.brand = car.brand;
    row.model = car.model;
    rows.push(row);
  }
  return { columns, rows };
}

export interface ExcelImportResult {
  columns: ParsedSheet['columns'];
  total: number;
  valid: number;
  invalidPhones: number;
  duplicates: number;
  doNotCall: number;
  alreadyInCampaign: number;
  added: number;
  sample: Array<{ name: string; phone: string | null; brand: string; model: string; last_service_date: string; last_talk: string }>;
}

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export async function importCustomerSheet(campaignId: number, buffer: Buffer, dryRun: boolean): Promise<ExcelImportResult> {
  const sheet = await parseCustomerSheet(buffer);
  const seen = new Set<string>();
  let invalidPhones = 0;
  let duplicates = 0;
  const unique: ParsedSheet['rows'] = [];
  for (const row of sheet.rows) {
    if (!row.phone) {
      invalidPhones += 1;
      continue;
    }
    if (seen.has(row.phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.phone);
    unique.push(row);
  }

  const phones = unique.map((r) => r.phone as string);
  const blocked = new Set<string>();
  const inCampaign = new Set<string>();
  if (phones.length) {
    for (const row of rowsFrom(await db.execute(sql`
      SELECT regexp_replace(coalesce(phone, ''), '\\D', '', 'g') AS p, do_not_call,
             EXISTS (SELECT 1 FROM campaign_calls cc WHERE cc.customer_id = customers.id AND cc.campaign_id = ${campaignId}) AS linked
      FROM customers
      WHERE regexp_replace(coalesce(phone, ''), '\\D', '', 'g') IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})
    `))) {
      if (row.do_not_call === true) blocked.add(String(row.p));
      if (row.linked === true) inCampaign.add(String(row.p));
    }
  }

  let added = 0;
  if (!dryRun) {
    for (const row of unique) {
      const phone = row.phone as string;
      if (blocked.has(phone) || inCampaign.has(phone)) continue;
      const data = JSON.stringify({
        brand: row.brand || null,
        model: row.model || null,
        last_service_date: row.last_service_date || null,
        last_talk: row.last_talk || null,
        extra: row.extra,
        campaign_id: campaignId,
      });
      const name = row.name || 'Hörmətli müştəri';
      const [existing] = rowsFrom(await db.execute(sql`
        SELECT id FROM customers WHERE source_system = ${EXCEL_SOURCE} AND source_record_key = ${phone} LIMIT 1
      `));
      let customerId: number;
      if (existing) {
        customerId = Number(existing.id);
        await db.execute(sql`
          UPDATE customers SET name = ${name}, surname = '-', phone = ${phone}, mobile_phone = ${phone},
            category = ${row.brand || null}, import_data = ${data}::jsonb, last_synced_at = now()
          WHERE id = ${customerId}
        `);
      } else {
        const [ins] = rowsFrom(await db.execute(sql`
          INSERT INTO customers (name, surname, phone, mobile_phone, category, source_system, source_record_key, import_data, imported_at)
          VALUES (${name}, '-', ${phone}, ${phone}, ${row.brand || null}, ${EXCEL_SOURCE}, ${phone}, ${data}::jsonb, now())
          RETURNING id
        `));
        customerId = Number(ins.id);
      }
      await db.execute(sql`
        INSERT INTO campaign_calls (campaign_id, customer_id, status, attempt_number, created_at, updated_at)
        VALUES (${campaignId}, ${customerId}, 'pending', 0, now(), now())
      `);
      added += 1;
    }
    if (added) {
      await db.execute(sql`UPDATE campaigns SET total_customers = total_customers + ${added}, updated_at = now() WHERE id = ${campaignId}`);
    }
  }

  const eligible = unique.filter((r) => !blocked.has(r.phone as string) && !inCampaign.has(r.phone as string)).length;
  return {
    columns: sheet.columns,
    total: sheet.rows.length,
    valid: dryRun ? eligible : added,
    invalidPhones,
    duplicates,
    doNotCall: [...blocked].length,
    alreadyInCampaign: [...inCampaign].length,
    added,
    sample: unique.slice(0, 5).map((r) => ({ name: r.name, phone: r.phone, brand: r.brand, model: r.model, last_service_date: r.last_service_date, last_talk: r.last_talk.slice(0, 120) })),
  };
}
