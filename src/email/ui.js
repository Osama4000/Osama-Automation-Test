// Quick Replies, Email Composer and Clinic List assistant.
//
// Privacy: values typed into variable fields (patient name, dates, references...) live only in
// memory for this tab. They are never written to storage or placed in URLs. Only template text,
// favourites/recent ids, formatting preferences and (if the user opts in) their own sign-off
// details are stored locally.
import { $, $$, esc, toast, copyText, readLocal, writeLocal } from '../lib/dom.js';
import { VARIABLES, variableDef, extractVariables, renderMessage, splitTokens, labelFor, placeholderFor, firstNameOf } from './templateEngine.js';
import { createTemplateStore, searchTemplates } from './store.js';
import { CATEGORIES } from './builtins.js';
import {
  DATE_FORMATS, TIME_FORMATS, formatDate, formatTime, todayISO, parseISODate, titleCase, trimWhitespace,
  normalizeLineBreaks, cleanText, reformatDates, GREETINGS, SIGN_OFFS,
} from '../lib/textUtils.js';

export const EMAIL_PREF_KEY = 'osama-automation-email-prefs-v1';
export const SCAN_KEY = 'osama-automation-scan-types-v1';
export const SNIPPET_KEY = 'osama-automation-snippets-v1';
export const DEFAULT_SCAN_TYPES = ['MRI', 'CT', 'Ultrasound', 'X-ray', 'PET-CT', 'DEXA', 'Fluoroscopy'];
const CORE_KEYS = ['patient_name', 'date', 'time', 'scan_type'];
const PROFILE_KEYS = VARIABLES.filter(v => v.profile).map(v => v.key).concat('clinic_name');
const KEY_ORDER = VARIABLES.map(v => v.key);
// Details that belong to one patient/appointment (cleared together; checked for carry-over).
const PATIENT_KEYS = ['patient_name', 'patient_first_name', 'reference_number', 'date', 'time', 'scan_type', 'location', 'consultant_name'];
/** Show fields in a predictable order (patient, date, time, scan, …) whatever the template order. */
const sortKeys = keys => [...keys].sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b));

export const TEMPLATES_PANEL = `<section id="templatesPanel" class="modulePanel widePanel" hidden>
<div class="moduleTop"><div><h1>Quick Replies</h1><p>Search, fill in and copy ready-to-send responses. Details you type are not saved. <span class="kbdHint">↑↓ choose • Enter fill in • Ctrl+Enter copy • Ctrl+K find anywhere</span></p></div>
<div class="moduleActions"><button id="addTemplate" class="primary">+ New reply</button><button id="resetBuiltins" title="Restore the original wording of all built-in replies">Reset built-ins…</button></div></div>
<div class="replyToolbar"><input id="templateSearch" type="search" placeholder="Search replies…  ( / )" aria-label="Search replies"><select id="templateCategory" aria-label="Category"></select><label class="switch"><input id="favoritesOnly" type="checkbox"> ★ Favourites only</label></div>
<div id="recentReplies" class="chipRow" aria-label="Recently used"></div>
<div class="patientBar" hidden role="status"><span class="patientSummary"></span><label class="switch"><input type="checkbox" class="clearAfterCopy"> Clear after copying</label><button type="button" class="clearPatient">Clear details</button></div>
<div class="replyLayout"><div id="templateCards" class="replyList" aria-label="Replies"></div><section id="replyDetail" class="replyDetail card" aria-live="polite"></section></div>
</section>`;

export const COMPOSER_PANEL = `<section id="composerPanel" class="modulePanel widePanel" hidden>
<div class="moduleTop"><div><h1>Email Composer</h1><p>Start from a reply, fill in the details, tidy the wording and copy. Use <code>{patient_name}</code>, <code>{date}</code>, <code>{time}</code>, <code>{scan_type}</code> and more as placeholders.</p></div>
<div class="moduleActions"><button id="addSnippet">+ Snippet</button></div></div>
<div class="composerGrid">
<div class="composerSide card">
<div class="patientBar" hidden role="status"><span class="patientSummary"></span><label class="switch"><input type="checkbox" class="clearAfterCopy"> Clear after copying</label><button type="button" class="clearPatient">Clear details</button></div>
  <label class="field">Start from<select id="composerTemplate"></select></label>
  <h3>Details</h3>
  <div id="composerFields" class="varFields"></div>
  <details id="profileBox"><summary>My details (for sign-offs)</summary><div id="profileFields" class="varFields"></div><label class="switch"><input id="rememberProfile" type="checkbox"> Remember my details on this device</label><p class="mini">Only your own name, department, number and clinic name — never patient details.</p></details>
  <details><summary>Date &amp; time format</summary><label class="field">Date<select id="dateFormat">${DATE_FORMATS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}</select></label><label class="field">Time<select id="timeFormat">${TIME_FORMATS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}</select></label></details>
  <details><summary>Scan type shortcuts</summary><div id="scanTypeList" class="chipRow"></div><div class="inlineRow"><input id="newScanType" placeholder="Add scan type" aria-label="New scan type" maxlength="40"><button id="addScanType" type="button">Add</button></div><button id="resetScanTypes" type="button" class="linkBtn">Restore defaults</button><p class="mini">Administrative labels only.</p></details>
  <h3>Snippets</h3><div id="snippetList"></div>
</div>
<div class="composerMain card">
  <label class="field">Subject<input id="composerSubject" placeholder="e.g. {scan_type} appointment - {date}"></label>
  <label class="field">Message<textarea id="composerBody" rows="11" placeholder="Choose a reply on the left or type here…"></textarea></label>
  <div class="toolRow" aria-label="Insert"><span class="mini">Insert:</span><span id="insertVars" class="chipRow"></span><select id="insertGreeting" aria-label="Insert greeting"><option value="">Greeting…</option>${GREETINGS.map((g, i) => `<option value="${i}">${esc(g)}</option>`).join('')}</select><select id="insertSignoff" aria-label="Insert sign-off"><option value="">Sign-off…</option>${SIGN_OFFS.map((g, i) => `<option value="${i}">${esc(g.replace(/\n/g, ' / '))}</option>`).join('')}</select></div>
  <div class="toolRow" aria-label="Tidy text"><span class="mini">Tidy:</span><button type="button" data-util="trim" title="Trim spaces and blank lines">Trim spaces</button><button type="button" data-util="lines" title="Normalise line breaks">Line breaks</button><button type="button" data-util="title" title="Title Case the selected text (or the subject if nothing is selected)">Title Case</button><button type="button" data-util="clean" title="Remove hidden characters from pasted text">Clean pasted</button><button type="button" data-util="dates" title="Convert dates like 2026-10-28 or 28/10/2026 to the chosen format">Format dates</button></div>
  <h3>Preview</h3>
  <div id="composerPreview" class="previewBox" aria-live="polite"></div>
  <div id="composerWarnings"></div>
  <div class="moduleActions"><button id="copySubject">⧉ Copy subject</button><button id="copyBody" class="primary">⧉ Copy message</button><button id="copyAll">⧉ Copy subject + message</button><button id="clearComposer">Clear</button></div>
</div>
<div class="clinicCard card">
  <h3>Clinic list assistant</h3>
  <div class="twoCols"><label class="field">Date<input id="clinicDate" type="date"></label><label class="field">Purpose<select id="clinicPurpose"><option value="send">Sending the list</option><option value="request">Requesting the list</option></select></label></div>
  <div class="twoCols"><label class="field">Clinic / location<input id="clinicName" placeholder="Optional"></label><label class="field">Consultant<input id="clinicConsultant" placeholder="Optional"></label></div>
  <label class="switch" id="clinicAttachRow"><input id="clinicAttach" type="checkbox"> I will attach the clinic list to this email</label>
  <div class="moduleActions"><button id="clinicGenerate" class="primary" type="button">Generate in composer</button></div>
  <p class="mini">"Please find attached" is only used when you tick the attachment box.</p>
</div>
</div>
</section>`;

export const EMAIL_MODALS = `<div id="templateModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="templateModalTitle"><div class="modalCard"><div class="modalHead"><h2 id="templateModalTitle">New reply</h2><button data-close="templateModal" class="iconBtn" aria-label="Close">×</button></div>
<label>Name<input id="tplName" maxlength="80" placeholder="e.g. Appointment confirmation"></label>
<label>Category<input id="tplCategory" maxlength="40" list="categorySuggestions" placeholder="e.g. Appointments"><datalist id="categorySuggestions"></datalist></label>
<label>Subject (optional)<input id="tplSubject" maxlength="200" placeholder="e.g. {scan_type} appointment - {date}"></label>
<label>Message<textarea id="tplBody" rows="9" placeholder="Write the reply. Use placeholders such as {patient_name} rather than real patient details."></textarea></label>
<div class="placeholderHelp"><div>Insert placeholder:</div><div id="tplVarChips" class="chipRow"></div><div id="tplVarReport" class="mini"></div></div>
<div class="modalActions"><button data-close="templateModal">Cancel</button><button id="saveTemplate" class="primary">Save reply</button></div></div></div>
<div id="snippetModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="snippetModalTitle"><div class="modalCard small"><div class="modalHead"><h2 id="snippetModalTitle">Add Snippet</h2><button data-close="snippetModal" class="iconBtn" aria-label="Close">×</button></div><label>Name<input id="snippetName" maxlength="80"></label><label>Text<textarea id="snippetBody" rows="5"></textarea></label><div class="modalActions"><button data-close="snippetModal">Cancel</button><button id="saveSnippet" class="primary">Save Snippet</button></div></div></div>`;

export function initEmailTools({ onChange = () => {}, goTo = () => {} } = {}) {
  const store = createTemplateStore();
  const prefs = { dateFormat: 'dd/mm/yyyy', timeFormat: '24h', rememberProfile: false, profile: {}, ...readLocal(EMAIL_PREF_KEY, {}) };
  // In-memory only. Profile values are pre-filled if the user opted to remember them.
  const vars = { ...(prefs.rememberProfile ? prefs.profile : {}) };
  let selectedId = null, editingId = null, composerTemplateId = '', lastTplField = null, editingSnippetId = null;
  // Which reply (or 'composer') the current patient details were typed for. Used to warn when
  // details typed for one message are about to go out in a different one.
  let detailsContext = null;
  const hasPatientDetails = () => PATIENT_KEYS.some(k => String(vars[k] || '').trim());
  const usesPatientDetails = t => !!t && extractVariables(t.subject, t.body).some(v => PATIENT_KEYS.includes(v.key));
  const carriedOver = (t, context) => hasPatientDetails() && usesPatientDetails(t) && !!detailsContext && detailsContext !== context;

  const savePrefs = () => {
    const out = { dateFormat: prefs.dateFormat, timeFormat: prefs.timeFormat, rememberProfile: prefs.rememberProfile, clearAfterCopy: !!prefs.clearAfterCopy, hideActionNotice: !!prefs.hideActionNotice };
    if (prefs.rememberProfile) out.profile = Object.fromEntries(PROFILE_KEYS.map(k => [k, vars[k] || '']).filter(([, v]) => v));
    writeLocal(EMAIL_PREF_KEY, out);
  };
  const scanTypes = () => { const a = readLocal(SCAN_KEY, null); return Array.isArray(a) && a.length ? a : [...DEFAULT_SCAN_TYPES]; };

  /** Values handed to the engine: dates/times formatted; invalid input is treated as missing. */
  function engineValues() {
    const v = { ...vars };
    v.date = vars.date ? formatDate(vars.date, prefs.dateFormat) : '';
    v.time = vars.time ? formatTime(vars.time, prefs.timeFormat) : '';
    return v;
  }

  // ---------- shared variable inputs ----------
  function fieldHtml(key) {
    const def = variableDef(key) || { key, label: labelFor(key), kind: 'text' };
    const val = esc(vars[key] || '');
    const id = `v_${key}_${Math.random().toString(36).slice(2, 7)}`;
    if (def.kind === 'date') return `<div class="varField"><label for="${id}">${esc(def.label)}</label><div class="inlineRow"><input id="${id}" type="date" data-var="date" value="${val}"><button type="button" class="smallBtn" data-today title="Use today's date">Today</button></div></div>`;
    if (def.kind === 'time') return `<div class="varField"><label for="${id}">${esc(def.label)}</label><input id="${id}" type="time" data-var="time" value="${val}"></div>`;
    if (def.kind === 'scan') return `<div class="varField"><label for="${id}">${esc(def.label)}</label><input id="${id}" data-var="scan_type" list="scanTypeOptions" value="${val}" placeholder="Choose or type" autocomplete="off"><div class="chipRow">${scanTypes().map(s => `<button type="button" class="chip" data-scan="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    const ph = key === 'patient_first_name' ? (firstNameOf(vars.patient_name) ? `Auto: ${firstNameOf(vars.patient_name)}` : 'From patient name') : '';
    return `<div class="varField"><label for="${id}">${esc(def.label)}</label><input id="${id}" data-var="${key}" value="${val}" placeholder="${esc(ph)}" autocomplete="off" maxlength="200"></div>`;
  }

  function renderVarFields(container, keys, refresh, context = null) {
    container.innerHTML = keys.length ? keys.map(fieldHtml).join('') : '<p class="mini">This reply has no fields to fill in.</p>';
    const inputs = $$('[data-var]', container);
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        vars[inp.dataset.var] = inp.value;
        if (PATIENT_KEYS.includes(inp.dataset.var) && context) detailsContext = typeof context === 'function' ? context() : context;
        if (PROFILE_KEYS.includes(inp.dataset.var) && prefs.rememberProfile) savePrefs();
        syncOtherInputs(inp);
        updatePatientBars();
        refresh();
      });
      // Enter moves to the next field; from the last one it jumps to the main Copy button.
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        (inputs[i + 1] || container.closest('section, .composerGrid')?.querySelector('#detailCopyBody, #copyBody'))?.focus();
      });
    });
    $$('[data-today]', container).forEach(b => { b.onclick = () => { const i = b.parentElement.querySelector('input'); i.value = todayISO(); i.dispatchEvent(new Event('input')); }; });
    $$('[data-scan]', container).forEach(b => { b.onclick = () => { const i = b.closest('.varField').querySelector('input'); i.value = b.dataset.scan; i.dispatchEvent(new Event('input')); }; });
    return inputs;
  }
  // Keep the same variable in sync across panels without re-rendering (preserves focus/caret).
  function syncOtherInputs(src) {
    $$(`[data-var="${src.dataset.var}"]`).forEach(i => { if (i !== src) i.value = src.value; });
    if (src.dataset.var === 'patient_name') $$('[data-var="patient_first_name"]').forEach(i => { i.placeholder = firstNameOf(src.value) ? `Auto: ${firstNameOf(src.value)}` : 'From patient name'; });
  }

  // ---------- current patient details ----------
  function patientSummary() {
    const v = engineValues();
    return [v.patient_name || v.patient_first_name, v.reference_number, v.scan_type, v.date, v.time].filter(x => String(x || '').trim()).join(' • ');
  }
  function updatePatientBars() {
    const show = hasPatientDetails();
    for (const bar of $$('.patientBar')) {
      bar.hidden = !show;
      if (show) bar.querySelector('.patientSummary').innerHTML = `Details in use: <b>${esc(patientSummary())}</b>`;
      bar.querySelector('.clearAfterCopy').checked = !!prefs.clearAfterCopy;
    }
  }
  function clearPatient({ quiet } = {}) {
    for (const k of Object.keys(vars)) if (!PROFILE_KEYS.includes(k)) delete vars[k];
    detailsContext = null;
    $$('[data-var]').forEach(i => { if (!PROFILE_KEYS.includes(i.dataset.var)) i.value = ''; });
    updatePatientBars();
    renderDetail();
    updateComposerPreview();
    if (!quiet) toast('Patient details cleared.');
  }
  function afterCopy(templateId) {
    if (templateId) { store.recordUse(templateId); renderRecent(); onChange(); }
    if (prefs.clearAfterCopy && hasPatientDetails()) { clearPatient({ quiet: true }); toast('Copied. Patient details cleared.'); }
  }
  document.addEventListener('click', e => {
    if (e.target.closest('.clearPatient')) clearPatient();
  });
  document.addEventListener('change', e => {
    if (!e.target.classList?.contains('clearAfterCopy')) return;
    prefs.clearAfterCopy = e.target.checked;
    savePrefs();
    updatePatientBars();
  });

  /** Escaped HTML preview with unfilled/unknown placeholders highlighted. */
  function previewHtml(text) {
    return splitTokens(text).map(p => (p.token ? `<mark class="${p.known ? 'missing' : 'unknown'}" title="${p.known ? 'Not filled in yet' : 'Unknown placeholder – left as typed'}">${esc(p.text)}</mark>` : esc(p.text))).join('');
  }

  function warningsHtml(r, t, context) {
    const out = [];
    if (context && carriedOver(t, context)) out.push(`<div class="warnNote carryNote"><b>Check the patient:</b> these details (${esc(patientSummary())}) were typed for a different message. <button type="button" class="smallBtn" data-same-patient>Yes, same patient</button> <button type="button" class="smallBtn" data-new-patient>New patient – clear</button></div>`);
    if (r.missing.length) out.push(`<div class="warnNote">Still to fill in: ${r.missing.map(k => `<b>${esc(labelFor(k))}</b>`).join(', ')}</div>`);
    if (r.unknown.length) out.push(`<div class="warnNote">Unknown placeholder${r.unknown.length > 1 ? 's' : ''} ${r.unknown.map(u => `<code>{${esc(u)}}</code>`).join(', ')} will be left as typed. Check the spelling.</div>`);
    if (r.used.includes('date') && vars.date && !parseISODate(vars.date)) out.push('<div class="warnNote">The date entered is not a valid calendar date.</div>');
    if (t?.mentionsAttachment || /please find attached|attached (is|are)/i.test(r.body)) out.push('<div class="infoNote">📎 This message says a file is attached — remember to attach it before sending.</div>');
    if (t?.assertsAction && !prefs.hideActionNotice) out.push('<div class="infoNote">This reply states that an action has happened or will happen. Send it only when that is true. <button type="button" class="linkBtn" data-hide-action-notice>Don\'t show this reminder</button></div>');
    return out.join('');
  }

  async function copyWithCheck(text, r, message, templateId, carried = false) {
    if (carried && !confirm(`These details were typed for a different message:\n\n${patientSummary()}\n\nCopy them in this message?`)) return false;
    if (r.missing.length && !confirm(`These fields are still empty: ${r.missing.map(labelFor).join(', ')}.\n\nCopy anyway with the placeholders left in?`)) return false;
    const ok = await copyText(text, message);
    if (ok) afterCopy(templateId);
    return ok;
  }
  // Notice buttons rendered inside warning areas.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-same-patient], [data-new-patient], [data-hide-action-notice]');
    if (!b) return;
    const inComposer = !!b.closest('#composerPanel');
    if (b.matches('[data-same-patient]')) { detailsContext = inComposer ? 'composer' : selectedId; renderDetail(); updateComposerPreview(); }
    else if (b.matches('[data-new-patient]')) { clearPatient(); (inComposer ? $('#composerFields [data-var]') : $('#replyDetail [data-var]'))?.focus(); }
    else { prefs.hideActionNotice = true; savePrefs(); renderDetail(); updateComposerPreview(); }
  });
  const fullMessage = r => (r.subject ? `Subject: ${r.subject}\n\n${r.body}` : r.body);

  // ---------- Quick Replies ----------
  function renderCategoryFilter(all) {
    const sel = $('#templateCategory'), cur = sel.value;
    const cats = [...new Set([...CATEGORIES, ...all.map(t => t.category).filter(Boolean)])];
    sel.innerHTML = `<option value="">All categories</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)} (${all.filter(t => t.category === c).length})</option>`).join('')}`;
    if (cats.includes(cur)) sel.value = cur;
    $('#categorySuggestions').innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  }

  function renderRecent() {
    const r = store.recent().slice(0, 6);
    $('#recentReplies').innerHTML = r.length ? `<span class="mini">Recent:</span>${r.map(t => `<button type="button" class="chip" data-recent="${esc(t.id)}">${esc(t.name)}</button>`).join('')}` : '';
    $$('[data-recent]').forEach(b => { b.onclick = () => selectReply(b.dataset.recent, { focus: true }); });
  }

  function renderTemplates() {
    const all = store.list();
    renderCategoryFilter(all);
    renderRecent();
    const items = searchTemplates(all, $('#templateSearch').value, { category: $('#templateCategory').value, favoritesOnly: $('#favoritesOnly').checked });
    const uses = store.uses();
    items.sort((a, b) => Number(b.favorite) - Number(a.favorite) || (uses[b.id] || 0) - (uses[a.id] || 0));
    if (selectedId && !all.some(t => t.id === selectedId)) selectedId = null;
    if (!selectedId && items.length) selectedId = items[0].id;
    $('#templateCards').innerHTML = items.length ? items.map(t => {
      const vars_ = extractVariables(t.subject, t.body);
      return `<article class="replyItem ${t.id === selectedId ? 'selected' : ''}" data-reply="${esc(t.id)}" tabindex="0" aria-selected="${t.id === selectedId}">
        <div class="replyItemHead"><b>${esc(t.name)}</b><button type="button" class="starBtn ${t.favorite ? 'on' : ''}" data-fav-template="${esc(t.id)}" title="${t.favorite ? 'Remove from favourites' : 'Add to favourites'}" aria-label="Favourite" aria-pressed="${t.favorite}">${t.favorite ? '★' : '☆'}</button></div>
        <div class="replyMeta"><span class="categoryPill">${esc(t.category)}</span>${t.builtin ? `<span class="badge">${t.edited ? 'Built-in (edited)' : 'Built-in'}</span>` : '<span class="badge mine">Custom</span>'}${vars_.length ? `<span class="badge vars">${vars_.length} field${vars_.length > 1 ? 's' : ''}</span>` : ''}</div>
        <p class="replySnippet">${esc(t.body.replace(/\s+/g, ' ').slice(0, 150))}</p>
        <button type="button" class="copyQuick" data-copy-template="${esc(t.id)}" title="Copy this reply">⧉ Copy</button>
      </article>`;
    }).join('') : '<div class="emptyTemplates"><h3>No replies match</h3><p>Try another search or category, or add a new reply.</p></div>';
    $$('[data-reply]').forEach(el => {
      el.addEventListener('click', e => { if (!e.target.closest('button')) selectReply(el.dataset.reply); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) selectReply(el.dataset.reply, { focus: true }); });
    });
    $$('[data-fav-template]').forEach(b => { b.onclick = () => { store.toggleFavorite(b.dataset.favTemplate); renderTemplates(); onChange(); }; });
    $$('[data-copy-template]').forEach(b => { b.onclick = () => quickCopy(b.dataset.copyTemplate, b); });
    renderDetail();
  }

  function selectReply(id, { focus } = {}) {
    selectedId = id;
    $$('.replyItem').forEach(el => { const on = el.dataset.reply === id; el.classList.toggle('selected', on); el.setAttribute('aria-selected', String(on)); });
    renderDetail();
    if (focus) focusFirstField();
  }
  /** Focus the first empty field of the open reply, or its Copy button when nothing is missing. */
  function focusFirstField() {
    const inputs = $$('#replyDetail [data-var]');
    (inputs.find(i => !i.value) || (inputs.length && carriedOver(store.get(selectedId), selectedId) ? inputs[0] : null) || $('#detailCopyBody'))?.focus();
  }
  function focusReply(id) { selectReply(id); focusFirstField(); }

  /**
   * One-click copy. Replies without fields copy immediately. Replies with fields are opened
   * instead when anything is missing, or when the filled-in details were typed for another
   * message — so a previous patient's name is never copied into a new reply by accident.
   */
  async function quickCopy(id, btn) {
    const t = store.get(id);
    if (!t) return false;
    const r = renderMessage(t, engineValues());
    if (r.missing.length || carriedOver(t, id)) {
      if (activeTabIsReplies()) selectReply(id); else { goTo('templates'); selectedId = id; renderTemplates(); }
      const first = r.missing.length ? $(`#replyDetail [data-var="${r.missing[0]}"]`) : $('#replyDetail [data-var]');
      first?.focus();
      toast(r.missing.length ? `Fill in ${r.missing.map(labelFor).join(', ')}, then copy.` : 'Check the patient details for this reply, then copy.', 'error');
      return false;
    }
    if (await copyText(r.body, `Copied "${t.name}"`)) {
      afterCopy(id);
      if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '⧉ Copy'; }, 1300); }
      return true;
    }
    return false;
  }
  const activeTabIsReplies = () => !$('#templatesPanel').hidden;

  function renderDetail() {
    const box = $('#replyDetail');
    const t = selectedId && store.get(selectedId);
    if (!t) { box.innerHTML = '<div class="emptyDetail"><h3>Select a reply</h3><p>Choose a reply on the left to fill in and copy it.</p></div>'; return; }
    const keys = sortKeys(extractVariables(t.subject, t.body).filter(v => v.known).map(v => v.key));
    box.innerHTML = `<div class="detailHead"><div><h2>${esc(t.name)}</h2><span class="categoryPill">${esc(t.category)}</span>${t.builtin ? `<span class="badge">${t.edited ? 'Built-in (edited)' : 'Built-in'}</span>` : ''}</div></div>
      <div class="varFields" id="detailFields"></div>
      <div class="previewBox" id="detailPreview"></div>
      <div id="detailWarnings"></div>
      <div class="moduleActions"><button id="detailCopyBody" class="primary">⧉ Copy message</button>${t.subject ? '<button id="detailCopySubject">⧉ Copy subject</button><button id="detailCopyAll">⧉ Copy subject + message</button>' : ''}<button id="detailCompose" title="Open in the Email Composer to adjust the wording">Open in Composer</button></div>
      <div class="moduleActions secondary"><button id="detailEdit">✎ Edit</button><button id="detailDup">Duplicate</button>${t.builtin ? (t.edited ? '<button id="detailReset">Reset to original</button>' : '') : '<button id="detailDelete" class="dangerText">Delete</button>'}</div>`;
    const refresh = () => {
      const r = renderMessage(t, engineValues());
      $('#detailPreview').innerHTML = `${t.subject ? `<div class="previewLabel">Subject</div><div class="previewSubject">${previewHtml(r.subject)}</div><div class="previewLabel">Message</div>` : ''}<pre class="previewBody">${previewHtml(r.body)}</pre>`;
      $('#detailWarnings').innerHTML = warningsHtml(r, t, t.id);
      return r;
    };
    renderVarFields($('#detailFields'), keys, refresh, t.id);
    refresh();
    $('#detailCopyBody').onclick = () => { const r = refresh(); copyWithCheck(r.body, r, 'Message copied', t.id, carriedOver(t, t.id)); };
    if (t.subject) {
      $('#detailCopySubject').onclick = () => { const r = refresh(); copyWithCheck(r.subject, { ...r, missing: renderMessage({ subject: t.subject }, engineValues()).missing }, 'Subject copied', t.id, carriedOver(t, t.id)); };
      $('#detailCopyAll').onclick = () => { const r = refresh(); copyWithCheck(fullMessage(r), r, 'Subject and message copied', t.id, carriedOver(t, t.id)); };
    }
    $('#detailCompose').onclick = () => { loadIntoComposer(t.id); if (detailsContext === t.id) detailsContext = 'composer'; goTo('composer'); };
    $('#detailEdit').onclick = () => openTemplateModal(t);
    $('#detailDup').onclick = () => { selectedId = store.duplicate(t.id); renderTemplates(); onChange(); toast('Duplicated — you can now edit the copy.'); };
    $('#detailReset')?.addEventListener('click', () => { if (confirm(`Restore the original wording of "${t.original.name}"?`)) { store.resetBuiltin(t.id); renderTemplates(); onChange(); } });
    $('#detailDelete')?.addEventListener('click', () => { if (confirm(`Delete "${t.name}"? This cannot be undone.`)) { store.remove(t.id); selectedId = null; renderTemplates(); onChange(); } });
  }

  // ---------- template editor modal ----------
  function openTemplateModal(t = null) {
    editingId = t?.id || null;
    $('#templateModalTitle').textContent = t ? (t.builtin ? 'Edit built-in reply' : 'Edit reply') : 'New reply';
    $('#tplName').value = t?.name || '';
    $('#tplCategory').value = t?.category || ($('#templateCategory').value || '');
    $('#tplSubject').value = t?.subject || '';
    $('#tplBody').value = t?.body || '';
    $('#tplVarChips').innerHTML = VARIABLES.map(v => `<button type="button" class="chip" data-insert-var="${v.key}" title="${esc(v.label)}">${placeholderFor(v.key)}</button>`).join('');
    $$('[data-insert-var]', $('#tplVarChips')).forEach(b => { b.onclick = () => insertAtCursor(lastTplField || $('#tplBody'), placeholderFor(b.dataset.insertVar)); reportTplVars(); });
    lastTplField = $('#tplBody');
    reportTplVars();
    $('#templateModal').hidden = false;
    setTimeout(() => $('#tplName').focus(), 0);
  }
  function reportTplVars() {
    const v = extractVariables($('#tplSubject').value, $('#tplBody').value);
    const known = v.filter(x => x.known), unknown = v.filter(x => !x.known);
    $('#tplVarReport').innerHTML = (known.length ? `Fields used: ${known.map(x => esc(labelFor(x.key))).join(', ')}.` : 'No placeholders used.')
      + (unknown.length ? ` <span class="warnText">Unknown: ${unknown.map(x => `<code>${esc(x.tokens[0])}</code>`).join(', ')} — these will not be filled in.</span>` : '');
  }
  ['tplSubject', 'tplBody'].forEach(id => { $(`#${id}`).addEventListener('focus', e => { lastTplField = e.target; }); $(`#${id}`).addEventListener('input', reportTplVars); });
  $('#saveTemplate').onclick = () => {
    try {
      const id = store.save({ id: editingId, name: $('#tplName').value, category: $('#tplCategory').value, subject: $('#tplSubject').value, body: $('#tplBody').value });
      $('#templateModal').hidden = true;
      selectedId = id;
      renderTemplates();
      renderComposerTemplates();
      onChange();
      toast('Reply saved.');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#addTemplate').onclick = () => openTemplateModal();
  $('#resetBuiltins').onclick = () => {
    if (!confirm('Restore the original wording of all built-in replies? Your own custom replies and favourites are kept.')) return;
    store.resetAllBuiltins();
    renderTemplates();
    onChange();
    toast('Built-in replies restored.');
  };
  $('#templateSearch').oninput = () => { selectedId = null; renderTemplates(); };
  $('#templateSearch').addEventListener('keydown', e => {
    const ids = $$('.replyItem').map(el => el.dataset.reply);
    if (!ids.length) return;
    const i = Math.max(0, ids.indexOf(selectedId));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = ids[(i + (e.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length];
      selectReply(next);
      $(`.replyItem[data-reply="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      focusReply(ids[i]);
    }
  });
  $('#templateCategory').onchange = () => { selectedId = null; renderTemplates(); };
  $('#favoritesOnly').onchange = () => { selectedId = null; renderTemplates(); };

  function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
    el.setRangeText(text, start, end, 'end');
    el.focus();
    el.dispatchEvent(new Event('input'));
  }

  // ---------- Composer ----------
  function renderComposerTemplates() {
    const all = store.list();
    const groups = {};
    for (const t of all) (groups[t.category] ||= []).push(t);
    $('#composerTemplate').innerHTML = '<option value="">Blank message</option>' + Object.entries(groups).map(([cat, ts]) => `<optgroup label="${esc(cat)}">${ts.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
    $('#composerTemplate').value = composerTemplateId;
  }

  function composerKeys() {
    const used = extractVariables($('#composerSubject').value, $('#composerBody').value).filter(v => v.known).map(v => v.key);
    // Always offer the four core fields; add any other field the text uses. Sign-off details
    // (your name, department, number) are edited under "My details" instead.
    return sortKeys([...new Set([...CORE_KEYS, ...used])].filter(k => !['sender_name', 'department', 'contact_number'].includes(k)));
  }
  let lastKeysSig = '';
  function refreshComposerFields(force) {
    const keys = composerKeys();
    const sig = keys.join(',');
    if (!force && sig === lastKeysSig) return;
    lastKeysSig = sig;
    renderVarFields($('#composerFields'), keys, updateComposerPreview, 'composer');
  }
  function updateComposerPreview() {
    refreshComposerFields();
    const t = composerTemplateId ? store.get(composerTemplateId) : null;
    const r = renderMessage({ subject: $('#composerSubject').value, body: $('#composerBody').value }, engineValues());
    $('#composerPreview').innerHTML = `<div class="previewLabel">Subject</div><div class="previewSubject">${r.subject ? previewHtml(r.subject) : '<span class="mini">(no subject)</span>'}</div><div class="previewLabel">Message</div><pre class="previewBody">${r.body ? previewHtml(r.body) : '<span class="mini">(empty)</span>'}</pre>`;
    const asTemplate = { subject: $('#composerSubject').value, body: $('#composerBody').value, ...(t && t.body === $('#composerBody').value ? { mentionsAttachment: t.mentionsAttachment, assertsAction: t.assertsAction } : {}) };
    $('#composerWarnings').innerHTML = warningsHtml(r, asTemplate, 'composer');
    updatePatientBars();
    return r;
  }
  function loadIntoComposer(id) {
    const t = store.get(id);
    if (!t) return;
    if (($('#composerBody').value.trim() || $('#composerSubject').value.trim()) && composerTemplateId !== id
      && !confirm('Replace the current subject and message with this reply?')) { $('#composerTemplate').value = composerTemplateId; return; }
    composerTemplateId = id;
    $('#composerTemplate').value = id;
    $('#composerSubject').value = t.subject || '';
    $('#composerBody').value = t.body;
    updateComposerPreview();
  }

  function renderProfile() {
    renderVarFields($('#profileFields'), ['sender_name', 'department', 'contact_number', 'clinic_name'], updateComposerPreview);
    $('#rememberProfile').checked = !!prefs.rememberProfile;
  }
  $('#rememberProfile').onchange = e => { prefs.rememberProfile = e.target.checked; savePrefs(); toast(e.target.checked ? 'Your details will be remembered on this device.' : 'Your details will no longer be stored.'); };
  $('#dateFormat').value = prefs.dateFormat;
  $('#timeFormat').value = prefs.timeFormat;
  $('#dateFormat').onchange = e => { prefs.dateFormat = e.target.value; savePrefs(); updateComposerPreview(); renderDetail(); };
  $('#timeFormat').onchange = e => { prefs.timeFormat = e.target.value; savePrefs(); updateComposerPreview(); renderDetail(); };

  function renderScanTypes() {
    const list = scanTypes();
    $('#scanTypeList').innerHTML = list.map(s => `<span class="chip removable">${esc(s)}<button type="button" data-del-scan="${esc(s)}" aria-label="Remove ${esc(s)}" title="Remove">×</button></span>`).join('');
    let dl = $('#scanTypeOptions');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'scanTypeOptions'; document.body.appendChild(dl); }
    dl.innerHTML = list.map(s => `<option value="${esc(s)}"></option>`).join('');
    $$('[data-del-scan]').forEach(b => { b.onclick = () => { writeLocal(SCAN_KEY, scanTypes().filter(x => x !== b.dataset.delScan)); renderScanTypes(); refreshComposerFields(true); renderDetail(); }; });
  }
  $('#addScanType').onclick = () => {
    const v = $('#newScanType').value.trim();
    if (!v) return;
    const list = scanTypes();
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) return toast('That scan type is already listed.', 'error');
    writeLocal(SCAN_KEY, [...list, v]);
    $('#newScanType').value = '';
    renderScanTypes();
    refreshComposerFields(true);
    renderDetail();
  };
  $('#newScanType').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#addScanType').click(); } });
  $('#resetScanTypes').onclick = () => { writeLocal(SCAN_KEY, [...DEFAULT_SCAN_TYPES]); renderScanTypes(); refreshComposerFields(true); renderDetail(); };

  $('#composerTemplate').onchange = e => { if (e.target.value) loadIntoComposer(e.target.value); else { composerTemplateId = ''; } };
  ['composerSubject', 'composerBody'].forEach(id => $(`#${id}`).addEventListener('input', updateComposerPreview));
  const composerCarried = () => carriedOver({ subject: $('#composerSubject').value, body: $('#composerBody').value }, 'composer');
  $('#copySubject').onclick = () => { const r = updateComposerPreview(); copyWithCheck(r.subject, renderMessage({ subject: $('#composerSubject').value }, engineValues()), 'Subject copied', composerTemplateId, composerCarried()); };
  $('#copyBody').onclick = () => { const r = updateComposerPreview(); copyWithCheck(r.body, renderMessage({ body: $('#composerBody').value }, engineValues()), 'Message copied', composerTemplateId, composerCarried()); };
  $('#copyAll').onclick = () => { const r = updateComposerPreview(); copyWithCheck(fullMessage(r), r, 'Subject and message copied', composerTemplateId, composerCarried()); };
  $('#clearComposer').onclick = () => {
    if (($('#composerBody').value || $('#composerSubject').value) && !confirm('Clear the subject and message?')) return;
    $('#composerSubject').value = '';
    $('#composerBody').value = '';
    composerTemplateId = '';
    $('#composerTemplate').value = '';
    updateComposerPreview();
  };
  $('#insertVars').innerHTML = VARIABLES.filter(v => !v.derivedFrom).map(v => `<button type="button" class="chip" data-compose-var="${v.key}" title="Insert ${esc(v.label)}">${placeholderFor(v.key)}</button>`).join('');
  let lastComposerField = $('#composerBody');
  ['composerSubject', 'composerBody'].forEach(id => $(`#${id}`).addEventListener('focus', e => { lastComposerField = e.target; }));
  $$('[data-compose-var]').forEach(b => { b.onclick = () => insertAtCursor(lastComposerField, placeholderFor(b.dataset.composeVar)); });
  $('#insertGreeting').onchange = e => { if (e.target.value === '') return; const ta = $('#composerBody'); ta.value = `${GREETINGS[+e.target.value]}\n\n${ta.value.replace(/^\s+/, '')}`; e.target.value = ''; ta.dispatchEvent(new Event('input')); };
  $('#insertSignoff').onchange = e => { if (e.target.value === '') return; const ta = $('#composerBody'); ta.value = `${ta.value.replace(/\s+$/, '')}\n\n${SIGN_OFFS[+e.target.value]}`; e.target.value = ''; ta.dispatchEvent(new Event('input')); };

  $$('[data-util]').forEach(b => {
    b.onclick = () => {
      const ta = $('#composerBody');
      const fn = { trim: trimWhitespace, lines: normalizeLineBreaks, title: titleCase, clean: cleanText, dates: s => reformatDates(s, prefs.dateFormat) }[b.dataset.util];
      if (b.dataset.util === 'title' && ta.selectionStart === ta.selectionEnd) {
        $('#composerSubject').value = titleCase($('#composerSubject').value);
      } else if (ta.selectionStart !== ta.selectionEnd) {
        ta.setRangeText(fn(ta.value.slice(ta.selectionStart, ta.selectionEnd)), ta.selectionStart, ta.selectionEnd, 'select');
      } else {
        ta.value = fn(ta.value);
        if (b.dataset.util === 'trim' || b.dataset.util === 'clean') $('#composerSubject').value = fn($('#composerSubject').value);
      }
      updateComposerPreview();
      toast('Text updated.');
    };
  });

  // Clinic list assistant
  const syncClinicAttach = () => { $('#clinicAttachRow').hidden = $('#clinicPurpose').value !== 'send'; };
  $('#clinicPurpose').onchange = syncClinicAttach;
  syncClinicAttach();
  $('#clinicGenerate').onclick = () => {
    const date = $('#clinicDate').value;
    if (!parseISODate(date)) return toast('Choose the clinic date first.', 'error');
    // Uses its own values written straight into the text, so it never changes the patient
    // details shared by Quick Replies and the Composer.
    const clinic = $('#clinicName').value.trim(), consultant = $('#clinicConsultant').value.trim();
    const day = formatDate(date, prefs.dateFormat);
    const detail = `${clinic ? ` - ${clinic}` : ''}${consultant ? ` (${consultant})` : ''}`;
    const forWhat = `the clinic list for ${day}${clinic ? ` (${clinic}${consultant ? `, ${consultant}` : ''})` : consultant ? ` (${consultant})` : ''}`;
    let body;
    if ($('#clinicPurpose').value === 'request') body = `Hello,\n\nCould you please send ${forWhat}?\n\nMany thanks.`;
    else if ($('#clinicAttach').checked) body = `Hello,\n\nPlease find attached ${forWhat}.\n\nKind regards,\nRadiology Administration`;
    else body = `Hello,\n\nPlease see ${forWhat} below.\n\n\n\nKind regards,\nRadiology Administration`;
    if (($('#composerBody').value.trim()) && !confirm('Replace the current message with the clinic list email?')) return;
    composerTemplateId = '';
    $('#composerTemplate').value = '';
    $('#composerSubject').value = `Clinic list${detail} - ${day}`;
    $('#composerBody').value = body;
    refreshComposerFields(true);
    updateComposerPreview();
    $('#composerBody').focus();
    toast('Clinic list email generated.');
  };

  // Snippets (kept from earlier versions)
  const loadSnippets = () => readLocal(SNIPPET_KEY, []);
  function renderSnippets() {
    const a = loadSnippets();
    $('#snippetList').innerHTML = a.length ? a.map(s => `<div class="snippet"><button type="button" data-snippet-use="${esc(s.id)}" title="Insert into message">+ ${esc(s.name)}</button><button type="button" data-snippet-edit="${esc(s.id)}">Edit</button><button type="button" class="dangerText" data-snippet-del="${esc(s.id)}" aria-label="Delete snippet">×</button></div>`).join('') : '<div class="mini">No snippets saved yet.</div>';
    $$('[data-snippet-use]').forEach(b => { b.onclick = () => { const s = loadSnippets().find(x => x.id === b.dataset.snippetUse); if (s) { const ta = $('#composerBody'); const pos = ta.selectionStart ?? ta.value.length; ta.setRangeText((pos ? '\n' : '') + s.body, pos, ta.selectionEnd ?? pos, 'end'); ta.focus(); updateComposerPreview(); } }; });
    $$('[data-snippet-edit]').forEach(b => { b.onclick = () => openSnippet(loadSnippets().find(x => x.id === b.dataset.snippetEdit)); });
    $$('[data-snippet-del]').forEach(b => { b.onclick = () => { if (confirm('Delete snippet?')) { writeLocal(SNIPPET_KEY, loadSnippets().filter(x => x.id !== b.dataset.snippetDel)); renderSnippets(); } }; });
  }
  function openSnippet(s = null) {
    editingSnippetId = s?.id || null;
    $('#snippetModalTitle').textContent = s ? 'Edit Snippet' : 'Add Snippet';
    $('#snippetName').value = s?.name || '';
    $('#snippetBody').value = s?.body || '';
    $('#snippetModal').hidden = false;
    setTimeout(() => $('#snippetName').focus(), 0);
  }
  $('#addSnippet').onclick = () => openSnippet();
  $('#saveSnippet').onclick = () => {
    const name = $('#snippetName').value.trim(), body = $('#snippetBody').value.trim();
    if (!name || !body) return toast('Add a name and text.', 'error');
    const a = loadSnippets();
    if (editingSnippetId) { const s = a.find(x => x.id === editingSnippetId); if (s) Object.assign(s, { name, body, updatedAt: Date.now() }); }
    else a.unshift({ id: crypto.randomUUID(), name, body, createdAt: Date.now() });
    writeLocal(SNIPPET_KEY, a);
    $('#snippetModal').hidden = true;
    editingSnippetId = null;
    renderSnippets();
  };

  renderScanTypes();
  renderProfile();
  renderComposerTemplates();
  renderSnippets();
  updateComposerPreview();

  return {
    store,
    renderTemplates,
    renderComposer: () => { renderComposerTemplates(); renderSnippets(); refreshComposerFields(true); updateComposerPreview(); },
    quickCopy,
    openReply: id => { selectedId = id; renderTemplates(); focusFirstField(); },
    clearPatient,
    copyCurrent: (panel, all) => {
      const btn = panel === 'composer' ? (all ? $('#copyAll') : $('#copyBody')) : (all ? $('#detailCopyAll') || $('#detailCopyBody') : $('#detailCopyBody'));
      btn?.click();
    },
    focusSearch: () => $('#templateSearch').focus(),
    loadSnippets,
  };
}
