# Osama Automation Test V10

Local-first radiology workflow workspace. No login system and no external-system integration are included.

## Included
- Dashboard with queue, tasks, templates, links and quick actions
- PDF Editor with existing-text editing, movable/resizable text and signatures, vector check/X/radio marks, undo/redo, thumbnails, recovery and a pre-save human review checklist
- Email Templates plus Email Composer with placeholders and reusable snippets
- Daily Tasks with recurring tasks, priorities, carry-forward and history
- Radiology Work Queue with status, priority, owner, modality, follow-up due dates and workflow checklists
- Shift Handover generator from queue/tasks
- Universal workspace search
- Quick Links and Quick Notes
- Dark mode and compact mode
- Local JSON backup/restore; signature inclusion is optional

## Privacy
The app is local-first and does not add a backend, login, analytics, or cloud document storage. PDFs and workspace data remain in the browser. Do not store patient-identifiable information in local workspace modules unless your organisation has explicitly approved that workflow.

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

Vite targets `esnext` because MuPDF WASM uses top-level await.
