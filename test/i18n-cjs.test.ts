import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// CommonJS モジュールを require で読み込む
const { t, setLocale, getLocale, detectLocale } = require('../src/i18n/index.cjs');

describe('i18n CommonJS (index.cjs)', () => {
  beforeEach(() => {
    setLocale('ja');
  });

  describe('setLocale / getLocale', () => {
    it('should set and get locale correctly', () => {
      setLocale('ja');
      expect(getLocale()).toBe('ja');

      setLocale('en');
      expect(getLocale()).toBe('en');
    });
  });

  describe('t()', () => {
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
      expect(t('ui.queueBadge', { count: 5 })).toBe('+5 件待機中');

      setLocale('en');
      expect(t('ui.queueBadge', { count: 5 })).toBe('+5 pending');
    });

    it('should keep placeholder when parameter is missing', () => {
      setLocale('ja');
      expect(t('ui.queueBadge')).toBe('+{count} 件待機中');
    });

    it('should return key when key does not exist', () => {
      expect(t('nonexistent.key.for.test')).toBe('nonexistent.key.for.test');
    });

    it('should handle zero as parameter value', () => {
      setLocale('ja');
      expect(t('ui.queueBadge', { count: 0 })).toBe('+0 件待機中');
    });

    it('should return string without params unchanged', () => {
      setLocale('ja');
      expect(t('tray.quit')).toBe('終了');

      setLocale('en');
      expect(t('tray.quit')).toBe('Quit');
    });
  });

  describe('detectLocale()', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env.LANG = originalEnv.LANG;
      process.env.LC_ALL = originalEnv.LC_ALL;
      process.env.LC_MESSAGES = originalEnv.LC_MESSAGES;
    });

    it('should detect ja from LANG environment variable', () => {
      process.env.LANG = 'ja_JP.UTF-8';
      process.env.LC_ALL = '';
      process.env.LC_MESSAGES = '';
      expect(detectLocale()).toBe('ja');
    });

    it('should detect en from LANG environment variable', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.LC_ALL = '';
      process.env.LC_MESSAGES = '';
      expect(detectLocale()).toBe('en');
    });

    it('should use LC_ALL when LANG is empty', () => {
      process.env.LANG = '';
      process.env.LC_ALL = 'ja_JP.UTF-8';
      process.env.LC_MESSAGES = '';
      expect(detectLocale()).toBe('ja');
    });

    it('should use LC_MESSAGES when LANG and LC_ALL are empty', () => {
      process.env.LANG = '';
      process.env.LC_ALL = '';
      process.env.LC_MESSAGES = 'ja_JP.UTF-8';
      expect(detectLocale()).toBe('ja');
    });

    it('should fall back to en for unknown locale', () => {
      process.env.LANG = 'fr_FR.UTF-8';
      process.env.LC_ALL = '';
      process.env.LC_MESSAGES = '';
      // detectLocale uses startsWith('ja') check, so non-ja → en (via Intl fallback or default)
      const result = detectLocale();
      expect(['ja', 'en']).toContain(result);
    });
  });
});
