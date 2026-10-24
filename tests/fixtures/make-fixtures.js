// Generates fictional test documents (no real patient data) into tests/fixtures/generated/.
// Run: node tests/fixtures/make-fixtures.js   (also called automatically by the test suites)
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'generated');

async function singlePage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Radiology Request Form (TEST DOCUMENT)', { x: 50, y: 790, size: 16, font });
  page.drawText('Patient name:', { x: 50, y: 740, size: 10, font });
  page.drawText('Jane Example', { x: 130, y: 740, size: 10, font });
  page.drawText('Examination: MRI Knee', { x: 50, y: 715, size: 12, font });
  page.drawText('Referrer: Dr Test Person', { x: 50, y: 690, size: 14, font });
  // Printed checkbox squares.
  page.drawRectangle({ x: 50, y: 640, width: 10, height: 10, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawText('Urgent', { x: 66, y: 641, size: 10, font });
  // A shaded field to check that replacing text keeps backgrounds.
  page.drawRectangle({ x: 48, y: 600, width: 200, height: 18, color: rgb(0.9, 0.93, 1) });
  page.drawText('Clinic: Example Clinic', { x: 52, y: 605, size: 10, font });
  page.drawText('Bold label', { x: 320, y: 740, size: 10, font: await doc.embedFont(StandardFonts.HelveticaBold) });
  const form = doc.getForm();
  const tf = form.createTextField('reference');
  tf.addToPage(page, { x: 50, y: 540, width: 200, height: 20 });
  tf.setText('PREFILLED-001');
  return doc.save();
}

async function multiPage() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('Page 1 portrait', { x: 50, y: 790, size: 14, font });
  const p2 = doc.addPage([841.89, 595.28]); // landscape
  p2.drawText('Page 2 landscape', { x: 50, y: 540, size: 14, font });
  const p3 = doc.addPage([595.28, 841.89]);
  p3.setRotation(degrees(90)); // displayed as landscape
  p3.drawText('Page 3 rotated 90', { x: 50, y: 790, size: 14, font });
  const p4 = doc.addPage([700, 900]);
  p4.setMediaBox(0, 0, 700, 900);
  p4.setCropBox(50, 60, 595, 780); // origin offset
  p4.drawText('Page 4 cropbox offset', { x: 100, y: 780, size: 14, font });
  return doc.save();
}

// Minimal RGBA PNG encoder for a transparent "signature" stroke image.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function signaturePng(w = 300, h = 100) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const yy = h / 2 + Math.sin(x / 18) * (h / 4);
      const on = Math.abs(y - yy) < 3;
      const i = y * (w * 4 + 1) + 1 + x * 4;
      raw[i] = 10; raw[i + 1] = 30; raw[i + 2] = 120; raw[i + 3] = on ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// "Restrict editing" copy: owner password only (opens without a password).
async function restrictedCopy(bytes) {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  return doc.asPDF().saveToBuffer('encrypt=aes-256,owner-password=owner-test,user-password=').asUint8Array();
}

export async function makeFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const restricted = await restrictedCopy(await singlePage());
  const files = {
    'restricted.pdf': restricted,
    'single.pdf': await singlePage(),
    'multi.pdf': await multiPage(),
    'signature.png': signaturePng(),
    'not-a-pdf.pdf': Buffer.from('This is a plain text file pretending to be a PDF.'),
    'broken.pdf': Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF'),
  };
  for (const [name, data] of Object.entries(files)) writeFileSync(join(FIXTURE_DIR, name), data);
  return FIXTURE_DIR;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  makeFixtures().then(d => console.log('Fixtures written to', d, existsSync(d)));
}
