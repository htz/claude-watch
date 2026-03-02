'use strict';

const jaMessages = require('./ja.json');
const enMessages = require('./en.json');
const messages = { ja: jaMessages, en: enMessages };

function detectLocale() {
  const lang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  if (lang.startsWith('ja')) return 'ja';
  try {
    if (Intl.DateTimeFormat().resolvedOptions().locale.startsWith('ja')) return 'ja';
  } catch {
    // ignore
  }
  return 'en';
}

let currentLocale = detectLocale();

function setLocale(l) {
  currentLocale = l;
}

function getLocale() {
  return currentLocale;
}

function t(key, params) {
  const msg = messages[currentLocale]?.[key] || messages.ja[key] || key;
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (_, name) => String(params[name] != null ? params[name] : `{${name}}`));
}

module.exports = { t, setLocale, getLocale, detectLocale };
