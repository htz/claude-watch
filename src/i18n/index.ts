import enMessages from './en.json';
import jaMessages from './ja.json';

export type TranslationKey = keyof typeof jaMessages;
export type Locale = 'ja' | 'en';

const messages: Record<Locale, Record<string, string>> = { ja: jaMessages, en: enMessages };
let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const msg = messages[currentLocale]?.[key] ?? messages.ja[key] ?? key;
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
