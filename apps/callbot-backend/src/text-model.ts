// Model for text jobs after a call (transcript, summary, classification, analysis).
// gemini-2.5-flash was withdrawn for this key (404 "no longer available to new users"),
// which silently stopped call descriptions and result classification. One place to change it.
export const DEFAULT_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';

// An env value naming a withdrawn model (e.g. POST_CALL_SUMMARY_MODEL=gemini-2.5-flash left in .env)
// must not keep the feature broken: it falls back to the default.
const WITHDRAWN = /^gemini-2\.5-flash(-lite)?$/;
export const textModel = (fromEnv?: string): string => (fromEnv && !WITHDRAWN.test(fromEnv.trim()) ? fromEnv.trim() : DEFAULT_TEXT_MODEL);
