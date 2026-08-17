#!/usr/bin/env node
/**
 * Rapor uretici — komut satiri sarmalayicisi.
 *
 * Arsivlenen bpa_report.py'nin yerini alir, ancak AYNI web/lib/report.js'i
 * kullanir. Boylece ikinci bir kopya olusmaz: tarayici ve CLI tek kaynaktan
 * beslenir, ayrisma imkansizdir.
 *
 * KULLANIM
 *     node tools/render.mjs <bpa_raw.json> [--lang tr|en|ru] [--out dosya.html]
 *     node tools/render.mjs <bpa_raw.json> --all      # uc dilde birden
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { renderReport } from '../web/lib/report.js';

const argv = process.argv.slice(2);
const src = argv.find(a => !a.startsWith('--'));
if (!src) {
  console.error('Kullanim: node tools/render.mjs <bpa_raw.json> [--lang tr|en|ru] [--out x.html] [--all]');
  process.exit(1);
}
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const report = JSON.parse(readFileSync(src, 'utf8'));
const dm = report._device_metadata || {};
const host = (dm.hostname || report.information?.device_hostname || 'report')
  .replace(/[^A-Za-z0-9_.-]/g, '_');
const model = (dm.model || '').replace(/[^A-Za-z0-9_.-]/g, '_');
const stem = [model, host].filter(Boolean).join('_');

const langs = argv.includes('--all') ? ['en', 'tr', 'ru'] : [flag('lang', 'en')];

for (const lang of langs) {
  const out = (langs.length === 1 && flag('out'))
    || `${stem}_${lang.toUpperCase()}.html`;
  const html = renderReport(report, lang);
  writeFileSync(out, html, 'utf8');
  const pages = (html.match(/class="page"/g) || []).length;
  console.log(`  ${basename(out).padEnd(38)} ${lang}  ${pages} sayfa  ${(html.length / 1024).toFixed(0)} KB`);
}
