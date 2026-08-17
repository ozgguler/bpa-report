import { extractFromTsf } from '../lib/tsf.js';
import { buildMetadata } from '../lib/metadata.js';
import { BpaClient, ERROR_TEXT } from '../lib/api.js';
import { openReport } from '../lib/report.js';

const $ = id => document.getElementById(id);

// --- Tarayici uyumlulugu ---
// TSF acma DecompressionStream'e dayanir (Chrome/Edge 80+, Firefox 113+,
// Safari 16.4+). Desteklenmiyorsa TSF yolu kapali ama config XML yolu ACIK —
// kullaniciya bunu net soylemek gerekir, sessizce basarisiz olmamali.
if (typeof DecompressionStream === 'undefined') {
  const el = $('compat');
  el.hidden = false;
  el.innerHTML = '<b>This browser cannot open Tech Support Files.</b> TSF support requires ' +
    'Chrome/Edge 80+, Firefox 113+ or Safari 16.4+. ' +
    'You can still upload a configuration XML.';
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => n >= 1048576 ? (n/1048576).toFixed(1)+' MB' : (n/1024).toFixed(1)+' KB';

// --- Rapor dili ---
// Arayuz Ingilizce; rapor TR/EN/RU olabilir. Secim rapor ACILIRKEN okunur,
// boylece kullanici sonuc geldikten sonra da dili degistirip yeniden acabilir.
const LANG_NAME = { en: 'English', tr: 'Türkçe', ru: 'Русский' };
const reportLang = () =>
  document.querySelector('input[name="lang"]:checked')?.value || 'en';

let configText = null, metadata = null;

const STEPS = [
  ['extract', 'Extracting configuration'],
  ['auth',    'Authenticating'],
  ['task',    'Creating assessment job'],
  ['upload',  'Uploading configuration'],
  ['poll',    'Assessment running'],
  ['download','Downloading result'],
];

function renderSteps(state) {
  $('steps').innerHTML = STEPS.map(([k, label]) => {
    const s = state[k] || {};
    return `<li><span class="dot ${esc(s.cls || '')}"></span>
      <span>${esc(label)}${s.note ? ` — ${esc(s.note)}` : ''}</span>
      <span class="t">${esc(s.t || '')}</span></li>`;
  }).join('');
}

// Tarayicinin varsayilan davranisi bir dosya birakildiginda onu SAYFA OLARAK
// ACMAKTIR. Yalnizca birakma kutusunda engellemek yetmez — kutunun birkac
// piksel disina birakilinca Safari file:// adresine gider. Bu yuzden olay
// belge genelinde engellenir ve sayfanin TAMAMI birakma hedefi yapilir.
let dragDepth = 0;
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragenter') dragDepth++;
  $('drop').classList.add('over');
}));
document.addEventListener('dragleave', e => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('over'); }
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) load(f);
});

$('drop').onclick = () => $('file').click();
$('file').onchange = () => $('file').files[0] && load($('file').files[0]);

async function load(file) {
  if (!file) return;
  $('meta').innerHTML = '<p class="sub" style="margin:12px 0 0">Reading…</p>';
  try {
    const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    let res;
    if (magic[0] === 0x1f && magic[1] === 0x8b) {
      res = await extractFromTsf(file);
      configText = res.configText;
    } else {
      configText = await file.text();
      res = { configText, sysinfoText: null, sysinfoPath: null, configPath: file.name,
              ms: 0, unpacked: file.size, files: 1 };
    }
    metadata = buildMetadata(res);
    $('drop').classList.add('has');
    $('drop').textContent = `${file.name} · ${fmt(file.size)}`;

    const miss = metadata.missing.length
      ? `<div class="warnbox">Could not extract these fields from the file:
         ${metadata.missing.map(m => `<code>${esc(m)}</code>`).join(' ')} — they must be entered manually.</div>`
      : '';
    $('meta').innerHTML = `<dl style="margin-top:14px">
      <dt>Config</dt><dd><code>${esc(res.configPath)}</code> · ${fmt(configText.length)}</dd>
      <dt>hostname</dt><dd>${esc(metadata.hostname) || '—'}</dd>
      <dt>model / family</dt><dd>${esc(metadata.model) || '—'} / ${esc(metadata.family) || '—'}</dd>
      <dt>serial</dt><dd>${esc(metadata.serial) || '—'}</dd>
      <dt>PAN-OS</dt><dd>${esc(metadata.version) || '—'}</dd>
      ${res.ms ? `<dt>Extraction time</dt><dd class="ok">${res.ms} ms</dd>` : ''}
    </dl>${miss}`;
    check();
  } catch (e) {
    $('meta').innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function check() {
  $('go').disabled = !(configText && $('cid').value && $('sec').value && $('tsg').value);
}
['cid','sec','tsg'].forEach(id => $(id).oninput = check);

$('go').onclick = async () => {
  $('go').disabled = true;
  $('progress').hidden = false;
  $('out').innerHTML = '';
  const state = { extract: { cls: 'ok', t: '✓' } };
  renderSteps(state);

  const t0 = performance.now();
  const client = new BpaClient({
    proxyBase: '',
    onProgress: s => {
      for (const [k] of STEPS) if (state[k]?.cls === 'run') state[k] = { cls: 'ok', t: '✓' };
      state[s.phase] = { cls: 'run',
        note: s.status || s.message || '',
        t: s.elapsed ? `${s.elapsed}s` : '' };
      renderSteps(state);
    },
  });
  client.setCredentials({
    clientId: $('cid').value.trim(),
    clientSecret: $('sec').value,
    tsgId: $('tsg').value.trim(),
  });

  try {
    const { report, taskId, uploadPath } = await client.run({
      configText,
      metadata: { ...metadata,
        requesterEmail: $('mail').value.trim(),
        requesterName: $('name').value.trim() },
    });
    for (const [k] of STEPS) if (!state[k] || state[k].cls === 'run') state[k] = { cls: 'ok', t: '✓' };
    renderSteps(state);

    // Kontrolleri say
    let pass = 0, fail = 0, excl = 0;
    for (const sec of Object.values(report.best_practices || {}))
      for (const ct of Object.values(sec || {}))
        for (const item of (Array.isArray(ct) ? ct : [ct]).filter(Boolean))
          for (const w of (item.warnings || []))
            w.check_excluded ? excl++ : w.check_passed ? pass++ : fail++;
    const score = pass + fail ? (100 * pass / (pass + fail)).toFixed(1) : '0';

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    $('out').innerHTML = `<div class="card"><h2>Result</h2><dl>
      <dt>Total time</dt><dd class="ok">${Math.round((performance.now()-t0)/1000)} s</dd>
      <dt>Job</dt><dd><code>${esc(taskId)}</code></dd>
      <dt>Upload path</dt><dd>${uploadPath === 'direct'
        ? '<span class="ok">direct from browser (GCS CORS open)</span>'
        : 'via relay (GCS CORS closed)'}</dd>
      <dt>Compliance score</dt><dd class="ok">${score}%</dd>
      <dt>Checks</dt><dd>${pass + fail + excl} — compliant ${pass} / non-compliant ${fail} / out of scope ${excl}</dd>
      </dl>
      <div class="actions">
        <button id="rep-open">Open report — ${esc(LANG_NAME[reportLang()])}</button>
        <a href="${url}" download="bpa_${esc(metadata.hostname || 'report')}.json"
           class="dl">Download raw JSON</a>
      </div>
      <p class="sub" style="margin:10px 0 0">The report opens in a new tab. Use
         <b>Save as PDF</b> in the top right to open your browser's print dialog.</p></div>`;
    // Dil, rapor acilirken okunur — kullanici sonuctan sonra da degistirebilir
    $('rep-open').onclick = () => openReport(report, reportLang());
  } catch (e) {
    const msg = ERROR_TEXT.en[e.code] || e.message;
    for (const [k] of STEPS) if (state[k]?.cls === 'run') state[k] = { cls: 'err', t: '✕' };
    renderSteps(state);
    $('out').innerHTML = `<div class="card"><h2>Error</h2><p class="err">${esc(msg)}</p>
      ${e.detail ? `<p class="sub">${esc(e.detail)}</p>` : ''}</div>`;
  } finally {
    client.destroy();          // credential'lari bellekten sil
    $('go').disabled = false;
  }
};

// Dil secimi degistiginde, sonuc ekranindaki dugme etiketini guncel tut
document.getElementById('langs').addEventListener('change', () => {
  const b = document.getElementById('rep-open');
  if (b) b.textContent = `Open report — ${LANG_NAME[reportLang()]}`;
});
