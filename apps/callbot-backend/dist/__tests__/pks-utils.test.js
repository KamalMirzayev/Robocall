import { describe, expect, it } from 'vitest';
import { FIN_REGEX, validateFin } from '../pks-utils.js';
// ---------------------------------------------------------------------------
// FIN_REGEX
// ---------------------------------------------------------------------------
describe('FIN_REGEX', () => {
    it('matches exactly 7 alphanumeric characters', () => {
        expect(FIN_REGEX.test('A1B2C3D')).toBe(true);
        expect(FIN_REGEX.test('1234567')).toBe(true);
        expect(FIN_REGEX.test('ABCDEFG')).toBe(true);
        expect(FIN_REGEX.test('abcdefg')).toBe(true);
        expect(FIN_REGEX.test('aB3cD4e')).toBe(true);
    });
    it('rejects values with invalid length', () => {
        expect(FIN_REGEX.test('A1B2C3')).toBe(false); // 6 chars
        expect(FIN_REGEX.test('A1B2C3DE')).toBe(false); // 8 chars
        expect(FIN_REGEX.test('')).toBe(false); // empty
        expect(FIN_REGEX.test('A')).toBe(false); // 1 char
    });
    it('rejects non-alphanumeric characters', () => {
        expect(FIN_REGEX.test('A1B2C3!')).toBe(false); // special char
        expect(FIN_REGEX.test('A1B2C3 ')).toBe(false); // trailing space
        expect(FIN_REGEX.test(' A1B2C3')).toBe(false); // leading space
        expect(FIN_REGEX.test('A1-2C3D')).toBe(false); // hyphen
        expect(FIN_REGEX.test('A1B2C3_')).toBe(false); // underscore
    });
});
// ---------------------------------------------------------------------------
// validateFin
// ---------------------------------------------------------------------------
describe('validateFin', () => {
    it('accepts valid 7-char alphanumeric FIN strings', () => {
        expect(validateFin('A1B2C3D')).toBe('A1B2C3D');
        expect(validateFin('1234567')).toBe('1234567');
        expect(validateFin('ABCDEFG')).toBe('ABCDEFG');
        expect(validateFin('abcdefg')).toBe('abcdefg');
    });
    it('returns null for null/undefined/empty values', () => {
        expect(validateFin(null)).toBeNull();
        expect(validateFin(undefined)).toBeNull();
        expect(validateFin('')).toBeNull();
        expect(validateFin('  ')).toBeNull();
    });
    it('returns null for invalid length and logs warning', () => {
        expect(validateFin('A1B2C3')).toBeNull(); // too short
        expect(validateFin('A1B2C3DE')).toBeNull(); // too long
        expect(validateFin('A')).toBeNull(); // way too short
    });
    it('returns null for non-alphanumeric characters', () => {
        expect(validateFin('A1B2C3!')).toBeNull();
        expect(validateFin('A1-2C3D')).toBeNull();
        expect(validateFin('A1B2C3_')).toBeNull();
    });
    it('rejects numeric values that are too long (legacy bigint format)', () => {
        // Old API sent fin as a bigint number; reject those that are too long when stringified
        expect(validateFin(1234567891234)).toBeNull(); // 13 digits (old bigint) — too long
        // But a 7-digit numeric value IS valid when converted to string
        expect(validateFin(1234567)).toBe('1234567'); // 7 digits → '1234567' → valid
    });
});
// ---------------------------------------------------------------------------
// PksRow type contract
// ---------------------------------------------------------------------------
describe('PksRow contract', () => {
    it('accepts a row with comment_template_name and status_category', () => {
        const row = {
            organization: 'Manato.az',
            muqavile_no: 'MAN-2024-001',
            musterinin_asa: 'Əli Hüseynov',
            fin: 'A1B2C3D',
            comment_template_name: 'standart_xatirlatma',
            status_category: 'Ödənişə söz verib',
            odenis_ayliq: 500,
            status: 'Активный',
            mobile_phone: '+994501234567',
        };
        expect(row.comment_template_name).toBe('standart_xatirlatma');
        expect(row.status_category).toBe('Ödənişə söz verib');
        expect(row.fin).toBe('A1B2C3D');
        expect(row.cari_borc).toBeUndefined();
    });
    it('accepts a row without the removed cari_borc field', () => {
        const row = {
            fin: 'A1B2C3D',
            comment_template_name: 'gecikme_bildirisi',
            status_category: 'Müqavilə ləğv edilib',
        };
        // cari_borc must not be required — new contract does not include it
        expect('cari_borc' in row).toBe(false);
        expect(row.comment_template_name).toBeDefined();
        expect(row.status_category).toBeDefined();
    });
    it('backward-compat: cari_borc is optional/deprecated but does not cause type errors', () => {
        // Old payloads may still carry cari_borc; the type accepts it but marks it deprecated
        const row = {
            fin: 'A1B2C3D',
            cari_borc: '45000.50',
        };
        expect(row.cari_borc).toBe('45000.50');
        // New fields absent is fine — they are nullable
        expect(row.comment_template_name).toBeUndefined();
    });
    it('fin must be a string, not a number', () => {
        const row = {
            fin: 'A1B2C3D', // string, not number — type enforced at compile time
        };
        expect(typeof row.fin).toBe('string');
    });
});
