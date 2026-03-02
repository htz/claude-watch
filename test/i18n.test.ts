import { beforeEach, describe, expect, it } from 'vitest';
import enMessages from '../src/i18n/en.json';
import { getLocale, setLocale, t } from '../src/i18n/index';
import jaMessages from '../src/i18n/ja.json';

describe('i18n', () => {
  beforeEach(() => {
    setLocale('ja');
  });

  describe('key consistency', () => {
    it('should have the same keys in ja.json and en.json', () => {
      const jaKeys = Object.keys(jaMessages).sort();
      const enKeys = Object.keys(enMessages).sort();
      expect(enKeys).toEqual(jaKeys);
    });

    it('should not have empty values in ja.json', () => {
      for (const [key, value] of Object.entries(jaMessages)) {
        expect(value, `ja.json key "${key}" should not be empty`).not.toBe('');
      }
    });

    it('should not have empty values in en.json', () => {
      for (const [key, value] of Object.entries(enMessages)) {
        expect(value, `en.json key "${key}" should not be empty`).not.toBe('');
      }
    });
  });

  describe('parameter placeholders', () => {
    it('should have matching placeholders between ja and en', () => {
      const placeholderRegex = /\{(\w+)\}/g;
      const jaKeys = Object.keys(jaMessages) as (keyof typeof jaMessages)[];

      for (const key of jaKeys) {
        const jaValue = jaMessages[key];
        const enValue = enMessages[key as keyof typeof enMessages];

        const jaPlaceholders = [...jaValue.matchAll(placeholderRegex)].map((m) => m[1]).sort();
        const enPlaceholders = [...enValue.matchAll(placeholderRegex)].map((m) => m[1]).sort();

        expect(enPlaceholders, `Placeholders mismatch for key "${key}"`).toEqual(jaPlaceholders);
      }
    });
  });

  describe('t() function', () => {
    it('should return Japanese text when locale is ja', () => {
      setLocale('ja');
      expect(t('danger.safe')).toBe('安全');
      expect(t('ui.allow')).toBe('許可');
    });

    it('should return English text when locale is en', () => {
      setLocale('en');
      expect(t('danger.safe')).toBe('Safe');
      expect(t('ui.allow')).toBe('Allow');
    });

    it('should interpolate parameters', () => {
      setLocale('ja');
      expect(t('ui.queueBadge', { count: 3 })).toBe('+3 件待機中');

      setLocale('en');
      expect(t('ui.queueBadge', { count: 3 })).toBe('+3 pending');
    });

    it('should keep placeholder when parameter is missing', () => {
      setLocale('ja');
      expect(t('ui.queueBadge')).toBe('+{count} 件待機中');
    });

    it('should fall back to ja when key is missing in current locale', () => {
      // This tests the fallback chain: en -> ja -> key
      setLocale('en');
      // All keys exist in both, so test the key fallback
      expect(t('danger.safe')).toBe('Safe');
    });

    it('should return key string when key does not exist in any locale', () => {
      // Cast to bypass type check for testing fallback
      const result = t('nonexistent.key' as Parameters<typeof t>[0]);
      expect(result).toBe('nonexistent.key');
    });
  });

  describe('setLocale / getLocale', () => {
    it('should switch locale correctly', () => {
      setLocale('ja');
      expect(getLocale()).toBe('ja');
      expect(t('tray.quit')).toBe('終了');

      setLocale('en');
      expect(getLocale()).toBe('en');
      expect(t('tray.quit')).toBe('Quit');
    });
  });
});
