// Shared DOM helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape text for safe interpolation into HTML (content and attribute values). */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

export function readLocal(key, fallback = []) {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; }
}

export function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('Could not save — browser storage is full or blocked.', 'error'); return false; }
}

let toastTimer;
/** Non-blocking status message (replaces alert() for routine feedback). */
export function toast(message, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 4500 : 2200);
}

/** Copy text with a fallback for browsers/contexts where the async clipboard API is blocked. */
export async function copyText(text, message = 'Copied to clipboard') {
  if (!text) { toast('Nothing to copy.', 'error'); return false; }
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? message : 'Copy failed — select the text and press Ctrl+C.', ok ? 'ok' : 'error');
  return ok;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Only well-formed PNG/JPEG data URLs are ever placed in an <img src> (blocks attribute injection). */
export const safeImageSrc = src => (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(String(src || '')) ? src : '');

export const isTypingTarget = el => !!el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));
