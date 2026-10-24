import { describe, it, expect } from 'vitest';
import { formatDate, formatTime, parseISODate, todayISO, titleCase, trimWhitespace, cleanText, reformatDates, normalizeLineBreaks } from '../../src/lib/textUtils.js';

describe('dates and times', () => {
  it('formats dates in each supported format', () => {
    expect(formatDate('2026-10-28')).toBe('28/10/2026');
    expect(formatDate('2026-10-28', 'd mmmm yyyy')).toBe('28 October 2026');
    expect(formatDate('2026-10-28', 'dddd d mmmm yyyy')).toBe('Wednesday 28 October 2026');
    expect(formatDate('2026-10-28', 'yyyy-mm-dd')).toBe('2026-10-28');
    expect(formatDate('2026-10-28', 'dd-mm-yyyy')).toBe('28-10-2026');
  });
  it('rejects impossible dates rather than shifting them', () => {
    expect(parseISODate('2026-02-30')).toBeNull();
    expect(formatDate('2026-13-01')).toBe('');
    expect(formatDate('')).toBe('');
  });
  it('formats times', () => {
    expect(formatTime('10:30')).toBe('10:30');
    expect(formatTime('09:05', '12h')).toBe('9:05 am');
    expect(formatTime('00:15', '12h')).toBe('12:15 am');
    expect(formatTime('14:30', '12h')).toBe('2:30 pm');
    expect(formatTime('25:00')).toBe('');
  });
  it('uses the local calendar date for "today"', () => {
    expect(todayISO(new Date(2026, 9, 25, 0, 30))).toBe('2026-10-25');
  });
  it('reformats dates in free text and leaves invalid ones alone', () => {
    expect(reformatDates('Seen 2026-10-28 and 3/11/2026, not 31/02/2026', 'd mmmm yyyy')).toBe('Seen 28 October 2026 and 3 November 2026, not 31/02/2026');
  });
});

describe('text utilities', () => {
  it('title-cases while keeping acronyms', () => {
    expect(titleCase('MRI of the knee and PET-CT review')).toBe('MRI of the Knee and PET-CT Review');
    expect(titleCase("o'brien follow-up")).toBe("O'Brien Follow-Up");
    expect(titleCase('appointment for the patient')).toBe('Appointment for the Patient');
  });
  it('trims whitespace and collapses blank lines', () => {
    expect(trimWhitespace('  Hello   there \r\n\n\n\n  Kind  regards  ')).toBe('Hello there\n\nKind regards');
  });
  it('removes invisible characters from pasted text', () => {
    expect(cleanText('Dear​ Team, hello﻿')).toBe('Dear Team, hello');
  });
  it('normalises line breaks', () => {
    expect(normalizeLineBreaks('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
