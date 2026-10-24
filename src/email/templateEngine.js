// Centralised template variable engine.
//
// Syntax: {variable} or the legacy {{variable}} used by earlier versions of this app.
// Names are matched case-insensitively ({Date} == {date}) and a few aliases are supported.
// Only tokens that look like identifiers are treated as variables, so ordinary text in braces
// such as "{ see attached }" or "{1}" is never touched. Missing values are NEVER replaced
// with an empty string: the placeholder is left visible and reported, so nothing is
// silently dropped from a message.

export const VARIABLES = [
  { key: 'patient_name', label: 'Patient name', kind: 'text', patient: true },
  { key: 'patient_first_name', label: 'Patient first name', kind: 'text', patient: true, derivedFrom: 'patient_name' },
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'time', label: 'Time', kind: 'time' },
  { key: 'scan_type', label: 'Scan type', kind: 'scan' },
  { key: 'location', label: 'Location', kind: 'text' },
  { key: 'clinic_name', label: 'Clinic name', kind: 'text' },
  { key: 'consultant_name', label: 'Consultant', kind: 'text' },
  { key: 'reference_number', label: 'Reference number', kind: 'text', patient: true },
  { key: 'contact_number', label: 'Contact number', kind: 'text', profile: true },
  { key: 'department', label: 'Department', kind: 'text', profile: true },
  { key: 'sender_name', label: 'Your name', kind: 'text', profile: true },
];

export const ALIASES = {
  appointment_date: 'date',
  appointment_time: 'time',
  scan: 'scan_type',
  scantype: 'scan_type',
  modality: 'scan_type',
  first_name: 'patient_first_name',
  consultant: 'consultant_name',
  clinic: 'clinic_name',
  reference: 'reference_number',
  ref: 'reference_number',
};

const KNOWN = new Map(VARIABLES.map(v => [v.key, v]));
export const variableDef = key => KNOWN.get(key);

// {{ name }} (legacy) or {name}. Group 1 = legacy name, group 2 = single-brace name.
const TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}|\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function canonicalKey(name) {
  const lower = String(name).toLowerCase();
  const key = ALIASES[lower] || lower;
  return { key, known: KNOWN.has(key) };
}

/** Variables used in one or more template strings, in order of first appearance. */
export function extractVariables(...texts) {
  const seen = new Map();
  for (const text of texts) {
    for (const m of String(text ?? '').matchAll(TOKEN_RE)) {
      const name = m[1] ?? m[2];
      const { key, known } = canonicalKey(name);
      if (!seen.has(key)) seen.set(key, { key, known, tokens: new Set() });
      seen.get(key).tokens.add(m[0]);
    }
  }
  return [...seen.values()].map(v => ({ ...v, tokens: [...v.tokens] }));
}

const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|sir|dame|rev)\.?$/i;
/** "Mrs Jane Smith" -> "Jane". Returns '' if nothing sensible can be derived. */
export function firstNameOf(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && TITLES.test(parts[0])) parts.shift();
  return parts.length && !TITLES.test(parts[0]) ? parts[0].replace(/,$/, '') : '';
}

/** Fill derived values (currently first name from the full name) without overriding user input. */
export function withDerived(values) {
  const out = { ...values };
  if (!String(out.patient_first_name ?? '').trim()) {
    const first = firstNameOf(out.patient_name);
    if (first) out.patient_first_name = first;
  }
  return out;
}

/**
 * Render a template string.
 * @returns {{ text: string, missing: string[], unknown: string[], used: string[] }}
 */
export function renderTemplate(text, values = {}) {
  const vals = withDerived(values);
  const missing = new Set(), unknown = new Set(), used = new Set();
  const out = String(text ?? '').replace(TOKEN_RE, (token, legacy, single) => {
    const name = legacy ?? single;
    const { key, known } = canonicalKey(name);
    if (!known) { unknown.add(name); return token; }
    used.add(key);
    const v = vals[key];
    if (v === undefined || v === null || String(v).trim() === '') { missing.add(key); return token; }
    return String(v);
  });
  return { text: out, missing: [...missing], unknown: [...unknown], used: [...used] };
}

/** Render subject + body together, merging the diagnostics. */
export function renderMessage({ subject = '', body = '' }, values = {}) {
  const s = renderTemplate(subject, values), b = renderTemplate(body, values);
  const uniq = a => [...new Set(a)];
  return {
    subject: s.text,
    body: b.text,
    missing: uniq([...s.missing, ...b.missing]),
    unknown: uniq([...s.unknown, ...b.unknown]),
    used: uniq([...s.used, ...b.used]),
  };
}

/** Split text into plain segments and placeholder tokens (used to highlight unfilled fields). */
export function splitTokens(text) {
  const out = [];
  let last = 0;
  for (const m of String(text ?? '').matchAll(TOKEN_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), token: false });
    out.push({ text: m[0], token: true, ...canonicalKey(m[1] ?? m[2]) });
    last = m.index + m[0].length;
  }
  if (last < String(text ?? '').length) out.push({ text: String(text).slice(last), token: false });
  return out;
}

export const labelFor = key => KNOWN.get(key)?.label ?? key.replace(/_/g, ' ');
export const placeholderFor = key => `{${key}}`;
