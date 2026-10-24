import { describe, it, expect } from 'vitest';
import { renderTemplate, renderMessage, extractVariables, firstNameOf, splitTokens } from '../../src/email/templateEngine.js';

// Fictional values only.
const values = { patient_name: 'John Smith', scan_type: 'MRI', date: '28/10/2026', time: '10:30' };

describe('template variable engine', () => {
  it('produces the documented example exactly', () => {
    const tpl = 'Dear {patient_name},\nYour {scan_type} appointment is scheduled for {date} at {time}.\nPlease contact us if you require any assistance.\nKind regards,\nRadiology Administration';
    expect(renderTemplate(tpl, values).text).toBe('Dear John Smith,\nYour MRI appointment is scheduled for 28/10/2026 at 10:30.\nPlease contact us if you require any assistance.\nKind regards,\nRadiology Administration');
  });

  it.each([
    ['{patient_name}', 'John Smith'],
    ['{date}', '28/10/2026'],
    ['{time}', '10:30'],
    ['{scan_type}', 'MRI'],
    ['{Date}', '28/10/2026'],
    ['{DATE}', '28/10/2026'],
    ['{{patient_name}}', 'John Smith'],
    ['{{ scan }}', 'MRI'],
    ['{appointment_date} {appointment_time}', '28/10/2026 10:30'],
  ])('replaces %s', (tpl, out) => {
    expect(renderTemplate(tpl, values).text).toBe(out);
  });

  it('replaces every occurrence of a variable', () => {
    const r = renderTemplate('{patient_name} / {patient_name} / {Date} and {date}', values);
    expect(r.text).toBe('John Smith / John Smith / 28/10/2026 and 28/10/2026');
    expect(r.used.sort()).toEqual(['date', 'patient_name']);
  });

  it('keeps placeholders visible and reports missing values instead of blanking them', () => {
    const r = renderTemplate('Dear {patient_name}, see you on {date}.', { patient_name: '  ' });
    expect(r.text).toBe('Dear {patient_name}, see you on {date}.');
    expect(r.missing).toEqual(['patient_name', 'date']);
  });

  it('leaves unknown variables and non-variable braces untouched', () => {
    const r = renderTemplate('Ref {patiant_name} {1} { see attached } {} {{}} json {"a":1}', values);
    expect(r.text).toBe('Ref {patiant_name} {1} { see attached } {} {{}} json {"a":1}');
    expect(r.unknown).toEqual(['patiant_name']);
  });

  it('inserts values literally (no regex replacement patterns, no HTML interpretation)', () => {
    const r = renderTemplate('Name: {patient_name}', { patient_name: '$& <b>O\'Brien</b> $1' });
    expect(r.text).toBe('Name: $& <b>O\'Brien</b> $1');
  });

  it('does not re-expand placeholders that appear inside values', () => {
    expect(renderTemplate('{patient_name} {date}', { patient_name: '{date}', date: 'X' }).text).toBe('{date} X');
  });

  it('derives the first name from the full name, skipping titles', () => {
    expect(firstNameOf('Mrs Jane Example')).toBe('Jane');
    expect(firstNameOf('Dr. Test Person')).toBe('Test');
    expect(firstNameOf('Mr')).toBe('');
    expect(renderTemplate('Hi {patient_first_name}', { patient_name: 'Mr John Smith' }).text).toBe('Hi John');
    expect(renderTemplate('Hi {patient_first_name}', { patient_name: 'John Smith', patient_first_name: 'Johnny' }).text).toBe('Hi Johnny');
  });

  it('renders subject and body together', () => {
    const r = renderMessage({ subject: '{scan_type} - {Date}', body: 'Dear {patient_name}' }, { scan_type: 'CT', date: '01/11/2026' });
    expect(r.subject).toBe('CT - 01/11/2026');
    expect(r.missing).toEqual(['patient_name']);
  });

  it('extracts variables with aliases folded together', () => {
    const v = extractVariables('{Date} {date} {{scan}}', '{scan_type} {mystery}');
    expect(v.map(x => [x.key, x.known])).toEqual([['date', true], ['scan_type', true], ['mystery', false]]);
  });

  it('splits text into safe segments for highlighting', () => {
    expect(splitTokens('a {date} b {x}').map(p => p.text)).toEqual(['a ', '{date}', ' b ', '{x}']);
  });
});
