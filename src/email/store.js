// Persistence for quick replies / email templates.
//
// - Custom templates live under the key used since V8, so existing user templates keep working.
// - Built-in templates are defined in code; edits/favourites are stored as small overrides keyed
//   by the built-in id, so app updates can add or improve built-ins without losing user changes.
// - Only template text and usage metadata (ids, counts) is stored. Values typed into the
//   variable fields (patient names, dates...) are never written by this module.
import { BUILTIN_TEMPLATES } from './builtins.js';

export const TEMPLATE_KEY = 'osama-automation-email-templates-v1';
export const OVERRIDES_KEY = 'osama-automation-builtin-overrides-v1';
export const META_KEY = 'osama-automation-reply-meta-v1';
const MAX_RECENT = 8;

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

export function createTemplateStore(storage = globalThis.localStorage ?? memoryStorage(), now = () => Date.now()) {
  const read = (key, fallback) => {
    try { const v = JSON.parse(storage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => storage.setItem(key, JSON.stringify(value));
  const custom = () => (Array.isArray(read(TEMPLATE_KEY, [])) ? read(TEMPLATE_KEY, []) : []);
  const overrides = () => read(OVERRIDES_KEY, {});
  const meta = () => ({ recent: [], uses: {}, ...read(META_KEY, {}) });

  function list() {
    const ov = overrides();
    const builtins = BUILTIN_TEMPLATES.map(b => {
      const o = ov[b.id] || {};
      const edited = ['name', 'category', 'subject', 'body'].some(k => o[k] !== undefined && o[k] !== b[k]);
      return { ...b, ...pick(o, ['name', 'category', 'subject', 'body']), favorite: !!o.favorite, builtin: true, edited, original: b };
    });
    const mine = custom().map(t => ({ subject: '', category: 'General Administration', ...t, favorite: !!t.favorite, builtin: false }));
    return [...builtins, ...mine];
  }

  const get = id => list().find(t => t.id === id) || null;

  function save(t) {
    const name = String(t.name || '').trim(), body = String(t.body ?? '').replace(/\r\n?/g, '\n');
    if (!name) throw new Error('Please add a template name.');
    if (!body.trim()) throw new Error('Please add the message text.');
    const data = { name, body, subject: String(t.subject || '').trim(), category: String(t.category || '').trim() || 'General Administration' };
    if (t.id && String(t.id).startsWith('builtin:')) {
      const ov = overrides();
      ov[t.id] = { ...ov[t.id], ...data };
      write(OVERRIDES_KEY, ov);
      return t.id;
    }
    const items = custom();
    const existing = t.id && items.find(x => x.id === t.id);
    if (existing) Object.assign(existing, data, { updatedAt: now() });
    else items.unshift({ id: newId(), ...data, favorite: false, createdAt: now(), updatedAt: now() });
    write(TEMPLATE_KEY, items);
    return existing ? existing.id : items[0].id;
  }

  function toggleFavorite(id) {
    if (id.startsWith('builtin:')) {
      const ov = overrides();
      ov[id] = { ...ov[id], favorite: !ov[id]?.favorite };
      write(OVERRIDES_KEY, ov);
      return ov[id].favorite;
    }
    const items = custom(), t = items.find(x => x.id === id);
    if (!t) return false;
    t.favorite = !t.favorite;
    write(TEMPLATE_KEY, items);
    return t.favorite;
  }

  function duplicate(id) {
    const t = get(id);
    if (!t) return null;
    const items = custom();
    const copy = { id: newId(), name: `${t.name} (Copy)`, category: t.category, subject: t.subject || '', body: t.body, favorite: false, createdAt: now(), updatedAt: now() };
    items.unshift(copy);
    write(TEMPLATE_KEY, items);
    return copy.id;
  }

  function remove(id) {
    if (id.startsWith('builtin:')) throw new Error('Built-in replies cannot be deleted. Use "Reset" to restore the original text.');
    write(TEMPLATE_KEY, custom().filter(x => x.id !== id));
    const m = meta();
    m.recent = m.recent.filter(x => x !== id);
    delete m.uses[id];
    write(META_KEY, m);
  }

  /** Restore one built-in's original text (keeps the favourite flag). */
  function resetBuiltin(id) {
    const ov = overrides();
    if (!ov[id]) return;
    ov[id] = ov[id].favorite ? { favorite: true } : undefined;
    if (!ov[id]) delete ov[id];
    write(OVERRIDES_KEY, ov);
  }

  /** Restore every built-in to its shipped text. Custom templates are not touched. */
  function resetAllBuiltins() {
    const ov = overrides();
    const kept = {};
    for (const [id, o] of Object.entries(ov)) if (o?.favorite) kept[id] = { favorite: true };
    write(OVERRIDES_KEY, kept);
  }

  function recordUse(id) {
    const m = meta();
    m.recent = [id, ...m.recent.filter(x => x !== id)].slice(0, MAX_RECENT);
    m.uses[id] = (m.uses[id] || 0) + 1;
    write(META_KEY, m);
  }

  const recent = () => {
    const all = list();
    return meta().recent.map(id => all.find(t => t.id === id)).filter(Boolean);
  };

  return { list, get, save, toggleFavorite, duplicate, remove, resetBuiltin, resetAllBuiltins, recordUse, recent, uses: () => meta().uses };
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Simple case-insensitive search across name, category, subject and body (all words must match). */
export function searchTemplates(items, query, { category = '', favoritesOnly = false } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(t => {
    if (category && t.category !== category) return false;
    if (favoritesOnly && !t.favorite) return false;
    const hay = `${t.name} ${t.category} ${t.subject || ''} ${t.body}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
