import './style.css';
import { $, $$, esc } from './lib/dom.js';
import { PDF_HEADER_ACTIONS, PDF_PANEL, PDF_FOOTER, PDF_CHECK_MODAL, initPdfEditor } from './pdf/editor.js';
import { TEMPLATES_PANEL, COMPOSER_PANEL, EMAIL_MODALS, initEmailTools } from './email/ui.js';
import { WORKSPACE_PANELS, WORKSPACE_MODALS, initWorkspace } from './workspace.js';

const TABS = [
  ['home', 'Home', 'Dashboard'],
  ['pdf', 'PDF Editor', 'PDF Editor'],
  ['templates', 'Quick Replies', 'Quick Replies'],
  ['composer', 'Composer', 'Email Composer'],
  ['queue', 'Queue', 'Work Queue'],
  ['tasks', 'Tasks', 'Daily Tasks'],
  ['handover', 'Handover', 'Shift Handover'],
  ['links', 'Links', 'Quick Links'],
  ['notes', 'Notes', 'Quick Notes'],
];
const TAB_IDS = TABS.map(t => t[0]);

$('#app').innerHTML = `<header>
<b class="brand">Osama Automation Test</b><span class="sub">Radiology admin toolkit • local-only</span>
<nav class="appTabs" role="tablist" aria-label="Sections">${TABS.map(([id, label, title]) => `<button class="appTab" role="tab" data-app-tab="${id}" aria-selected="false" aria-controls="${id}Panel" title="${title}">${label}</button>`).join('')}</nav>
<div class="globalTools"><input id="globalSearch" type="search" placeholder="Search workspace…" aria-label="Search workspace"><button id="themeToggle" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button><button id="compactToggle" title="Toggle compact mode" aria-label="Toggle compact mode">↔</button></div>
${PDF_HEADER_ACTIONS}
</header>
${PDF_PANEL}
${WORKSPACE_PANELS}
${TEMPLATES_PANEL}
${COMPOSER_PANEL}
${PDF_FOOTER}
${PDF_CHECK_MODAL}
${EMAIL_MODALS}
${WORKSPACE_MODALS}`;

let activeTab = 'pdf';
let workspace, email, editor;

function setAppTab(name) {
  if (!TAB_IDS.includes(name)) name = 'pdf';
  activeTab = name;
  const isPdf = name === 'pdf';
  $('#pdfPanel').hidden = !isPdf;
  $('#pdfFooter').hidden = !isPdf;
  $('#pdfHeaderActions').hidden = !isPdf;
  TAB_IDS.filter(n => n !== 'pdf').forEach(n => { const el = $(`#${n}Panel`); if (el) el.hidden = n !== name; });
  $$('.appTab').forEach(b => { const on = b.dataset.appTab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  document.body.dataset.activeTab = name;
  try { sessionStorage.setItem('osama-active-tab', name); } catch { /* ignore */ }
  ({
    templates: () => email.renderTemplates(),
    composer: () => email.renderComposer(),
    tasks: () => workspace.renderTasks(),
    links: () => workspace.renderLinks(),
    queue: () => workspace.renderQueue(),
    handover: () => workspace.generateHandover(),
    home: () => workspace.renderDashboard(),
    pdf: () => editor.onShow(),
  })[name]?.();
}

email = initEmailTools({ onChange: () => { if (activeTab === 'home') workspace.renderDashboard(); }, goTo: setAppTab });
editor = initPdfEditor({ isActive: () => activeTab === 'pdf' });
workspace = initWorkspace({ email, setAppTab });

const tabBar = $('.appTabs');
tabBar.addEventListener('click', e => { const b = e.target.closest('[data-app-tab]'); if (b) setAppTab(b.dataset.appTab); });
tabBar.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const i = TAB_IDS.indexOf(activeTab);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? TAB_IDS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TAB_IDS.length) % TAB_IDS.length;
  setAppTab(TAB_IDS[next]);
  $(`.appTab[data-app-tab="${TAB_IDS[next]}"]`).focus();
  e.preventDefault();
});

// ---------- Modals ----------
// Close buttons close immediately. Accidental closes (backdrop click, Escape) ask first when
// something has been typed, so a half-written reply or a drawn signature is not lost.
const formState = modal => $$('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select', modal).map(el => el.value).join('\u0000');
let lastFocus = null;
new MutationObserver(muts => {
  for (const m of muts) {
    const modal = m.target;
    if (!modal.classList?.contains('modal')) continue;
    if (!modal.hidden) {
      lastFocus = document.activeElement;
      // Snapshot now (a microtask after the opener filled the fields synchronously), before
      // any typing can happen, so "has anything changed?" is always measured from the start.
      modal.dataset.initial = formState(modal);
      delete modal.dataset.dirty;
      setTimeout(() => { if (!modal.contains(document.activeElement)) modal.querySelector('input,select,textarea,button:not(.iconBtn)')?.focus(); }, 0);
    } else {
      delete modal.dataset.initial;
      if (lastFocus?.isConnected) lastFocus.focus();
    }
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
function requestClose(modal) {
  const changed = !modal.hasAttribute('data-no-dirty-check') && (modal.dataset.dirty === '1' || (modal.dataset.initial !== undefined && formState(modal) !== modal.dataset.initial));
  if (changed && !confirm('Discard what you have entered in this dialog?')) return;
  modal.hidden = true;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) $(`#${b.dataset.close}`).hidden = true; });
// Only a press AND release on the backdrop closes (a text selection ending outside does not).
$$('.modal').forEach(m => {
  let downOnBackdrop = false;
  m.addEventListener('mousedown', e => { downOnBackdrop = e.target === m; });
  m.addEventListener('click', e => { if (downOnBackdrop && e.target === m) requestClose(m); downOnBackdrop = false; });
});

// ---------- Quick find (Ctrl+K) ----------
document.body.insertAdjacentHTML('beforeend', `<div id="paletteModal" class="modal palette" hidden data-no-dirty-check role="dialog" aria-modal="true" aria-label="Quick find"><div class="modalCard"><input id="paletteInput" type="search" placeholder="Find a reply or a tool…" aria-label="Quick find" autocomplete="off" aria-controls="paletteResults"><div id="paletteResults" role="listbox" aria-label="Results"></div><p class="mini">↑↓ choose • <b>Enter</b> copy a reply (opens it if it has fields to fill in) • <b>Shift+Enter</b> open without copying • <b>Esc</b> close</p></div></div>`);
const palette = $('#paletteModal');
let paletteItems = [], paletteIndex = 0;
palette.addEventListener('mousedown', e => { if (e.target === palette) palette.hidden = true; });
function paletteSource() {
  const replies = email.store.list();
  const recent = email.store.recent().map(t => t.id);
  const rank = t => (recent.includes(t.id) ? 0 : t.favorite ? 1 : 2);
  return [
    ...[...replies].sort((a, b) => rank(a) - rank(b)).map(t => ({ kind: 'reply', id: t.id, label: t.name, sub: `${t.category}${t.favorite ? ' • ★' : ''}${recent.includes(t.id) ? ' • recent' : ''}`, hay: `${t.name} ${t.category} ${t.subject || ''} ${t.body}` })),
    ...TABS.map(([id, , title]) => ({ kind: 'tab', id, label: `Go to ${title}`, sub: 'Section', hay: `go ${title} ${id}` })),
    { kind: 'action', id: 'open-pdf', label: 'Open a PDF…', sub: 'PDF Editor', hay: 'open pdf file document' },
    { kind: 'action', id: 'new-reply', label: 'New reply…', sub: 'Quick Replies', hay: 'new reply template add create' },
    { kind: 'action', id: 'clear-patient', label: 'Clear patient details', sub: 'Quick Replies / Composer', hay: 'clear patient details reset' },
  ];
}
function renderPalette() {
  const words = $('#paletteInput').value.toLowerCase().split(/\s+/).filter(Boolean);
  paletteItems = paletteSource().filter(i => words.every(w => i.hay.toLowerCase().includes(w))).slice(0, 12);
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  $('#paletteResults').innerHTML = paletteItems.length
    ? paletteItems.map((i, n) => `<button type="button" role="option" class="paletteItem ${n === paletteIndex ? 'active' : ''}" aria-selected="${n === paletteIndex}" data-n="${n}"><span>${esc(i.label)}</span><small>${esc(i.sub)}</small></button>`).join('')
    : '<div class="mini">No matches.</div>';
}
function openPalette() {
  if ($$('.modal:not([hidden])').length) return;
  paletteIndex = 0;
  $('#paletteInput').value = '';
  renderPalette();
  palette.hidden = false;
  $('#paletteInput').focus(); // immediately, so typing straight after Ctrl+K is never lost
}
async function runPaletteItem(item, openOnly) {
  if (!item) return;
  palette.hidden = true;
  if (item.kind === 'tab') return setAppTab(item.id);
  if (item.kind === 'action') {
    if (item.id === 'open-pdf') { setAppTab('pdf'); $('#pdfInput').click(); }
    if (item.id === 'new-reply') { setAppTab('templates'); $('#addTemplate').click(); }
    if (item.id === 'clear-patient') email.clearPatient();
    return;
  }
  if (openOnly) { setAppTab('templates'); email.openReply(item.id); return; }
  await email.quickCopy(item.id);
}
$('#paletteInput').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
$('#paletteInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
    renderPalette();
    $('.paletteItem.active')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runPaletteItem(paletteItems[paletteIndex], e.shiftKey);
  }
});
$('#paletteResults').addEventListener('click', e => { const b = e.target.closest('.paletteItem'); if (b) runPaletteItem(paletteItems[+b.dataset.n], e.shiftKey); });

window.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!palette.hidden) palette.hidden = true; else openPalette(); return; }
  if (e.key === 'Escape') {
    const open = $$('.modal:not([hidden])').at(-1);
    if (open) { e.preventDefault(); requestClose(open); }
    return;
  }
  if ($$('.modal:not([hidden])').length) return;
  // Ctrl+Enter copies the message (Ctrl+Shift+Enter: subject + message), even from a field.
  if (mod && e.key === 'Enter' && (activeTab === 'templates' || activeTab === 'composer')) { e.preventDefault(); email.copyCurrent(activeTab, e.shiftKey); return; }
  // "/" focuses the reply search on the Quick Replies tab.
  if (e.key === '/' && activeTab === 'templates' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); email.focusSearch(); }
});

let initialTab = 'pdf';
try { initialTab = sessionStorage.getItem('osama-active-tab') || 'pdf'; } catch { /* ignore */ }
setAppTab(initialTab);
