// Model for text jobs after a call (transcript, summary, classification, analysis).
// gemini-2.5-flash was withdrawn for this key (404 "no longer available to new users"),
// which silently stopped call descriptions and result classification. One place to change it.
export const DEFAULT_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
