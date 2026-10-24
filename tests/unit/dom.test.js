import { describe, it, expect } from 'vitest';
import { safeImageSrc, esc } from '../../src/lib/dom.js';

describe('safe HTML helpers', () => {
  it('only allows well-formed PNG/JPEG data URLs as image sources', () => {
    expect(safeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeImageSrc('data:image/jpeg;base64,/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(safeImageSrc('data:image/png;base64,AA" onerror="alert(1)')).toBe('');
    expect(safeImageSrc('javascript:alert(1)')).toBe('');
    expect(safeImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
    expect(safeImageSrc(undefined)).toBe('');
  });
  it('escapes HTML special characters', () => {
    expect(esc('<a href="x">O\'Brien & co</a>')).toBe('&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; co&lt;/a&gt;');
  });
});
