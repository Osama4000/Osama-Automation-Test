// Pure geometry + text-layout helpers shared by the editor preview and the PDF export.
//
// Coordinate model ("view points"): every editor object stores x/y/w/h in PDF points,
// measured from the top-left corner of the page *as displayed* (after /Rotate and CropBox
// are applied). The screen shows view points multiplied by the current zoom scale, and the
// export maps view points back into PDF user space with the inverse of the page viewport
// transform. Because objects never store CSS pixels, zoom and scroll cannot corrupt them.
import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

export const FONT_FAMILIES = {
  helvetica: {
    label: 'Sans (Helvetica / Arial)',
    css: "Arial, Helvetica, 'Liberation Sans', 'Nimbus Sans', sans-serif",
    std: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  },
  times: {
    label: 'Serif (Times)',
    css: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif",
    std: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  },
  courier: {
    label: 'Monospace (Courier)',
    css: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace",
    std: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  },
};

export const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 24];
export const DEFAULT_TEXT_SIZE = 10;
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 96;
export const LINE_HEIGHTS = [1, 1.15, 1.2, 1.5, 2];
export const DEFAULT_LINE_HEIGHT = 1.2;

// Fallback vertical metrics (ascent/descent as a fraction of the em) for the CSS fonts above,
// used when the browser cannot report real metrics (e.g. in unit tests).
const FALLBACK_METRICS = { helvetica: [0.905, 0.212], times: [0.891, 0.216], courier: [0.833, 0.3] };

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const roundTo = (v, step = 0.1) => Math.round(v / step) * step;

export function normalizeFamily(name) {
  const n = String(name || '').toLowerCase();
  if (FONT_FAMILIES[n]) return n;
  if (/courier|mono/.test(n)) return 'courier';
  if (/times|serif|roman|georgia|garamond|cambria/.test(n) && !/sans/.test(n)) return 'times';
  return 'helvetica';
}

export function standardFontName(family, bold, italic) {
  return FONT_FAMILIES[normalizeFamily(family)].std[(bold ? 1 : 0) + (italic ? 2 : 0)];
}

const embedderCache = new Map();
function embedder(fontName) {
  if (!embedderCache.has(fontName)) embedderCache.set(fontName, StandardFontEmbedder.for(fontName));
  return embedderCache.get(fontName);
}

/** Width in points of `text` in the given standard font. Uses the same AFM metrics as the export. */
export function measureText(text, { family, bold, italic, size }) {
  return embedder(standardFontName(family, bold, italic)).widthOfTextAtSize(text, size);
}

/**
 * Standard PDF fonts only cover WinAnsi. Replace anything else with the closest safe character
 * (accents stripped, otherwise "?") so the export never crashes, and report what changed.
 */
export function sanitizeForPdf(text) {
  const enc = embedder(StandardFonts.Helvetica).encoding;
  const replaced = new Set();
  let out = '';
  for (const ch of String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    if (ch === '\n' || enc.canEncodeUnicodeCodePoint(ch.codePointAt(0))) { out += ch; continue; }
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mapped = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ø': 'O', 'ø': 'o', 'ı': 'i', '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ' }[ch];
    const sub = mapped ?? ([...base].every(c => enc.canEncodeUnicodeCodePoint(c.codePointAt(0))) && base ? base : '?');
    replaced.add(ch);
    out += sub;
  }
  return { text: out, replaced: [...replaced] };
}

let metricsProbe = null;
const metricsCache = new Map();
/**
 * Ascent/descent ratios of the CSS font the browser actually uses for the preview, so the
 * exported baseline lands exactly where the on-screen baseline is.
 */
export function fontMetrics(family, bold = false) {
  const fam = normalizeFamily(family);
  const key = fam + (bold ? 'b' : '');
  if (metricsCache.has(key)) return metricsCache.get(key);
  let result = FALLBACK_METRICS[fam];
  try {
    if (typeof document !== 'undefined') {
      metricsProbe ??= document.createElement('canvas').getContext('2d');
      metricsProbe.font = `${bold ? 'bold ' : ''}100px ${FONT_FAMILIES[fam].css}`;
      const m = metricsProbe.measureText('Hg');
      if (m.fontBoundingBoxAscent > 0 && m.fontBoundingBoxDescent > 0) result = [m.fontBoundingBoxAscent / 100, m.fontBoundingBoxDescent / 100];
    }
  } catch { /* use fallback metrics */ }
  metricsCache.set(key, result);
  return result;
}

/**
 * Lay out a text object. Both the editor and the export call this, so effective font size,
 * line positions and alignment are identical in preview and output.
 * Returns positions relative to the object's top-left corner, in points.
 */
export function layoutText(o, metrics = fontMetrics(o.fontFamily, o.bold)) {
  const { text } = sanitizeForPdf(o.text || '');
  const lines = text.split('\n');
  const style = { family: o.fontFamily, bold: !!o.bold, italic: !!o.italic };
  const requested = clamp(Number(o.fontSize) || DEFAULT_TEXT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const lh = Number(o.lineHeight) || DEFAULT_LINE_HEIGHT;
  const widthsAt = size => lines.map(l => measureText(l, { ...style, size }));
  let fontSize = requested;
  let widths = widthsAt(fontSize);
  const maxW = Math.max(0, ...widths);
  if (o.fitToBox && o.w > 2 && maxW > o.w - 1) {
    fontSize = Math.max(MIN_FONT_SIZE, requested * (o.w - 1) / maxW);
    widths = widthsAt(fontSize);
  }
  const [asc, desc] = metrics;
  const lineGap = lh * fontSize;
  const baseline = (lineGap - (asc + desc) * fontSize) / 2 + asc * fontSize;
  const contentWidth = Math.max(0, ...widths);
  // Fit-to-box keeps the width and shrinks the text; otherwise the box always grows to fit the
  // text, so nothing is ever clipped on screen while still being drawn in the export.
  const natural = contentWidth + 2;
  const boxW = o.fitToBox ? o.w : o.fixedWidth ? Math.max(o.w, natural) : Math.max(o.minW || 0, natural);
  const align = o.align || 'left';
  return {
    fontSize,
    lineGap,
    contentWidth,
    width: boxW,
    height: Math.max(o.minH || 0, lines.length * lineGap),
    lines: lines.map((t, i) => ({
      text: t,
      width: widths[i],
      dx: align === 'center' ? (boxW - widths[i]) / 2 : align === 'right' ? boxW - widths[i] - 1 : 0,
      baseline: baseline + i * lineGap,
    })),
  };
}

/**
 * The pdf.js PageViewport transform at scale 1 (view points -> canvas), reimplemented so the
 * export can map view points to PDF user space without depending on a rendered page.
 * `view` is the page box [x1, y1, x2, y2]; `rotate` is the page /Rotate in degrees.
 */
export function viewportTransform(view, rotate = 0) {
  const [x1, y1, x2, y2] = view;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const r = ((rotate % 360) + 360) % 360;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[r] ?? [1, 0, 0, -1];
  let ox, oy, width, height;
  if (a === 0) { ox = Math.abs(cy - y1); oy = Math.abs(cx - x1); width = Math.abs(y2 - y1); height = Math.abs(x2 - x1); }
  else { ox = Math.abs(cx - x1); oy = Math.abs(cy - y1); width = Math.abs(x2 - x1); height = Math.abs(y2 - y1); }
  return { matrix: [a, b, c, d, ox - a * cx - c * cy, oy - b * cx - d * cy], width, height, rotate: r };
}

export function invertMatrix([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const applyMatrix = ([a, b, c, d, e, f], x, y) => ({ x: a * x + c * y + e, y: b * x + d * y + f });

/** Helper bound to one page: converts view points into PDF user-space points. */
export function pageMapper(view, rotate) {
  const vt = viewportTransform(view, rotate);
  const inv = invertMatrix(vt.matrix);
  return { toPdf: (x, y) => applyMatrix(inv, x, y), rotate: vt.rotate, width: vt.width, height: vt.height };
}

/** Keep an object fully on the page where possible. */
export function clampToPage(o, pageW, pageH) {
  return {
    x: clamp(o.x, Math.min(0, pageW - o.w), Math.max(0, pageW - o.w)),
    y: clamp(o.y, Math.min(0, pageH - o.h), Math.max(0, pageH - o.h)),
  };
}

/** "1-3, 5" -> [1, 2, 3, 5]. Throws on invalid input. */
export function parsePageRanges(input, maxPage) {
  const pages = new Set();
  for (const part of String(input).split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) throw new Error(`"${part}" is not a page number or range.`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a < 1 || b < a || b > maxPage) throw new Error(`Pages must be between 1 and ${maxPage}.`);
    for (let p = a; p <= b; p++) pages.add(p);
  }
  if (!pages.size) throw new Error('Enter at least one page.');
  return [...pages].sort((x, y) => x - y);
}

export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Resize a box from a corner handle. Anchor = the opposite corner, which stays fixed. */
export function resizeFromHandle(orig, handle, pt, { aspect = null, minSize = 6 } = {}) {
  const right = handle.includes('e'), bottom = handle.includes('s');
  const ax = right ? orig.x : orig.x + orig.w;
  const ay = bottom ? orig.y : orig.y + orig.h;
  let w = Math.max(minSize, right ? pt.x - ax : ax - pt.x);
  let h = Math.max(minSize, bottom ? pt.y - ay : ay - pt.y);
  if (aspect) {
    const s = Math.max(w / orig.w, h / orig.h);
    w = Math.max(minSize, orig.w * s);
    h = w / aspect;
  }
  return { x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h };
}
