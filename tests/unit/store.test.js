import { describe, it, expect, beforeEach } from 'vitest';
import { createTemplateStore, searchTemplates, TEMPLATE_KEY } from '../../src/email/store.js';
import { BUILTIN_TEMPLATES } from '../../src/email/builtins.js';

const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };

describe('quick reply store', () => {
  let storage, store;
  beforeEach(() => { storage = memory(); store = createTemplateStore(storage); });

  it('ships the four required replies verbatim', () => {
    const byName = Object.fromEntries(store.list().map(t => [t.name, t.body]));
    expect(byName['Fortius Escalation']).toBe('It has been raised to Fortius and they will contact the patient as soon as possible.');
    expect(byName['Queen Square Escalation']).toBe('It has been raised to Queen Square and they will contact the patient as soon as possible.');
    expect(byName['Patient Contact and Booking']).toBe('I will contact the patient and will book him accordingly.');
    expect(byName['Clinic List Request']).toBe('Find the clinic list for {Date}');
  });

  it('saves, edits, searches and deletes a custom reply', () => {
    const id = store.save({ name: 'Transport reminder', category: 'Appointments', body: 'Dear {patient_name}, please arrive 15 minutes early.' });
    expect(store.get(id).builtin).toBe(false);
    store.save({ id, name: 'Transport reminder', category: 'Appointments', body: 'Dear {patient_name}, please arrive 20 minutes early.' });
    expect(store.get(id).body).toContain('20 minutes');
    expect(searchTemplates(store.list(), 'arrive 20').map(t => t.id)).toEqual([id]);
    expect(searchTemplates(store.list(), 'TRANSPORT reminder')[0].id).toBe(id);
    store.remove(id);
    expect(store.get(id)).toBeNull();
  });

  it('keeps legacy templates saved by earlier versions', () => {
    storage.setItem(TEMPLATE_KEY, JSON.stringify([{ id: 'old1', name: 'Old', category: 'Booking', body: 'Hi {{patient_name}}', favorite: true }]));
    const t = createTemplateStore(storage).get('old1');
    expect(t).toMatchObject({ name: 'Old', body: 'Hi {{patient_name}}', favorite: true, builtin: false });
  });

  it('stores built-in edits as overrides and can reset them', () => {
    const id = 'builtin:fortius-escalation';
    store.save({ id, name: 'Fortius Escalation', category: 'Fortius', body: 'Edited wording.' });
    expect(store.get(id)).toMatchObject({ body: 'Edited wording.', edited: true });
    store.toggleFavorite(id);
    store.resetBuiltin(id);
    expect(store.get(id)).toMatchObject({ body: BUILTIN_TEMPLATES[0].body, edited: false, favorite: true });
    store.save({ id: 'builtin:queen-square-escalation', name: 'QS', category: 'Queen Square', body: 'x' });
    store.resetAllBuiltins();
    expect(store.list().filter(t => t.builtin && t.edited)).toEqual([]);
  });

  it('refuses to delete built-ins and validates input', () => {
    expect(() => store.remove('builtin:fortius-escalation')).toThrow();
    expect(() => store.save({ name: '', body: 'x' })).toThrow();
    expect(() => store.save({ name: 'x', body: '   ' })).toThrow();
  });

  it('duplicates, favourites and tracks recently used replies', () => {
    const copy = store.duplicate('builtin:report-available');
    expect(store.get(copy)).toMatchObject({ name: 'Report Available (Copy)', builtin: false });
    store.recordUse('builtin:report-available');
    store.recordUse(copy);
    store.recordUse('builtin:report-available');
    expect(store.recent().map(t => t.id)).toEqual(['builtin:report-available', copy]);
    expect(store.toggleFavorite(copy)).toBe(true);
    expect(searchTemplates(store.list(), '', { favoritesOnly: true }).map(t => t.id)).toEqual([copy]);
  });

  it('never persists variable values (only template text and ids)', () => {
    store.recordUse('builtin:referral-follow-up');
    const dump = [...storage._m.values()].join(' ');
    expect(dump).not.toMatch(/John|Smith/);
  });
});
