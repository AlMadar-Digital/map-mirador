/** ISO 639-1 codes for languages conventionally written right-to-left. */
const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ur'];

/**
 * Whether a locale code (e.g. 'ar', 'ar-SA') is a right-to-left language, for deriving a
 * sensible default MUI theme `direction` from the active UI language.
 * @param {string} language
 * @returns {boolean}
 */
export function isRtlLanguage(language) {
  if (!language) return false;
  return RTL_LANGUAGES.includes(language.split('-')[0].toLowerCase());
}
