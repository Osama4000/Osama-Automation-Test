// Workspace modules: Dashboard, Daily Tasks, Quick Links, Quick Notes, Work Queue, Handover,
// universal search, preferences and backup. Data is local to this browser.
import { $, $$, esc, toast, copyText, readLocal, writeLocal, downloadBlob, safeImageSrc } from './lib/dom.js';
import { todayISO } from './lib/textUtils.js';
import { TEMPLATE_KEY, OVERRIDES_KEY, META_KEY } from './email/store.js';
import { EMAIL_PREF_KEY, SCAN_KEY, SNIPPET_KEY } from './email/ui.js';
import { renderMessage } from './email/templateEngine.js';
import { createSignatureStore } from './pdf/signatureStore.js';

export const TASK_KEY = 'osama-automation-tasks-v1', LINK_KEY = 'osama-automation-links-v1', NOTES_KEY = 'osama-automation-notes-v1';
export const QUEUE_KEY = 'osama-automation-queue-v1', PREF_KEY = 'osama-automation-preferences-v1';
const BACKUP_KEYS = ['osama-automation-pdf-prefs-v1', TEMPLATE_KEY, OVERRIDES_KEY, META_KEY, TASK_KEY, LINK_KEY, NOTES_KEY, QUEUE_KEY, SNIPPET_KEY, PREF_KEY, EMAIL_PREF_KEY, SCAN_KEY];
const STATUSES = ['New', 'Need Info', 'Ready to Book', 'Booked', 'External Referral', 'Waiting', 'Completed'];

export const WORKSPACE_PANELS = `
<section id="homePanel" class="modulePanel" hidden><div class="moduleTop"><div><h1>Dashboard</h1><p>Your local work hub. Avoid patient-identifiable information in tasks and notes.</p></div><div class="moduleActions"><button id="exportBackup">Export backup</button><label class="open btn">Import backup<input id="importBackup" type="file" accept="application/json,.json" hidden></label></div></div><div id="dashboardGrid" class="dashboardGrid"></div></section>
<section id="tasksPanel" class="modulePanel" hidden><div class="moduleTop"><div><h1>Daily Tasks</h1><p>Plan the shift, tick work off, and carry unfinished items forward.</p></div><button id="addTask" class="primary">+ Add Task</button></div><div id="taskProgress" class="progressCard"></div><div class="moduleToolbar"><select id="taskFilter" aria-label="Filter tasks"><option value="pending">Pending</option><option value="all">All</option><option value="done">Done</option></select><input id="taskSearch" type="search" placeholder="Search tasks…" aria-label="Search tasks"><button id="carryTasks">Carry pending to today</button><button id="clearDone">Clear completed</button></div><div id="taskList" class="stackList"></div></section>
<section id="linksPanel" class="modulePanel" hidden><div class="moduleTop"><div><h1>Quick Links</h1><p>Keep frequently used work resources in one place.</p></div><button id="addLink" class="primary">+ Add Link</button></div><div class="moduleToolbar"><input id="linkSearch" type="search" placeholder="Search links…" aria-label="Search links"></div><div id="linkList" class="linkGrid"></div></section>
<section id="notesPanel" class="modulePanel" hidden><div class="moduleTop"><div><h1>Quick Notes</h1><p>Temporary non-patient notes saved on this device.</p></div><div class="moduleActions"><button id="copyNotes">⧉ Copy</button><button id="clearNotes" class="dangerText">Clear</button></div></div><textarea id="quickNotes" class="notesArea" placeholder="Temporary notes only - do not store patient-identifiable information here." aria-label="Quick notes"></textarea><div id="notesStatus" class="mini" aria-live="polite"></div></section>
<section id="queuePanel" class="modulePanel" hidden><div class="moduleTop"><div><h1>Radiology Work Queue</h1><p>Track operational requests without using the inbox as a task list. Do not enter patient-identifiable information unless your organisation approves this storage.</p></div><button id="addCase" class="primary">+ Add Case</button></div><div id="queueStats" class="progressCard"></div><div class="moduleToolbar"><input id="queueSearch" type="search" placeholder="Search cases…" aria-label="Search cases"><select id="queueStatus" aria-label="Status"><option value="">All statuses</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}</select><select id="queuePriority" aria-label="Priority"><option value="">All priorities</option><option>Normal</option><option>Urgent</option></select><button id="showDue" aria-pressed="false">Due / overdue</button></div><div id="queueList" class="stackList"></div></section>
<section id="handoverPanel" class="modulePanel" hidden><div class="moduleTop"><div><h1>Shift Handover</h1><p>Generate a summary from the local queue and daily tasks. Review it before sharing.</p></div><div class="moduleActions"><button id="generateHandover" class="primary">Generate</button><button id="copyHandover">⧉ Copy</button></div></div><textarea id="handoverText" class="notesArea" placeholder="Generate a handover summary…" aria-label="Handover summary"></textarea></section>`;

export const WORKSPACE_MODALS = `
<div id="caseModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="caseModalTitle"><div class="modalCard"><div class="modalHead"><h2 id="caseModalTitle">Add Case</h2><button data-close="caseModal" class="iconBtn" aria-label="Close">×</button></div><label>Reference / description<input id="caseTitle" maxlength="140" placeholder="Use a non-identifying reference unless approved"></label><div class="twoCols"><label>Status<select id="caseStatus">${STATUSES.map(s => `<option>${s}</option>`).join('')}</select></label><label>Priority<select id="casePriority"><option>Normal</option><option>Urgent</option></select></label></div><div class="twoCols"><label>Owner<input id="caseOwner" maxlength="60" placeholder="Initials / team member"></label><label>Modality<select id="caseModality"><option>General</option><option>X-Ray</option><option>Ultrasound</option><option>CT</option><option>MRI</option><option>PET-CT</option><option>DEXA</option><option>Fluoroscopy</option><option>Other</option></select></label></div><label>Follow-up date/time<input id="caseFollowup" type="datetime-local"></label><label>Notes<textarea id="caseNotes" rows="3" placeholder="Operational notes only"></textarea></label><label>Workflow checklist<select id="caseChecklistType"><option value="">None</option><option value="external">External CT/MRI referral</option><option value="booking">Booking request</option></select></label><div class="modalActions"><button data-close="caseModal">Cancel</button><button id="saveCase" class="primary">Save Case</button></div></div></div>
<div id="followModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="followModalTitle"><div class="modalCard small"><div class="modalHead"><h2 id="followModalTitle">Next follow-up</h2><button data-close="followModal" class="iconBtn" aria-label="Close">×</button></div><label>Follow-up date/time<input id="followInput" type="datetime-local"></label><div class="modalActions"><button id="followClear">Remove follow-up</button><button data-close="followModal">Cancel</button><button id="followSave" class="primary">Save</button></div></div></div>
<div id="searchModal" class="modal" hidden role="dialog" aria-modal="true" aria-label="Search results"><div class="modalCard"><div class="modalHead"><h2>Workspace Search</h2><button data-close="searchModal" class="iconBtn" aria-label="Close">×</button></div><div id="searchResults" class="stackList"></div></div></div>
<div id="taskModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="taskModalTitle"><div class="modalCard small"><div class="modalHead"><h2 id="taskModalTitle">Add Task</h2><button data-close="taskModal" class="iconBtn" aria-label="Close">×</button></div><label>Task<input id="taskTitle" maxlength="160" placeholder="e.g. Check outstanding MRI referrals"></label><label>Priority<select id="taskPriority"><option>Normal</option><option>Urgent</option></select></label><label>Optional time<input id="taskTime" type="time"></label><label class="switch"><input id="taskRecurring" type="checkbox"> Repeat every day</label><label>Notes<textarea id="taskNotes" rows="3" placeholder="No patient-identifiable information"></textarea></label><div class="modalActions"><button data-close="taskModal">Cancel</button><button id="saveTask" class="primary">Save Task</button></div></div></div>
<div id="linkModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="linkModalTitle"><div class="modalCard small"><div class="modalHead"><h2 id="linkModalTitle">Add Link</h2><button data-close="linkModal" class="iconBtn" aria-label="Close">×</button></div><label>Name<input id="linkName" maxlength="80" placeholder="e.g. RIS / PACS"></label><label>URL<input id="linkUrl" type="url" placeholder="https://..."></label><label class="switch"><input id="linkFavorite" type="checkbox"> Favorite</label><div class="modalActions"><button data-close="linkModal">Cancel</button><button id="saveLink" class="primary">Save Link</button></div></div></div>`;

const checklistTemplates = {
  external: ['Referral checked', 'Required details checked', 'Payment route checked', 'PDF prepared', 'Referral sent', 'Tracker updated', 'Response received', 'Follow-up completed'],
  booking: ['Request checked', 'Required details available', 'Availability checked', 'Booking completed', 'Confirmation prepared'],
};
const fmtDate = v => { if (!v) return 'No follow-up'; const d = new Date(v); return Number.isNaN(+d) ? v : d.toLocaleString(); };
const isDue = c => c.status !== 'Completed' && c.followup && new Date(c.followup).getTime() <= Date.now();

export function initWorkspace({ email, setAppTab }) {
  let editingTaskId = null, editingLinkId = null, editingCaseId = null, followCaseId = null, queueDueOnly = false;

  // ---------- Tasks ----------
  function ensureRecurring() {
    const a = readLocal(TASK_KEY), today = todayISO();
    let changed = false;
    for (const t of [...a]) {
      if (t.recurring && t.date !== today && !a.some(x => (x.recurringSource === t.id || x.id === t.id) && x.date === today)) {
        a.unshift({ ...t, id: crypto.randomUUID(), date: today, done: false, doneAt: null, recurring: false, recurringSource: t.recurringSource || t.id, createdAt: Date.now() });
        changed = true;
      }
    }
    if (changed) writeLocal(TASK_KEY, a);
  }
  function renderTasks() {
    ensureRecurring();
    const all = readLocal(TASK_KEY), q = $('#taskSearch').value.trim().toLowerCase(), f = $('#taskFilter').value, today = todayISO();
    const items = all.filter(t => (!q || `${t.title} ${t.notes || ''}`.toLowerCase().includes(q)) && (f === 'all' || (f === 'done' ? t.done : !t.done)));
    items.sort((a, b) => Number(a.done) - Number(b.done) || Number(b.priority === 'Urgent') - Number(a.priority === 'Urgent') || String(a.time || '99:99').localeCompare(String(b.time || '99:99')));
    const td = all.filter(t => t.date === today), done = td.filter(t => t.done).length;
    $('#taskProgress').innerHTML = `<b>${done} / ${td.length} completed today</b><div class="progressTrack"><i style="width:${td.length ? (done / td.length) * 100 : 0}%"></i></div>`;
    $('#taskList').innerHTML = items.length ? items.map(t => `<article class="listCard ${t.done ? 'done' : ''}"><button class="doneBtn" data-task-done="${esc(t.id)}" title="Mark ${t.done ? 'pending' : 'done'}" aria-label="Mark ${t.done ? 'pending' : 'done'}">${t.done ? '✓' : '○'}</button><div class="grow"><b>${esc(t.title)}</b><div class="meta">${esc(t.date || '')} ${t.time ? '• ' + esc(t.time) : ''} • ${esc(t.priority || 'Normal')}${t.recurring ? ' • ↻ Daily' : ''}</div>${t.notes ? `<div class="cardNote">${esc(t.notes)}</div>` : ''}</div><button data-task-edit="${esc(t.id)}">Edit</button><button class="dangerText" data-task-del="${esc(t.id)}">Delete</button></article>`).join('') : '<div class="emptyTemplates">No tasks match this view.</div>';
    $$('[data-task-done]').forEach(b => { b.onclick = () => { const a = readLocal(TASK_KEY), t = a.find(x => x.id === b.dataset.taskDone); if (t) { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; writeLocal(TASK_KEY, a); renderTasks(); } }; });
    $$('[data-task-edit]').forEach(b => { b.onclick = () => openTask(readLocal(TASK_KEY).find(x => x.id === b.dataset.taskEdit)); });
    $$('[data-task-del]').forEach(b => { b.onclick = () => { if (confirm('Delete this task?')) { writeLocal(TASK_KEY, readLocal(TASK_KEY).filter(x => x.id !== b.dataset.taskDel)); renderTasks(); } }; });
  }
  function openTask(t = null) {
    editingTaskId = t?.id || null;
    $('#taskModalTitle').textContent = t ? 'Edit Task' : 'Add Task';
    $('#taskTitle').value = t?.title || '';
    $('#taskPriority').value = t?.priority || 'Normal';
    $('#taskTime').value = t?.time || '';
    $('#taskRecurring').checked = !!t?.recurring;
    $('#taskNotes').value = t?.notes || '';
    $('#taskModal').hidden = false;
    setTimeout(() => $('#taskTitle').focus(), 0);
  }
  $('#addTask').onclick = () => openTask();
  $('#saveTask').onclick = () => {
    const title = $('#taskTitle').value.trim();
    if (!title) return toast('Please add a task.', 'error');
    const a = readLocal(TASK_KEY);
    const data = { title, priority: $('#taskPriority').value, time: $('#taskTime').value, recurring: $('#taskRecurring').checked, notes: $('#taskNotes').value.trim(), updatedAt: Date.now() };
    if (editingTaskId) { const t = a.find(x => x.id === editingTaskId); if (t) Object.assign(t, data); }
    else a.unshift({ id: crypto.randomUUID(), done: false, createdAt: Date.now(), date: todayISO(), ...data });
    writeLocal(TASK_KEY, a);
    $('#taskModal').hidden = true;
    editingTaskId = null;
    renderTasks();
  };
  $('#taskFilter').onchange = renderTasks;
  $('#taskSearch').oninput = renderTasks;
  $('#clearDone').onclick = () => { if (confirm('Remove all completed tasks?')) { writeLocal(TASK_KEY, readLocal(TASK_KEY).filter(t => !t.done)); renderTasks(); } };
  $('#carryTasks').onclick = () => {
    const a = readLocal(TASK_KEY), today = todayISO();
    let n = 0;
    for (const t of a) if (!t.done && t.date !== today) { t.date = today; n++; }
    writeLocal(TASK_KEY, a);
    renderTasks();
    toast(n ? `${n} task(s) moved to today.` : 'No pending older tasks.');
  };

  // ---------- Links ----------
  function renderLinks() {
    const q = $('#linkSearch').value.trim().toLowerCase();
    const a = readLocal(LINK_KEY).filter(x => !q || `${x.name} ${x.url}`.toLowerCase().includes(q));
    a.sort((x, y) => Number(y.favorite) - Number(x.favorite) || (y.updatedAt || 0) - (x.updatedAt || 0));
    $('#linkList').innerHTML = a.length ? a.map(x => `<article class="linkCard"><div class="grow"><b>${x.favorite ? '★ ' : ''}${esc(x.name)}</b><div class="meta">${esc(x.url)}</div></div><a class="buttonLink primary" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">Open</a><button data-link-edit="${esc(x.id)}">Edit</button><button class="dangerText" data-link-del="${esc(x.id)}">Delete</button></article>`).join('') : '<div class="emptyTemplates">No links saved yet.</div>';
    $$('[data-link-edit]').forEach(b => { b.onclick = () => openLink(readLocal(LINK_KEY).find(x => x.id === b.dataset.linkEdit)); });
    $$('[data-link-del]').forEach(b => { b.onclick = () => { if (confirm('Delete this link?')) { writeLocal(LINK_KEY, readLocal(LINK_KEY).filter(x => x.id !== b.dataset.linkDel)); renderLinks(); } }; });
  }
  // Only http(s) links are ever rendered as clickable (imported backups could contain anything).
  function safeUrl(u) { try { const p = new URL(u); return ['http:', 'https:'].includes(p.protocol) ? p.href : '#'; } catch { return '#'; } }
  function openLink(x = null) {
    editingLinkId = x?.id || null;
    $('#linkModalTitle').textContent = x ? 'Edit Link' : 'Add Link';
    $('#linkName').value = x?.name || '';
    $('#linkUrl').value = x?.url || '';
    $('#linkFavorite').checked = !!x?.favorite;
    $('#linkModal').hidden = false;
    setTimeout(() => $('#linkName').focus(), 0);
  }
  $('#addLink').onclick = () => openLink();
  $('#saveLink').onclick = () => {
    const name = $('#linkName').value.trim(), url = $('#linkUrl').value.trim();
    if (!name || !url) return toast('Please add a name and URL.', 'error');
    let u;
    try { u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); } catch { return toast('Please enter a valid http/https URL.', 'error'); }
    const a = readLocal(LINK_KEY), data = { name, url: u.href, favorite: $('#linkFavorite').checked, updatedAt: Date.now() };
    if (editingLinkId) { const x = a.find(y => y.id === editingLinkId); if (x) Object.assign(x, data); }
    else a.unshift({ id: crypto.randomUUID(), createdAt: Date.now(), ...data });
    writeLocal(LINK_KEY, a);
    $('#linkModal').hidden = true;
    editingLinkId = null;
    renderLinks();
  };
  $('#linkSearch').oninput = renderLinks;

  // ---------- Notes ----------
  const notes = $('#quickNotes');
  notes.value = localStorage.getItem(NOTES_KEY) || '';
  let notesTimer;
  notes.oninput = () => {
    clearTimeout(notesTimer);
    $('#notesStatus').textContent = 'Saving…';
    notesTimer = setTimeout(() => { try { localStorage.setItem(NOTES_KEY, notes.value); $('#notesStatus').textContent = 'Saved locally'; } catch { $('#notesStatus').textContent = 'Could not save (storage full or blocked)'; } }, 250);
  };
  $('#copyNotes').onclick = () => copyText(notes.value, 'Notes copied');
  $('#clearNotes').onclick = () => { if (confirm('Clear quick notes?')) { notes.value = ''; localStorage.removeItem(NOTES_KEY); $('#notesStatus').textContent = 'Cleared'; } };

  // ---------- Queue ----------
  function renderQueue() {
    const all = readLocal(QUEUE_KEY), q = $('#queueSearch').value.trim().toLowerCase(), st = $('#queueStatus').value, pr = $('#queuePriority').value;
    const items = all.filter(c => (!q || `${c.title} ${c.notes || ''} ${c.owner || ''} ${c.modality || ''}`.toLowerCase().includes(q)) && (!st || c.status === st) && (!pr || c.priority === pr) && (!queueDueOnly || isDue(c)));
    items.sort((a, b) => Number(a.status === 'Completed') - Number(b.status === 'Completed') || Number(b.priority === 'Urgent') - Number(a.priority === 'Urgent') || ((a.followup ? new Date(a.followup).getTime() : Infinity) - (b.followup ? new Date(b.followup).getTime() : Infinity)));
    const open = all.filter(c => c.status !== 'Completed'), due = open.filter(isDue);
    $('#queueStats').innerHTML = `<b>${open.length} open • ${due.length} due/overdue • ${open.filter(c => c.priority === 'Urgent').length} urgent</b>`;
    $('#showDue').classList.toggle('active', queueDueOnly);
    $('#showDue').setAttribute('aria-pressed', String(queueDueOnly));
    $('#queueList').innerHTML = items.length ? items.map(c => {
      const checks = c.checklist || [], checked = checks.filter(x => x.done).length;
      return `<article class="listCard queueCard ${isDue(c) ? 'overdue' : ''}"><div class="grow"><div class="queueTitle"><b>${esc(c.title)}</b><span class="statusPill">${esc(c.status)}</span>${c.priority === 'Urgent' ? '<span class="urgentPill">Urgent</span>' : ''}</div><div class="meta">${esc(c.modality || 'General')} • Owner: ${esc(c.owner || 'Unassigned')} • Follow-up: ${esc(fmtDate(c.followup))}${checks.length ? ` • Checklist ${checked}/${checks.length}` : ''}</div>${c.notes ? `<div class="cardNote">${esc(c.notes)}</div>` : ''}${checks.length ? `<div class="caseChecks">${checks.map((x, i) => `<label><input type="checkbox" data-case-check="${esc(c.id)}:${i}" ${x.done ? 'checked' : ''}> ${esc(x.label)}</label>`).join('')}</div>` : ''}</div><button data-case-follow="${esc(c.id)}">Follow-up</button><button data-case-edit="${esc(c.id)}">Edit</button><button data-case-complete="${esc(c.id)}">${c.status === 'Completed' ? 'Reopen' : '✓ Complete'}</button><button class="dangerText" data-case-del="${esc(c.id)}">Delete</button></article>`;
    }).join('') : '<div class="emptyTemplates">No cases match this view.</div>';
    const update = (id, fn) => { const a = readLocal(QUEUE_KEY), c = a.find(x => x.id === id); if (c) { fn(c); c.updatedAt = Date.now(); writeLocal(QUEUE_KEY, a); renderQueue(); } };
    $$('[data-case-check]').forEach(el => { el.onchange = () => { const [id, idx] = el.dataset.caseCheck.split(':'); update(id, c => { if (c.checklist?.[+idx]) c.checklist[+idx].done = el.checked; }); }; });
    $$('[data-case-edit]').forEach(b => { b.onclick = () => openCase(readLocal(QUEUE_KEY).find(x => x.id === b.dataset.caseEdit)); });
    $$('[data-case-follow]').forEach(b => { b.onclick = () => { followCaseId = b.dataset.caseFollow; $('#followInput').value = readLocal(QUEUE_KEY).find(x => x.id === followCaseId)?.followup || ''; $('#followModal').hidden = false; setTimeout(() => $('#followInput').focus(), 0); }; });
    $$('[data-case-complete]').forEach(b => { b.onclick = () => update(b.dataset.caseComplete, c => { c.status = c.status === 'Completed' ? 'New' : 'Completed'; c.completedAt = c.status === 'Completed' ? Date.now() : null; }); });
    $$('[data-case-del]').forEach(b => { b.onclick = () => { if (confirm('Delete this case?')) { writeLocal(QUEUE_KEY, readLocal(QUEUE_KEY).filter(x => x.id !== b.dataset.caseDel)); renderQueue(); } }; });
  }
  const saveFollow = value => { const a = readLocal(QUEUE_KEY), c = a.find(x => x.id === followCaseId); if (c) { c.followup = value; c.updatedAt = Date.now(); writeLocal(QUEUE_KEY, a); } $('#followModal').hidden = true; renderQueue(); };
  $('#followSave').onclick = () => saveFollow($('#followInput').value);
  $('#followClear').onclick = () => saveFollow('');
  function openCase(c = null) {
    editingCaseId = c?.id || null;
    $('#caseModalTitle').textContent = c ? 'Edit Case' : 'Add Case';
    $('#caseTitle').value = c?.title || '';
    $('#caseStatus').value = c?.status || 'New';
    $('#casePriority').value = c?.priority || 'Normal';
    $('#caseOwner').value = c?.owner || '';
    $('#caseModality').value = c?.modality || 'General';
    $('#caseFollowup').value = c?.followup || '';
    $('#caseNotes').value = c?.notes || '';
    $('#caseChecklistType').value = c?.checklistType || '';
    $('#caseModal').hidden = false;
    setTimeout(() => $('#caseTitle').focus(), 0);
  }
  $('#addCase').onclick = () => openCase();
  $('#saveCase').onclick = () => {
    const title = $('#caseTitle').value.trim();
    if (!title) return toast('Add a reference or description.', 'error');
    const a = readLocal(QUEUE_KEY), type = $('#caseChecklistType').value;
    const data = { title, status: $('#caseStatus').value, priority: $('#casePriority').value, owner: $('#caseOwner').value.trim(), modality: $('#caseModality').value, followup: $('#caseFollowup').value, notes: $('#caseNotes').value.trim(), checklistType: type, updatedAt: Date.now() };
    const fresh = () => (checklistTemplates[type] || []).map(label => ({ label, done: false }));
    if (editingCaseId) { const c = a.find(x => x.id === editingCaseId); if (c) { const old = c.checklistType; Object.assign(c, data); if (type !== old) c.checklist = fresh(); } }
    else a.unshift({ id: crypto.randomUUID(), createdAt: Date.now(), checklist: fresh(), ...data });
    writeLocal(QUEUE_KEY, a);
    $('#caseModal').hidden = true;
    editingCaseId = null;
    renderQueue();
  };
  $('#queueSearch').oninput = renderQueue;
  $('#queueStatus').onchange = renderQueue;
  $('#queuePriority').onchange = renderQueue;
  $('#showDue').onclick = () => { queueDueOnly = !queueDueOnly; renderQueue(); };

  // ---------- Handover ----------
  function generateHandover() {
    const q = readLocal(QUEUE_KEY), open = q.filter(c => c.status !== 'Completed'), due = open.filter(isDue);
    const tasks = readLocal(TASK_KEY).filter(t => t.date === todayISO()), pending = tasks.filter(t => !t.done);
    const byStatus = {};
    open.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
    const lines = [`Shift Handover - ${new Date().toLocaleString()}`, '', `Work queue: ${open.length} open | ${due.length} due/overdue | ${open.filter(c => c.priority === 'Urgent').length} urgent`, ...Object.entries(byStatus).map(([k, v]) => `- ${k}: ${v}`), '', `Daily tasks: ${tasks.filter(t => t.done).length}/${tasks.length} completed | ${pending.length} pending`];
    if (due.length) { lines.push('', 'Due / overdue follow-ups:'); due.slice(0, 20).forEach(c => lines.push(`- ${c.title} | ${c.status} | ${c.modality || 'General'} | ${fmtDate(c.followup)}`)); }
    if (pending.length) { lines.push('', 'Pending tasks:'); pending.slice(0, 20).forEach(t => lines.push(`- ${t.priority === 'Urgent' ? 'URGENT - ' : ''}${t.title}${t.time ? ' @ ' + t.time : ''}`)); }
    $('#handoverText').value = lines.join('\n');
  }
  $('#generateHandover').onclick = generateHandover;
  $('#copyHandover').onclick = () => copyText($('#handoverText').value, 'Handover copied');

  // ---------- Dashboard ----------
  function renderDashboard() {
    ensureRecurring();
    const tasks = readLocal(TASK_KEY), today = todayISO(), td = tasks.filter(t => t.date === today), pending = td.filter(t => !t.done);
    const queue = readLocal(QUEUE_KEY), open = queue.filter(c => c.status !== 'Completed'), due = open.filter(isDue);
    const replies = email.store.list();
    const favs = replies.filter(t => t.favorite).slice(0, 6);
    const recent = email.store.recent().slice(0, 4);
    const links = readLocal(LINK_KEY).filter(x => x.favorite).slice(0, 5);
    const replyButtons = list => list.map(t => {
      const needs = renderMessage(t, {}).missing.length;
      return `<div class="dashReply"><span>${esc(t.name)}</span>${needs ? `<button data-open-reply="${esc(t.id)}" title="Has fields to fill in">Fill in…</button>` : `<button class="primary" data-dash-copy="${esc(t.id)}">⧉ Copy</button>`}</div>`;
    }).join('');
    $('#dashboardGrid').innerHTML = `
      <article class="dashCard"><span>PDF Editor</span><strong>📄</strong><p>Fill forms, add text and signatures</p><button data-go="pdf" class="primary">Open PDF Editor</button></article>
      <article class="dashCard"><span>Quick Replies</span><strong>${replies.length}</strong><p>${replies.filter(t => t.favorite).length} favourites</p><button data-go="templates">Open Quick Replies</button></article>
      <article class="dashCard"><span>Email Composer</span><strong>✉</strong><p>Variables, clinic lists, tidy-up tools</p><button data-go="composer">Compose email</button></article>
      <article class="dashCard wide"><span>Favourite replies</span>${favs.length ? replyButtons(favs) : '<p>Star replies in Quick Replies to pin them here.</p>'}</article>
      <article class="dashCard"><span>Recently used</span>${recent.length ? replyButtons(recent) : '<p>Nothing copied yet.</p>'}</article>
      <article class="dashCard"><span>Work Queue</span><strong>${open.length}</strong><p>${due.length} due/overdue • ${open.filter(c => c.priority === 'Urgent').length} urgent</p><button data-go="queue">Open Queue</button></article>
      <article class="dashCard"><span>Today</span><strong>${td.filter(t => t.done).length}/${td.length}</strong><p>tasks completed • ${pending.filter(t => t.priority === 'Urgent').length} urgent pending</p><button data-go="tasks">Open Daily Tasks</button></article>
      <article class="dashCard"><span>Shift handover</span><strong>↗</strong><p>Summarise outstanding work</p><button data-go="handover">Generate Handover</button></article>
      <article class="dashCard wide"><span>Favourite links</span>${links.length ? links.map(x => `<a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>`).join('') : '<p>No favourite links yet.</p>'}<button data-go="links">Manage Links</button></article>
      <article class="dashCard"><span>Quick Notes</span><p>${esc((notes.value || 'No notes saved.').slice(0, 160))}</p><button data-go="notes">Open Notes</button></article>`;
    $$('[data-go]').forEach(b => { b.onclick = () => setAppTab(b.dataset.go); });
    $$('[data-dash-copy]').forEach(b => { b.onclick = () => email.quickCopy(b.dataset.dashCopy, b); });
    $$('[data-open-reply]').forEach(b => { b.onclick = () => { setAppTab('templates'); email.openReply(b.dataset.openReply); }; });
  }

  // ---------- Backup ----------
  const sigStore = createSignatureStore();
  $('#exportBackup').onclick = async () => {
    const includeSigs = confirm('Include signatures saved in the signature library?\n\nOnly do this on an authorised work device. Press Cancel to export without signatures.');
    const data = { app: 'osama-automation', version: 11, createdAt: new Date().toISOString(), storage: {} };
    for (const k of BACKUP_KEYS) { const v = localStorage.getItem(k); if (v !== null) data.storage[k] = v; }
    if (includeSigs) { try { data.signatures = await sigStore.all(); } catch { toast('Saved signatures could not be read; exporting without them.', 'error'); } }
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `osama-automation-backup-${todayISO()}.json`);
  };
  $('#importBackup').onchange = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error();
      const d = JSON.parse(await f.text());
      if (!d.storage || typeof d.storage !== 'object') throw new Error();
      const keys = Object.keys(d.storage).filter(k => k.startsWith('osama-automation-') && typeof d.storage[k] === 'string');
      if (!keys.length) throw new Error();
      if (!confirm(`Import this backup? It will overwrite ${keys.length} matching item(s) of local workspace data${d.signatures?.length ? ` and add ${d.signatures.length} saved signature(s)` : ''}.`)) return;
      for (const k of keys) localStorage.setItem(k, d.storage[k]);
      for (const s of Array.isArray(d.signatures) ? d.signatures : []) if (s?.id && safeImageSrc(s.src)) await sigStore.put({ id: String(s.id), name: String(s.name || 'Signature'), src: s.src, createdAt: s.createdAt || Date.now() });
      toast('Backup restored. Reloading…');
      setTimeout(() => location.reload(), 700);
    } catch { toast('This does not look like a valid Osama Automation backup.', 'error'); }
  };

  // ---------- Search ----------
  let searchTimer;
  $('#globalSearch').oninput = e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim().toLowerCase();
    if (!q) { $('#searchModal').hidden = true; return; }
    searchTimer = setTimeout(() => {
      const results = [];
      email.store.list().forEach(x => { if (`${x.name} ${x.body} ${x.subject || ''} ${x.category}`.toLowerCase().includes(q)) results.push({ type: 'Reply', title: x.name, tab: 'templates', id: x.id }); });
      readLocal(TASK_KEY).forEach(x => { if (`${x.title} ${x.notes || ''}`.toLowerCase().includes(q)) results.push({ type: 'Task', title: x.title, tab: 'tasks' }); });
      readLocal(LINK_KEY).forEach(x => { if (`${x.name} ${x.url}`.toLowerCase().includes(q)) results.push({ type: 'Link', title: x.name, tab: 'links' }); });
      readLocal(QUEUE_KEY).forEach(x => { if (`${x.title} ${x.notes || ''} ${x.owner || ''}`.toLowerCase().includes(q)) results.push({ type: 'Case', title: x.title, tab: 'queue' }); });
      email.loadSnippets().forEach(x => { if (`${x.name} ${x.body}`.toLowerCase().includes(q)) results.push({ type: 'Snippet', title: x.name, tab: 'composer' }); });
      $('#searchResults').innerHTML = results.length ? results.slice(0, 50).map(r => `<button class="searchResult" data-search-go="${r.tab}" data-search-id="${esc(r.id || '')}"><b>${esc(r.type)}</b><span>${esc(r.title)}</span></button>`).join('') : '<div class="emptyTemplates">No matches.</div>';
      $('#searchModal').hidden = false;
      $$('[data-search-go]').forEach(b => { b.onclick = () => { $('#searchModal').hidden = true; $('#globalSearch').value = ''; setAppTab(b.dataset.searchGo); if (b.dataset.searchId) email.openReply(b.dataset.searchId); }; });
    }, 180);
  };

  // ---------- Preferences ----------
  function applyPrefs() {
    const p = readLocal(PREF_KEY, {});
    document.body.classList.toggle('dark', !!p.dark);
    document.body.classList.toggle('compact', !!p.compact);
    $('#themeToggle').textContent = p.dark ? '☀' : '◐';
    $('#themeToggle').setAttribute('aria-pressed', String(!!p.dark));
    $('#compactToggle').classList.toggle('active', !!p.compact);
    $('#compactToggle').setAttribute('aria-pressed', String(!!p.compact));
  }
  const togglePref = k => { const p = readLocal(PREF_KEY, {}); p[k] = !p[k]; writeLocal(PREF_KEY, p); applyPrefs(); };
  $('#themeToggle').onclick = () => togglePref('dark');
  $('#compactToggle').onclick = () => togglePref('compact');
  applyPrefs();

  return { renderTasks, renderLinks, renderQueue, generateHandover, renderDashboard };
}
