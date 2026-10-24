// Small, dependency-free text and date helpers used by the email tools.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');

export const DATE_FORMATS = [
  { id: 'dd/mm/yyyy', label: '28/10/2026' },
  { id: 'd mmmm yyyy', label: '28 October 2026' },
  { id: 'dddd d mmmm yyyy', label: 'Wednesday 28 October 2026' },
  { id: 'dd-mm-yyyy', label: '28-10-2026' },
  { id: 'yyyy-mm-dd', label: '2026-10-28' },
];
export const TIME_FORMATS = [
  { id: '24h', label: '14:30' },
  { id: '12h', label: '2:30 pm' },
];

/** Local calendar date as YYYY-MM-DD (not UTC, so it is correct just after midnight in BST). */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Strictly parse YYYY-MM-DD into {y, m, d}; returns null for impossible dates such as 2026-02-30. */
export function parseISODate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d, weekday: dt.getDay() };
}

export function formatDate(iso, format = 'dd/mm/yyyy') {
  const p = parseISODate(iso);
  if (!p) return '';
  switch (format) {
    case 'd mmmm yyyy': return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
    case 'dddd d mmmm yyyy': return `${DAYS[p.weekday]} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
    case 'dd-mm-yyyy': return `${pad(p.d)}-${pad(p.m)}-${p.y}`;
    case 'yyyy-mm-dd': return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    default: return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  }
}

/** "HH:MM" (24h, as produced by <input type=time>) -> formatted string, or '' if invalid. */
export function formatTime(value, format = '24h') {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!m) return '';
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return '';
  if (format === '12h') return `${h % 12 || 12}:${pad(min)} ${h < 12 ? 'am' : 'pm'}`;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * Re-format dates found in free text. Recognises YYYY-MM-DD and UK-style D/M/YYYY or D-M-YYYY.
 * Anything that is not a real calendar date is left untouched.
 */
export function reformatDates(text, format) {
  return String(text)
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (all, y, m, d) => formatDate(`${y}-${pad(m)}-${pad(d)}`, format) || all)
    .replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, (all, d, m, y) => formatDate(`${y}-${pad(m)}-${pad(d)}`, format) || all);
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);
/** Title Case that keeps acronyms (MRI, CT, PET-CT) and small joining words intact. */
export function titleCase(text) {
  return String(text).replace(/[^\s]+/g, (word, offset, whole) => {
    if (/^[A-Z0-9-]{2,}$/.test(word) && /[A-Z]/.test(word)) return word;
    const lower = word.toLowerCase();
    const atLineStart = offset === 0 || /\n\s*$/.test(whole.slice(0, offset));
    if (!atLineStart && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/(^|[-'’(])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
  });
}

export const normalizeLineBreaks = text => String(text).replace(/\r\n?/g, '\n');

/** Trim each line, collapse runs of spaces, and allow at most one blank line in a row. */
export function trimWhitespace(text) {
  return normalizeLineBreaks(text)
    .split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Remove invisible characters that often sneak in from copied web pages and documents. */
export function cleanText(text) {
  return trimWhitespace(String(text).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\u00a0/g, ' '));
}

export const GREETINGS = ['Dear {patient_name},', 'Hello,', 'Good morning,', 'Good afternoon,', 'Dear colleague,', 'Dear Team,'];
export const SIGN_OFFS = ['Kind regards,\nRadiology Administration', 'Many thanks.', 'Many thanks,\n{sender_name}', 'Kind regards,\n{sender_name}\n{department}'];
