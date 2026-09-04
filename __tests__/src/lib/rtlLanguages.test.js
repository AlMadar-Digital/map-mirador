import { isRtlLanguage } from '../../../src/lib/rtlLanguages';

describe('isRtlLanguage', () => {
  it('is true for known right-to-left language codes', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('fa')).toBe(true);
    expect(isRtlLanguage('he')).toBe(true);
    expect(isRtlLanguage('ur')).toBe(true);
  });

  it('matches on the primary subtag of a locale variant', () => {
    expect(isRtlLanguage('ar-SA')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRtlLanguage('AR')).toBe(true);
  });

  it('is false for left-to-right languages', () => {
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('fr')).toBe(false);
  });

  it('is false for an empty or missing language', () => {
    expect(isRtlLanguage('')).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });
});
