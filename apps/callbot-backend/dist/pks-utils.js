export const FIN_REGEX = /^[A-Za-z0-9]{7}$/;
/**
 * Validates a FIN value against the 7-character alphanumeric format.
 * Returns the trimmed FIN string if valid, or null if absent/invalid.
 * Logs a warning for non-null values that fail validation.
 */
export function validateFin(value) {
    const text = (String(value ?? '').trim()) || null;
    if (!text)
        return null;
    if (!FIN_REGEX.test(text)) {
        console.warn(`[PKS] Invalid FIN "${text}": expected exactly 7 alphanumeric characters ([A-Za-z0-9]{7}). Discarding.`);
        return null;
    }
    return text;
}
