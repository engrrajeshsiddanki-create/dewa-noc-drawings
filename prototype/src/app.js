/* SiteLedger UAE — interactive prototype UI (React 18 + htm, no build step). */
(function () {
'use strict';
const { useState, useMemo, useEffect, useRef, useCallback, Fragment } = React;
const html = htm.bind(React.createElement);
const E = window.Engine;
const { AED, shortAED, fmtDate, round, sum, STAGES } = E;

// ───────────────────────── libraries (lazy) & files ─────────────────────────
const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfworker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};
const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => { delete loaded[src]; rej(new Error('Could not load a library from ' + new URL(src).host + '. Check your connection and try again.')); }; document.head.appendChild(s); });
  return loaded[src];
}
let dlPromise = null;
function getDownloads() { if (!window.claude || !window.claude.use) return Promise.resolve(undefined); if (!dlPromise) dlPromise = window.claude.use('downloads').catch(() => null); return dlPromise; }
async function saveFile(filename, data) {
  const dl = await getDownloads();
  if (dl) { try { await dl.save({ filename, data }); return { ok: true, msg: `${filename} saved.` }; } catch (e) { if (e && e.code === 'declined') return { ok: false, msg: 'Download cancelled.' }; return { ok: false, msg: `Could not save ${filename} (${(e && e.code) || 'error'}).` }; } }
  if (dl === undefined) { const blob = data instanceof Blob ? data : new Blob([data]); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); return { ok: true, msg: `${filename} downloaded.` }; }
  return { ok: false, msg: 'Downloads are not available in this view. Open the artifact on claude.ai to export files.' };
}
let samplePromise = null;
function getSample() { if (!window.claude || !window.claude.use) return Promise.resolve(null); if (!samplePromise) samplePromise = window.claude.use('sample').catch(() => null); return samplePromise; }
const store = { get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };

// generated placeholder "site photo" (clearly an illustration)
const photoCache = new Map();
function genPhoto(seed, label) {
  const key = seed + '|' + label; if (photoCache.has(key)) return photoCache.get(key);
  const c = document.createElement('canvas'); c.width = 480; c.height = 360; const g = c.getContext('2d');
  const h = E.hash01('p' + seed);
  const sky = g.createLinearGradient(0, 0, 0, 360); sky.addColorStop(0, '#9cc7de'); sky.addColorStop(1, '#e9e0cc'); g.fillStyle = sky; g.fillRect(0, 0, 480, 360);
  g.fillStyle = '#d8c7a2'; g.fillRect(0, 290, 480, 70);
  const floors = 3 + Math.floor(h * 3); const bx = 120 + h * 60;
  for (let i = 0; i < floors; i++) { g.fillStyle = i < floors - 1 ? '#b9b6ae' : '#cfcac0'; g.fillRect(bx, 290 - (i + 1) * 36, 220, 34); g.fillStyle = '#6d6a64'; g.fillRect(bx, 290 - (i + 1) * 36 + 30, 220, 4); for (let k = 0; k < 6; k++) { g.fillStyle = '#8a8780'; g.fillRect(bx + 8 + k * 36, 290 - (i + 1) * 36 + 2, 6, 28); } }
  g.strokeStyle = '#d9a21b'; g.lineWidth = 5; g.beginPath(); g.moveTo(bx + 250, 290); g.lineTo(bx + 250, 40); g.lineTo(bx - 60, 40); g.moveTo(bx + 250, 40); g.lineTo(bx + 300, 40); g.stroke();
  g.lineWidth = 1; g.beginPath(); g.moveTo(bx + 40 + h * 80, 40); g.lineTo(bx + 40 + h * 80, 120); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 326, 480, 34); g.fillStyle = '#fff'; g.font = '600 14px sans-serif'; g.fillText('ILLUSTRATION · ' + String(label || '').slice(0, 44), 12, 348);
  const url = c.toDataURL('image/jpeg', 0.8); photoCache.set(key, url); return url;
}
const photoSrc = (ph) => (ph.gen ? genPhoto(ph.seed, ph.caption) : ph.src);
function fileToJpeg(file, max = 1280) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.78)); }; img.onerror = () => rej(new Error('Not an image')); img.src = fr.result; }; fr.onerror = rej; fr.readAsDataURL(file); });
}

// ───────────────────────── state ─────────────────────────
const DEFAULT_PROJECT = { name: 'Al Furjan G+4 Residential Building', code: 'AFR-G4', plot: 'Plot 597-1234 (sample)', contractNo: 'AF/2026/017', client: 'Sample Developer LLC', consultant: 'Sample Engineering Consultants', contractor: 'Sample Contracting LLC', authority: 'DM', startDate: '2026-03-01', durationMonths: 20, dataDate: '2026-11-23', retentionPct: 0.1, retentionCapPct: 0.05, advancePct: 0.1 };
const defaultSettings = () => ({ cal: { ...E.DEFAULT_CAL, offDays: [...E.DEFAULT_CAL.offDays] }, norms: E.DEFAULT_NORMS.map((n) => ({ ...n })), fixed: { ...E.DEFAULT_FIXED }, sched: { ...E.DEFAULT_SCHED } });
function initialState() {
  const saved = store.get('siteledger-v2');
  if (saved && saved.boq && saved.boq.items) return { ...saved, vos: saved.vos || E.SEED_VOS };
  const boq = E.parseRows(E.SAMPLE_BOQ, 'Sample BOQ – Al Furjan G+4.xlsx');
  boq.source = 'sample';
  const s = defaultSettings();
  return { project: { ...DEFAULT_PROJECT }, boq, settings: s, baselineSettings: JSON.parse(JSON.stringify(s)), seedDemo: true, userLogs: [], vos: E.SEED_VOS.map((v) => ({ ...v })), nocOverrides: {}, subOverrides: {}, p6Import: null, baselinedAt: DEFAULT_PROJECT.startDate };
}

// ───────────────────────── small components ─────────────────────────
const pct = (x, dp = 1) => (x * 100).toFixed(dp) + '%';
const sgn = (x) => (x > 0 ? '+' : '') + x;
function Kpi({ label, value, detail, tone }) { return html`<div class=${'kpi ' + (tone || '')}><span class="l">${label}</span><span class="v">${value}</span>${detail && html`<span class="d">${detail}</span>`}</div>`; }
function Chip({ tone = 'neutral', children }) { return html`<span class=${'chip ' + tone}>${children}</span>`; }
const statusTone = (s) => ({ A: 'good', B: 'good', APPROVED: 'good', Approved: 'good', Paid: 'good', Delivered: 'good', Completed: 'good', C: 'crit', D: 'crit', REJECTED: 'crit', Rejected: 'crit', COMMENTS: 'warn', UR: 'info', SUB: 'info', SUBMITTED: 'info', Submitted: 'info', 'Under review': 'info', Certified: 'info', 'In progress': 'info', PREPARING: 'sand', Manufacturing: 'sand', 'Shipped / in transit': 'info' }[s] || 'neutral');
function Panel({ title, sub, actions, children, pad = true, id }) { return html`<section class="panel" id=${id}>${(title || actions) && html`<div class="panel-h"><div><h2>${title}</h2>${sub && html`<div class="sub">${sub}</div>`}</div>${actions && html`<div class="row">${actions}</div>`}</div>`}${pad ? html`<div class="panel-b">${children}</div>` : children}</section>`; }
function Bar({ value, marker, tone }) { return html`<div class="bar" title=${pct(value)}><i style=${{ width: Math.min(100, value * 100) + '%', background: tone }}></i>${marker != null && html`<b style=${{ left: Math.min(100, marker * 100) + '%' }}></b>`}</div>`; }
function SubTabs({ tabs, value, onChange }) { return html`<div class="sub-tabs" role="tablist">${tabs.map(([k, l]) => html`<button key=${k} role="tab" aria-selected=${value === k} onClick=${() => onChange(k)}>${l}</button>`)}</div>`; }
function Seg({ options, value, onChange }) { return html`<div class="seg">${options.map(([k, l]) => html`<button key=${k} aria-pressed=${value === k} onClick=${() => onChange(k)}>${l}</button>`)}</div>`; }

// ───────────────────────── charts ─────────────────────────
function SCurve({ months, bac, cutDay, dataDay, height = 300, compact }) {
  const [hover, setHover] = useState(null); const ref = useRef(null);
  const W = 760, H = height, L = 46, R = 70, T = 14, B = 34; const iw = W - L - R, ih = H - T - B;
  const pts = [{ label: 'Start', pv: 0, ev: 0, ac: 0, endDay: 0 }, ...months];
  const n = pts.length - 1; const x = (i) => L + (i / n) * iw; const y = (v) => T + ih - Math.min(1.08, v / bac) / 1.08 * ih;
  const cut = cutDay ?? dataDay;
  const evPts = pts.map((p, i) => ({ i, p })).filter(({ p, i }) => i === 0 || p.endDay <= cut || (pts[i - 1] && pts[i - 1].endDay < cut));
  const path = (arr, key) => arr.map(({ i, p }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key] ?? 0).toFixed(1)}`).join('');
  const ddIdx = (() => { for (let i = 1; i < pts.length; i++) if (pts[i].endDay >= cut) { const a = pts[i - 1].endDay, b = pts[i].endDay; return i - 1 + (cut - a) / Math.max(1, b - a); } return n; })();
  const evAt = (i) => (i === evPts[evPts.length - 1].i && pts[i].endDay > cut ? null : null);
  void evAt;
  const lastEv = evPts[evPts.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const step = Math.ceil(n / (compact ? 6 : 10));
  const onMove = (e) => { const r = ref.current.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - L) / iw) * n); setHover(i >= 0 && i <= n ? i : null); };
  const hp = hover != null ? pts[hover] : null; const hasEv = hover != null && evPts.some((q) => q.i === hover);
  return html`<div class="chart-wrap">
    <div class="legend" style=${{ marginBottom: '6px' }}><span><i class="ln" style=${{ background: 'var(--s-pv)' }}></i>Planned value (baseline)</span><span><i class="ln" style=${{ background: 'var(--s-ev)' }}></i>Earned value</span><span><i class="ln" style=${{ background: 'var(--s-ac)' }}></i>Actual cost</span><span><i class="ln" style=${{ background: 'var(--sand)' }}></i>Data date</span></div>
    <svg ref=${ref} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="S-curve of cumulative planned value, earned value and actual cost as a percentage of budget" onMouseMove=${onMove} onMouseLeave=${() => setHover(null)}>
      ${ticks.map((t) => html`<g key=${t}><line x1=${L} x2=${W - R} y1=${y(t * bac)} y2=${y(t * bac)} stroke="var(--line-2)" stroke-width="1" /><text x=${L - 8} y=${y(t * bac) + 4} text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t * 100}%</text></g>`)}
      ${pts.map((p, i) => (i > 0 && (i % step === 0 || (i === n && n % step > step / 2))) && html`<text key=${'m' + i} x=${x(i)} y=${H - 12} text-anchor="middle" font-size="10.5" fill="var(--muted)">${p.label}</text>`)}
      <line x1=${x(ddIdx)} x2=${x(ddIdx)} y1=${T} y2=${T + ih} stroke="var(--sand)" stroke-width="1.5" stroke-dasharray="4 3" />
      <path d=${path(pts.map((p, i) => ({ i, p })), 'pv')} fill="none" stroke="var(--s-pv)" stroke-width="2" />
      <path d=${path(evPts, 'ac')} fill="none" stroke="var(--s-ac)" stroke-width="2" />
      <path d=${path(evPts, 'ev')} fill="none" stroke="var(--s-ev)" stroke-width="2" />
      <circle cx=${x(lastEv.i)} cy=${y(lastEv.p.ev)} r="4" fill="var(--s-ev)" stroke="var(--surface)" stroke-width="2" />
      <circle cx=${x(lastEv.i)} cy=${y(lastEv.p.ac)} r="4" fill="var(--s-ac)" stroke="var(--surface)" stroke-width="2" />
      <text x=${x(n) + 6} y=${y(pts[n].pv) + 4} font-size="11" fill="var(--ink-2)">PV 100%</text>
      <text x=${Math.min(x(lastEv.i) + 8, W - R + 4)} y=${y(lastEv.p.ev) + (lastEv.p.ev < lastEv.p.ac ? 14 : -6)} font-size="11" fill="var(--ink-2)">EV ${pct(lastEv.p.ev / bac, 0)}</text>
      ${hp && html`<line x1=${x(hover)} x2=${x(hover)} y1=${T} y2=${T + ih} stroke="var(--ink-2)" stroke-width="1" />`}
    </svg>
    ${hp && html`<div class="tip" style=${{ left: `min(${(x(hover) / W) * 100}% + 12px, calc(100% - 190px))`, top: '30px' }}>
      <b>${hp.label}${hp.endISO ? ' · month end' : ''}</b>
      <div class="tr"><span><i class="sw" style=${{ background: 'var(--s-pv)' }}></i>Planned</span><span class="num">${pct(hp.pv / bac)} · ${shortAED(hp.pv)}</span></div>
      ${hasEv && html`<div class="tr"><span><i class="sw" style=${{ background: 'var(--s-ev)' }}></i>Earned</span><span class="num">${pct(hp.ev / bac)} · ${shortAED(hp.ev)}</span></div>`}
      ${hasEv && html`<div class="tr"><span><i class="sw" style=${{ background: 'var(--s-ac)' }}></i>Actual cost</span><span class="num">${shortAED(hp.ac)}</span></div>`}
    </div>`}
  </div>`;
}

function MonthlyBars({ months, ipcs, dataDay }) {
  const [hover, setHover] = useState(null);
  const W = 760, H = 240, L = 50, R = 10, T = 10, B = 30; const iw = W - L - R, ih = H - T - B;
  const rows = months.map((m) => { const ipc = ipcs.find((i) => i.period === m.label); return { ...m, cert: ipc ? ipc.net : null }; });
  const max = Math.max(...rows.map((r) => Math.max(r.pvMonth, r.evMonth || 0, r.cert || 0))) * 1.1 || 1;
  const bw = iw / rows.length; const gw = Math.max(2, (bw - 6) / 3);
  const y = (v) => T + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return html`<div class="chart-wrap">
    <div class="legend" style=${{ marginBottom: '6px' }}><span><i style=${{ background: 'var(--s-pv)' }}></i>Forecast (baseline PV)</span><span><i style=${{ background: 'var(--s-ev)' }}></i>Earned</span><span><i style=${{ background: 'var(--s-ac)' }}></i>Net certified (IPC)</span></div>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Monthly forecast, earned value and certified amounts" onMouseLeave=${() => setHover(null)}>
      ${ticks.map((t, i) => html`<g key=${i}><line x1=${L} x2=${W - R} y1=${y(t)} y2=${y(t)} stroke="var(--line-2)" /><text x=${L - 6} y=${y(t) + 4} text-anchor="end" font-size="10.5" fill="var(--muted)" font-family="var(--f-mono)">${shortAED(t)}</text></g>`)}
      ${rows.map((r, i) => { const x0 = L + i * bw + 3; const bars = [[r.pvMonth, 'var(--s-pv)'], [r.evMonth, 'var(--s-ev)'], [r.cert, 'var(--s-ac)']]; return html`<g key=${i} onMouseEnter=${() => setHover(i)}>
        <rect x=${L + i * bw} y=${T} width=${bw} height=${ih} fill="transparent" />
        ${bars.map(([v, c], k) => v > 0 && html`<rect key=${k} x=${x0 + k * gw} y=${y(v)} width=${Math.max(1, gw - 2)} height=${Math.max(0, T + ih - y(v))} rx="2" fill=${c} />`)}
        ${(i % Math.ceil(rows.length / 10) === 0) && html`<text x=${L + i * bw + bw / 2} y=${H - 10} text-anchor="middle" font-size="10.5" fill="var(--muted)">${r.label}</text>`}
      </g>`; })}
    </svg>
    ${hover != null && html`<div class="tip" style=${{ left: `min(${((L + hover * (iw / rows.length)) / W) * 100}% + 10px, calc(100% - 190px))`, top: '28px' }}><b>${rows[hover].label}</b>
      <div class="tr"><span>Forecast</span><span class="num">AED ${AED(rows[hover].pvMonth)}</span></div>
      ${rows[hover].evMonth != null && html`<div class="tr"><span>Earned</span><span class="num">AED ${AED(rows[hover].evMonth)}</span></div>`}
      ${rows[hover].cert != null && html`<div class="tr"><span>Net certified</span><span class="num">AED ${AED(rows[hover].cert)}</span></div>`}</div>`}
  </div>`;
}

// ───────────────────────── dashboard ─────────────────────────
function Dashboard({ m, go }) {
  const ev = m.evm; const cal = m.cal;
  const overdue = m.docs.subs.filter((s) => s.overdue).length;
  const nocOpen = m.docs.nocs.filter((n) => n.status !== 'APPROVED').length;
  const stagesRows = STAGES.map((st) => { const f = (i) => i.c.stage === st.no && !i.c.reserve; const bud = sum(m.items.filter(f), (i) => i.amount); return { st, bud, pv: bud ? m.pvAt(m.dataDay, f) / bud : 0, ev: bud ? m.evAt(m.dataDay, f) / bud : 0 }; }).filter((r) => r.bud > 0);
  return html`<${Fragment}>
    <div class="kpis">
      <${Kpi} label="Contract value" value=${'AED ' + shortAED(m.contractSum * 1.05)} detail=${`${AED(m.contractSum)} + 5% VAT`} />
      <${Kpi} label="Physical progress" value=${pct(ev.pctEarned)} detail=${`Planned ${pct(ev.pctPlanned)} at data date`} tone=${ev.pctEarned < ev.pctPlanned * 0.9 ? 'watch' : ''} />
      <${Kpi} label="SPI / CPI" value=${`${ev.spi.toFixed(2)} / ${ev.cpi.toFixed(2)}`} detail=${`SV AED ${shortAED(ev.sv)} · CV AED ${shortAED(ev.cv)}`} tone=${ev.spi < 0.9 ? 'alert' : ev.spi < 0.95 ? 'watch' : ''} />
      <${Kpi} label="Forecast completion" value=${cal.fmt(m.forecastFinish)} detail=${`${sgn(m.finishVarDays)} WD vs baseline · ${sgn(m.contractVarDays)} WD to contract`} tone=${m.contractVarDays < 0 ? 'alert' : m.finishVarDays < -10 ? 'watch' : ''} />
      <${Kpi} label="Estimate at completion" value=${'AED ' + shortAED(ev.eac)} detail=${`VAC AED ${shortAED(ev.vac)}`} tone=${ev.vac < 0 ? 'watch' : ''} />
      <${Kpi} label="Open document actions" value=${String(overdue + nocOpen)} detail=${`${overdue} overdue submittals · ${nocOpen} NOCs open`} />
    </div>
    <div class="grid g-main">
      <${Panel} title="Financial & physical S-curve" sub=${`Cumulative, as % of budget at completion (AED ${AED(m.bac)} excl. VAT & contingency)`}>
        <${SCurve} months=${m.months} bac=${m.bac} dataDay=${m.dataDay} />
      <//>
      <${Panel} title="Recovery & attention" sub="Raised automatically from the P6 update, EVM and document logs" actions=${html`<button class="btn sm" onClick=${() => go('programme', 'recovery')}>Recovery view</button>`}>
        <div class="alerts">
          ${m.recovery.length ? m.recovery.slice(0, 7).map((r, i) => html`<div key=${i} class=${'alert-i ' + (r.level === 'critical' ? 'crit' : '')}><i></i><div><b>${r.title}</b><span>${r.detail}</span></div></div>`) : html`<div class="empty">No triggers. Programme and cost are within thresholds.</div>`}
          ${overdue > 0 && html`<div class="alert-i"><i></i><div><b>${overdue} submittals past their required approval date</b><span>Required date is the BOQ item's baseline start minus the review and procurement lead time. <a href="#docs" onClick=${(e) => { e.preventDefault(); go('docs', 'subs'); }}>Open the submittal log</a></span></div></div>`}
        </div>
      <//>
    </div>
    <${Panel} title="Lifecycle progress by stage" sub="Earned vs planned at the data date. The black tick marks the planned position." actions=${html`<button class="btn sm" onClick=${() => go('lifecycle')}>Open tracker</button>`}>
      <div class="tw"><table class="t"><thead><tr><th>Stage</th><th class="r">Budget AED</th><th style=${{ minWidth: '180px' }}>Earned vs planned</th><th class="r">Earned</th><th class="r">Planned</th><th>Status</th></tr></thead><tbody>
        ${stagesRows.map(({ st, bud, pv, ev }) => html`<tr key=${st.no}><td><span class="mono muted">${String(st.no).padStart(2, '0')}</span> ${st.name}</td><td class="r">${AED(bud)}</td><td><${Bar} value=${ev} marker=${pv} /></td><td class="r">${pct(ev, 0)}</td><td class="r">${pct(pv, 0)}</td><td>${ev >= 0.999 ? html`<${Chip} tone="good">Complete<//>` : pv === 0 && ev === 0 ? html`<${Chip}>Not started<//>` : ev < pv - 0.08 ? html`<${Chip} tone="crit">Behind ${pct(pv - ev, 0)}<//>` : ev < pv - 0.02 ? html`<${Chip} tone="warn">Slight lag<//>` : html`<${Chip} tone="info">On track<//>`}</td></tr>`)}
      </tbody></table></div>
    <//>
  <//>`;
}

// ───────────────────────── BOQ ingest ─────────────────────────
function BoqView({ state, setState, m, toast }) {
  const [drag, setDrag] = useState(false); const [busy, setBusy] = useState(''); const [filter, setFilter] = useState(''); const [stageF, setStageF] = useState('all'); const [ai, setAi] = useState(null);
  const boq = state.boq; const fileRef = useRef(null);
  useEffect(() => { getSample().then((s) => setAi((a) => a || (s ? 'ready' : 'off'))); }, []);
  const apply = (parsed, source) => { parsed.source = source; setState((s) => ({ ...s, boq: parsed, nocOverrides: {}, subOverrides: {}, p6Import: null })); toast(`${parsed.items.length} BOQ items parsed. WBS, P6 programme, budget, cash flow, submittals and NOCs regenerated.`); };
  const handleFile = async (file) => {
    if (!file) return; const name = file.name; const ext = name.split('.').pop().toLowerCase();
    try {
      if (['xlsx', 'xls', 'csv', 'xlsm'].includes(ext)) {
        setBusy('Reading workbook…'); await loadScript(LIBS.xlsx);
        const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: 'array' });
        let best = null; for (const sn of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }); const p = E.parseRows(rows, name); p.sheet = sn; if (!best || p.items.length > best.items.length) best = p; }
        if (!best || !best.items.length) throw new Error('No priced line items found. The sheet needs Description, Unit, Qty and Rate columns.');
        best.log.unshift(`Workbook "${name}": ${wb.SheetNames.length} sheet(s); used "${best.sheet}".`); apply(best, 'upload');
      } else if (ext === 'pdf') {
        setBusy('Extracting text from PDF…'); await loadScript(LIBS.pdfjs); window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfworker;
        const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; const lines = [];
        for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); const rows = new Map(); tc.items.forEach((it) => { const yk = Math.round(it.transform[5] / 3); if (!rows.has(yk)) rows.set(yk, []); rows.get(yk).push({ x: it.transform[4], s: it.str }); }); [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, arr]) => lines.push(arr.sort((a, b) => a.x - b.x).map((q) => q.s).join(' ').replace(/\s+/g, ' ').trim())); }
        const parsed = E.parseRows(E.parsePdfLines(lines), name); parsed.log.unshift(`PDF "${name}": ${doc.numPages} page(s), ${lines.length} text lines read.`);
        if (!parsed.items.length) throw new Error('No BOQ rows recognised in this PDF. Scanned PDFs need OCR; export the BOQ to Excel if you can.');
        apply(parsed, 'upload');
      } else throw new Error('Use an .xlsx, .xls, .csv or .pdf file.');
    } catch (e) { toast(e.message || String(e)); } finally { setBusy(''); }
  };
  const downloadSample = async () => { try { await loadScript(LIBS.xlsx); const ws = XLSX.utils.aoa_to_sheet(E.SAMPLE_BOQ.map((r) => r.slice(0, 6))); const rowsN = E.SAMPLE_BOQ.length; for (let r = 0; r < rowsN; r++) { const row = E.SAMPLE_BOQ[r]; if (row.length >= 5 && typeof row[3] === 'number') ws[XLSX.utils.encode_cell({ r, c: 5 })] = { t: 'n', f: `D${r + 1}*E${r + 1}` }; } ws['!cols'] = [{ wch: 7 }, { wch: 78 }, { wch: 7 }, { wch: 9 }, { wch: 12 }, { wch: 14 }]; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BOQ'); const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); const r = await saveFile('Sample_BOQ_AlFurjan_G+4.xlsx', new Blob([out])); toast(r.msg); } catch (e) { toast(e.message); } };
  const setStage = (id, st) => setState((s) => ({ ...s, boq: { ...s.boq, items: s.boq.items.map((it) => (it.id === id ? { ...it, stageOverride: st === it.cls.stage ? undefined : st, overrideSource: 'User' } : it)) } }));
  const lowConf = m.items.filter((i) => i.c.conf < 0.7);
  const askClaude = async () => {
    const sample = await getSample(); if (!sample) { toast('Claude mapping is only available when this page is open on claude.ai.'); return; }
    const targets = lowConf.length ? lowConf : m.items.slice(0, 0);
    if (!targets.length) { toast('Every item already has a high-confidence rule match.'); return; }
    setAi('busy');
    const prompt = `You are a UAE construction planning engineer. Map each Bill of Quantities line item to exactly one of these 16 lifecycle stages:\n${STAGES.map((s) => `${s.no}. ${s.name}: ${s.desc}`).join('\n')}\n\nItems (JSON):\n${JSON.stringify(targets.map((i) => ({ ref: i.ref, description: i.desc, unit: i.unit, bill: i.division })))}\n\nReply with only a JSON array: [{"ref": "...", "stage": <1-16>, "reason": "<max 12 words>"}].`;
    try { const res = await sample.json(prompt, { modelTier: 'quick' }); const map = new Map((Array.isArray(res) ? res : []).map((r) => [String(r.ref), r])); let n = 0; setState((s) => ({ ...s, boq: { ...s.boq, items: s.boq.items.map((it) => { const r = map.get(it.ref); if (r && r.stage >= 1 && r.stage <= 16) { n++; return { ...it, stageOverride: Number(r.stage), overrideSource: 'Claude', aiReason: r.reason }; } return it; }) } })); toast(`Claude mapped ${map.size} item(s). Review them in the table.`); setAi('ready'); }
    catch (e) { setAi('ready'); toast(e && e.code === 'not_granted' ? 'Claude access was declined for this page.' : `Claude could not map the items (${(e && e.code) || 'error'}).`); }
  };
  const rows = m.items.filter((i) => (stageF === 'all' || String(i.c.stage) === stageF) && (!filter || (i.ref + ' ' + i.desc + ' ' + i.division).toLowerCase().includes(filter.toLowerCase())));
  const steps = [['Read file', boq.fileName], ['Detect header', boq.columnMap ? Object.keys(boq.columnMap).length + ' columns mapped' : '—'], ['Extract items', `${boq.items.length} items · ${boq.divisions.length} bills`], ['Validate', `${boq.warnings.length} warning(s)`], ['Classify to 16 stages', `${m.items.filter((i) => i.c.conf >= 0.7).length} rule · ${lowConf.length} low`], ['Generate project', `${m.acts.length} activities · ${m.docs.subs.length} submittals`]];
  return html`<${Fragment}>
    <div class="grid g-main">
      <${Panel} title="Upload a Bill of Quantities" sub="Excel (.xlsx/.xls), CSV or text-based PDF. Every line item is parsed and mapped to the UAE lifecycle.">
        <div class=${'drop' + (drag ? ' on' : '')} onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)} onDrop=${(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}>
          <b style=${{ fontFamily: 'var(--f-display)', fontSize: '16px' }}>${busy || 'Drop a BOQ file here'}</b>
          <span class="note">Columns are detected automatically: Item / Description / Unit / Qty / Rate / Amount (AED). Bill headings become divisions; totals rows are skipped.</span>
          <div class="row" style=${{ justifyContent: 'center' }}>
            <button class="btn primary" onClick=${() => fileRef.current.click()} disabled=${!!busy}>Choose file</button>
            <button class="btn" onClick=${() => apply(Object.assign(E.parseRows(E.SAMPLE_BOQ, 'Sample BOQ – Al Furjan G+4.xlsx')), 'sample')}>Load sample villa/building BOQ</button>
            <button class="btn ghost" onClick=${downloadSample}>Download sample as .xlsx</button>
          </div>
          <input ref=${fileRef} id="boq-file" type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf" hidden onChange=${(e) => { handleFile(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <div class="row" style=${{ marginTop: '12px', justifyContent: 'space-between' }}>
          <label class="check"><input type="checkbox" id="seed-demo" checked=${state.seedDemo} onChange=${(e) => setState((s) => ({ ...s, seedDemo: e.target.checked }))} /> Simulate progress history up to the data date (demo)</label>
          <span class="note">Source: <b>${boq.source === 'sample' ? 'Sample BOQ (illustrative rates)' : boq.fileName}</b></span>
        </div>
      <//>
      <${Panel} title="Contract value" sub="Calculated from the parsed BOQ">
        <dl class="kv">
          <dt>Measured & lump-sum work</dt><dd class="num">AED ${AED(sum(m.items.filter((i) => !i.ps), (i) => i.amount))}</dd>
          <dt>Provisional sums</dt><dd class="num">AED ${AED(sum(m.items.filter((i) => i.ps && !i.c.reserve), (i) => i.amount))}</dd>
          <dt>Contingency (reserve)</dt><dd class="num">AED ${AED(m.reserve)}</dd>
          <dt><b>Contract sum excl. VAT</b></dt><dd class="num"><b>AED ${AED(m.contractSum)}</b></dd>
          <dt>VAT 5%</dt><dd class="num">AED ${AED(m.contractSum * 0.05)}</dd>
          <dt><b>Total incl. VAT</b></dt><dd class="num"><b>AED ${AED(m.contractSum * 1.05)}</b></dd>
          <dt>Baseline budget (BAC)</dt><dd class="num">AED ${AED(m.bac)} <span class="muted">(excl. reserve)</span></dd>
        </dl>
      <//>
    </div>
    <${Panel} title="Ingestion pipeline" sub=${boq.log.join(' ')}>
      <div class="pipe">${steps.map(([t, s], i) => html`<div key=${i} class="ok"><span class="st">STEP ${i + 1} ✓</span><b>${t}</b><span class="muted">${s}</span></div>`)}</div>
      ${boq.warnings.length > 0 && html`<ul class="warnline" style=${{ margin: '10px 0 0', paddingLeft: '18px' }}>${boq.warnings.slice(0, 8).map((w, i) => html`<li key=${i}>${w}</li>`)}</ul>`}
    <//>
    <${Panel} pad=${false} title="Parsed line items & lifecycle mapping" sub="Change a stage to override the rule. The WBS, P6 activities, budget and document logs update immediately."
      actions=${html`<input class="inp sm" id="boq-search" placeholder="Search ref or description" value=${filter} onInput=${(e) => setFilter(e.target.value)} style=${{ width: '200px' }} />
        <select class="inp sm" id="boq-stage" value=${stageF} onChange=${(e) => setStageF(e.target.value)} style=${{ width: 'auto' }}><option value="all">All stages</option>${STAGES.map((s) => html`<option key=${s.no} value=${s.no}>${s.no}. ${s.name}</option>`)}</select>
        ${ai !== 'off' && html`<button class="btn sm" disabled=${ai === 'busy'} onClick=${askClaude} title="Sends the low-confidence item descriptions to Claude for stage mapping">${ai === 'busy' ? 'Asking Claude…' : `Ask Claude to map ${lowConf.length} low-confidence item${lowConf.length === 1 ? '' : 's'}`}</button>`}`}>
      <div class="tw scroll-y"><table class="t"><thead><tr><th>Ref</th><th>Description</th><th>Bill / division</th><th>Unit</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount AED</th><th>Lifecycle stage</th><th>Mapped by</th><th>Generated docs</th></tr></thead><tbody>
        ${rows.map((it) => html`<tr key=${it.id}><td class="mono">${it.ref}</td><td class="desc">${it.desc}${it.ps && html` <${Chip} tone="sand">${it.c.reserve ? 'Reserve' : 'Prov. sum'}<//>`}${it.c.longLead && html` <${Chip} tone="warn">Long lead<//>`}</td><td class="muted" style=${{ fontSize: '12px' }}>${it.division}</td><td>${it.unit}</td><td class="r">${AED(it.qty, it.qty % 1 ? 2 : 0)}</td><td class="r">${AED(it.rate, 2)}</td><td class="r">${AED(it.amount)}</td>
          <td><select class="inp sm" id=${'st-' + it.id} value=${it.c.stage} onChange=${(e) => setStage(it.id, Number(e.target.value))} style=${{ minWidth: '170px' }}>${STAGES.map((s) => html`<option key=${s.no} value=${s.no}>${s.no}. ${s.name}</option>`)}</select></td>
          <td>${it.c.source === 'Claude' ? html`<${Chip} tone="info" title=${it.aiReason}>Claude<//>` : it.c.source === 'User' ? html`<${Chip} tone="info">User<//>` : it.c.conf >= 0.9 ? html`<${Chip} tone="good">Rule ${Math.round(it.c.conf * 100)}%<//>` : html`<${Chip} tone=${it.c.conf >= 0.6 ? 'warn' : 'crit'}>${it.c.source} ${Math.round(it.c.conf * 100)}%<//>`}</td>
          <td class="mono" style=${{ fontSize: '11.5px' }}>${(it.c.docs || '').split('').map((f) => ({ M: 'MAR', S: 'SD', D: 'MS', I: 'ITP', W: 'WIR', P: 'PLN', H: 'HOD' }[f])).join(' · ') || '—'}</td></tr>`)}
      </tbody></table></div>
    <//>
  <//>`;
}

// ───────────────────────── lifecycle & budget tracker ─────────────────────────
function LifecycleView({ m }) {
  const [open, setOpen] = useState(() => new Set([5]));
  const toggle = (n) => setOpen((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const d = m.dataDay; const cal = m.cal;
  return html`<${Panel} pad=${false} title="Master lifecycle, quantities & budget tracker" sub=${`Budgeted vs executed vs remaining quantity, and budget vs earned vs actual cost, at data date ${fmtDate(cal.date(d))}. Click a stage to expand its BOQ items.`}>
    <div class="stage-row" style=${{ cursor: 'default', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', fontWeight: 600 }}><span>#</span><span>Stage</span><span class="hide-m">Baseline window (P6)</span><span class="hide-m" style=${{ textAlign: 'right' }}>Budget AED</span><span class="hide-m">Earned / planned</span><span style=${{ textAlign: 'right' }}>CPI</span></div>
    ${STAGES.map((st) => {
      const its = m.items.filter((i) => i.c.stage === st.no && !i.c.reserve); const acts = m.acts.filter((a) => a.wbs === st.no && a.bl.es != null);
      const bud = sum(its, (i) => i.amount); const pv = m.pvAt(d, (i) => i.c.stage === st.no && !i.c.reserve); const ev = m.evAt(d, (i) => i.c.stage === st.no && !i.c.reserve); const ac = m.acAt(d, (i) => i.c.stage === st.no && !i.c.reserve);
      const s = acts.length ? Math.min(...acts.map((a) => a.bl.es)) : null; const e = acts.length ? Math.max(...acts.map((a) => a.bl.ef)) : null;
      const isOpen = open.has(st.no);
      return html`<div class="stage" key=${st.no}>
        <div class="stage-row" onClick=${() => toggle(st.no)} role="button" aria-expanded=${isOpen} tabindex="0" onKeyDown=${(ev2) => (ev2.key === 'Enter' || ev2.key === ' ') && (ev2.preventDefault(), toggle(st.no))}>
          <span class="stage-no">${String(st.no).padStart(2, '0')}</span>
          <div><h3>${st.name} <span class="muted" style=${{ fontWeight: 400, fontSize: '12px' }}>${isOpen ? '▾' : '▸'} ${its.length} items · ${acts.length} activities</span></h3><div class="sd">${st.desc}</div></div>
          <span class="hide-m mono" style=${{ fontSize: '12px' }}>${s != null ? `${cal.fmt(s)} → ${cal.fmt(e)}` : '—'}</span>
          <span class="hide-m num" style=${{ textAlign: 'right' }}>${bud ? AED(bud) : '—'}</span>
          <div class="hide-m dual">${bud ? html`<${Bar} value=${ev / bud} marker=${pv / bud} /><span class="note">${pct(ev / bud, 0)} earned · ${pct(pv / bud, 0)} planned</span>` : html`<span class="note">Management / authority activities</span>`}</div>
          <span class="num" style=${{ textAlign: 'right', color: ac && ev / ac < 0.97 ? 'var(--crit)' : 'inherit' }}>${ac ? (ev / ac).toFixed(2) : '—'}</span>
        </div>
        ${isOpen && its.length > 0 && html`<div class="tw" style=${{ padding: '0 16px 14px' }}><table class="t"><thead><tr><th>Ref</th><th>Description</th><th>Unit</th><th class="r">BOQ qty</th><th class="r">Executed</th><th class="r">Remaining</th><th style=${{ minWidth: '110px' }}>Progress</th><th class="r">Budget AED</th><th class="r">Earned (EV)</th><th class="r">Actual (AC)</th><th class="r">CV</th><th class="r">Planned (PV)</th></tr></thead><tbody>
          ${its.map((it) => { const q = m.execQtyAt(it, d); const evv = Math.min(q, it.qty * 1.5) * it.rate; const acv = m.acAt(d, (x) => x.id === it.id); const pvv = it.amount * m.plannedFrac(it, d); const dp = it.unit === 'LS' || it.unit === 'PS' || it.unit === 'month' ? 2 : 0;
            return html`<tr key=${it.id}><td class="mono">${it.ref}</td><td class="desc">${it.desc}</td><td>${it.unit}</td><td class="r">${AED(it.qty, dp)}</td><td class="r">${AED(q, dp)}</td><td class="r">${AED(Math.max(0, it.qty - q), dp)}</td><td><${Bar} value=${q / it.qty} marker=${m.plannedFrac(it, d)} /></td><td class="r">${AED(it.amount)}</td><td class="r">${AED(evv)}</td><td class="r">${AED(acv)}</td><td class="r" style=${{ color: evv - acv < 0 ? 'var(--crit)' : 'inherit' }}>${AED(evv - acv)}</td><td class="r">${AED(pvv)}</td></tr>`; })}
          <tr class="total"><td></td><td>Stage total</td><td></td><td></td><td></td><td></td><td></td><td class="r">${AED(bud)}</td><td class="r">${AED(ev)}</td><td class="r">${AED(ac)}</td><td class="r">${AED(ev - ac)}</td><td class="r">${AED(pv)}</td></tr>
        </tbody></table></div>`}
        ${isOpen && !its.length && html`<div class="note" style=${{ padding: '0 16px 14px 62px' }}>No priced BOQ items in this stage. Its activities (approvals, milestones, procurement) are scheduled in the P6 programme.</div>`}
      </div>`;
    })}
  <//>`;
}

// ───────────────────────── P6 programme ─────────────────────────
function Gantt({ m, rows, zoom, showBL, sel, onSel }) {
  const cal = m.cal; const px = zoom === 'week' ? 7 : zoom === 'quarter' ? 1.1 : 2.6;
  const dated = rows.filter((r) => r.a && r.a.cur.es != null);
  const minD = Math.min(0, ...dated.map((r) => Math.min(r.a.cur.es, r.a.bl.es ?? Infinity))) - 7;
  const maxD = Math.max(m.finishBy, ...dated.filter((r) => r.a.wbs !== 15).map((r) => Math.max(r.a.cur.ef, r.a.bl.ef ?? 0))) + 30;
  const W = (maxD - minD) * px; const X = (d) => (d - minD) * px;
  const months = []; { const s = new Date(cal.date(minD)); let k = 0; for (;;) { const ms = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, 1); const d = cal.dayOf(ms); if (d > maxD) break; if (d >= minD) months.push({ d, label: `${E.MONTHS[new Date(ms).getUTCMonth()]} ${String(new Date(ms).getUTCFullYear()).slice(2)}` }); k++; } }
  return html`<div class="gantt">
    <div class="g-row head"><div class="g-left" style=${{ fontWeight: 600, color: 'var(--muted)', fontSize: '10.5px', textTransform: 'uppercase' }}><div>Activity ID</div><div>Activity name</div><div class="r opt">OD</div><div class="r opt">RD</div><div class="r opt">%</div><div class="opt">Start</div><div class="opt">Finish</div><div class="r">TF</div><div class="r opt">FV</div></div>
      <div class="g-time" style=${{ width: W + 'px' }}>${months.map((mo) => html`<div key=${mo.d} class="g-mo" style=${{ left: X(mo.d) + 'px', width: (zoom === 'quarter' ? 34 : 31 * px) + 'px' }}>${zoom === 'quarter' && new Date(cal.date(mo.d)).getUTCMonth() % 3 ? '' : mo.label}</div>`)}</div></div>
    ${rows.map((r) => {
      if (r.wbs) return html`<div key=${'w' + r.wbs.no} class="g-row wbs"><div class="g-left"><div class="mono">${String(r.wbs.no).padStart(2, '0')}.${r.wbs.code}</div><div>${r.wbs.name}</div><div class="opt"></div><div class="opt"></div><div class="opt"></div><div class="opt"></div><div class="opt"></div><div></div><div class="opt"></div></div><div class="g-time" style=${{ width: W + 'px' }}><div class="g-dd" style=${{ left: X(m.dataDay) + 'px' }}></div></div></div>`;
      const a = r.a; const c = a.cur; const b = a.bl; const isMs = a.type === 'TT_Mile' || a.type === 'TT_FinMile'; const crit = c.critical && a.status !== 'Completed';
      const cls = 'g-bar' + (a.type === 'TT_LOE' ? ' loe' : a.status === 'Completed' ? ' done' : crit ? ' crit' : '');
      return html`<div key=${a.key} class=${'g-row act' + (sel === a.key ? ' sel' : '')} onClick=${() => onSel(a.key)} title=${a.name}>
        <div class="g-left"><div class="mono">${a.code}</div><div>${a.name}</div><div class="r opt">${a.type === 'TT_Task' ? a.blDur : ''}</div><div class="r opt">${a.type === 'TT_Task' ? a.rd : ''}</div><div class="r opt">${a.type === 'TT_LOE' ? '' : Math.round(a.pct * 100)}</div><div class="opt mono">${c.es != null ? cal.fmt(c.es) : ''}${a.as != null ? ' A' : ''}</div><div class="opt mono">${c.ef != null ? cal.fmt(c.ef) : ''}${a.af != null ? ' A' : ''}</div><div class="r" style=${{ color: c.tf != null && c.tf < 0 ? 'var(--crit)' : 'inherit', fontWeight: crit ? 700 : 400 }}>${c.tf ?? ''}</div><div class="r opt" style=${{ color: a.finishVar < 0 ? 'var(--crit)' : 'inherit' }}>${a.type === 'TT_LOE' ? '' : a.finishVar}</div></div>
        <div class="g-time" style=${{ width: W + 'px' }}>
          <div class="g-dd" style=${{ left: X(m.dataDay) + 'px' }}></div>
          ${showBL && b.es != null && !isMs && html`<div class="g-bl" style=${{ left: X(b.es) + 'px', width: Math.max(2, (b.ef - b.es + 1) * px) + 'px' }}></div>`}
          ${isMs ? html`<div class=${'g-ms' + (crit ? ' crit' : '')} style=${{ left: X(c.es) + 'px' }}></div>` : html`<div class=${cls} style=${{ left: X(c.es) + 'px', width: Math.max(3, (c.ef - c.es + 1) * px) + 'px' }}>${a.type === 'TT_Task' && a.pct > 0 && html`<i style=${{ width: Math.min(100, a.pct * 100) + '%' }}></i>`}</div>`}
        </div></div>`;
    })}
    <div class="g-row"><div class="g-left"><div></div><div class="note">Contract completion ${cal.fmt(m.finishBy)}</div></div><div class="g-time" style=${{ width: W + 'px' }}><div class="g-cf" style=${{ left: X(m.finishBy) + 'px' }}></div></div></div>
  </div>`;
}

function ActivityDetail({ m, a, onSel }) {
  if (!a) return null; const cal = m.cal; const items = a.items.map((x) => ({ it: m.itemById.get(x.id), share: x.share })).filter((x) => x.it);
  const relRow = (r, dir) => { const o = m.actByKey.get(dir === 'pred' ? r.from : r.to); return html`<tr key=${r.id + dir} class="clickable" onClick=${() => onSel(o.key)}><td class="mono">${o.code}</td><td>${o.name}</td><td class="mono">${r.type}</td><td class="r">${r.lag}</td><td>${o.status}</td></tr>`; };
  return html`<${Panel} title=${`${a.code} · ${a.name}`} sub=${`${E.stageByNo(a.wbs).name} · ${a.type.replace('TT_', '').replace('FinMile', 'Finish milestone').replace('Mile', 'Start milestone').replace('LOE', 'Level of effort')} · ${a.cls === 'out' ? 'Outdoor calendar (summer midday factor applies)' : 'Standard calendar'}`} actions=${html`<button class="btn sm" onClick=${() => onSel(null)}>Close</button>`}>
    <div class="grid g3">
      <dl class="kv"><dt>Duration basis</dt><dd>${a.basis || '—'}</dd><dt>Original duration</dt><dd class="num">${a.blDur} WD</dd><dt>Remaining</dt><dd class="num">${a.rd} WD</dd><dt>% complete</dt><dd class="num">${pct(a.pct)}</dd><dt>Status</dt><dd>${a.status}</dd></dl>
      <dl class="kv"><dt>Baseline</dt><dd class="num">${a.bl.es != null ? `${cal.fmt(a.bl.es)} → ${cal.fmt(a.bl.ef)}` : '—'}</dd><dt>Current</dt><dd class="num">${cal.fmt(a.cur.es)} → ${cal.fmt(a.cur.ef)}</dd><dt>Actual start / finish</dt><dd class="num">${a.as != null ? cal.fmt(a.as) : '—'} / ${a.af != null ? cal.fmt(a.af) : '—'}</dd><dt>Late start / finish</dt><dd class="num">${a.cur.ls != null ? `${cal.fmt(a.cur.ls)} → ${cal.fmt(a.cur.lf)}` : '—'}</dd></dl>
      <dl class="kv"><dt>Total float</dt><dd class="num">${a.cur.tf ?? '—'} WD ${a.cur.critical && a.status !== 'Completed' ? html`<${Chip} tone="crit">Critical<//>` : a.cur.nearCritical ? html`<${Chip} tone="warn">Near-critical<//>` : ''}</dd><dt>Start variance</dt><dd class="num">${a.startVar} WD</dd><dt>Finish variance</dt><dd class="num" style=${{ color: a.finishVar < 0 ? 'var(--crit)' : 'inherit' }}>${a.finishVar} WD</dd><dt>Longest path</dt><dd>${a.cur.longest ? 'Yes' : 'No'}</dd>${a.cur.fromP6 && html`<dt>Source</dt><dd><${Chip} tone="info">Synced from P6 import<//></dd>`}</dl>
    </div>
    <div class="grid g2" style=${{ marginTop: '14px' }}>
      <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>Predecessors</h4><table class="t"><thead><tr><th>ID</th><th>Activity</th><th>Rel</th><th class="r">Lag</th><th>Status</th></tr></thead><tbody>${a.preds.length ? a.preds.map((r) => relRow(r, 'pred')) : html`<tr><td colspan="5" class="muted">None (start of network)</td></tr>`}</tbody></table></div>
      <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>Successors</h4><table class="t"><thead><tr><th>ID</th><th>Activity</th><th>Rel</th><th class="r">Lag</th><th>Status</th></tr></thead><tbody>${a.succs.length ? a.succs.map((r) => relRow(r, 'succ')) : html`<tr><td colspan="5" class="muted">None</td></tr>`}</tbody></table></div>
    </div>
    ${items.length > 0 && html`<div class="tw" style=${{ marginTop: '14px' }}><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>BOQ items driving this activity</h4><table class="t"><thead><tr><th>Ref</th><th>Description</th><th class="r">Qty in activity</th><th>Unit</th><th class="r">Value AED</th><th class="r">Item executed</th></tr></thead><tbody>${items.map(({ it, share }) => html`<tr key=${it.id}><td class="mono">${it.ref}</td><td class="desc">${it.desc}</td><td class="r">${AED(it.qty * share, it.qty * share % 1 ? 2 : 0)}</td><td>${it.unit}</td><td class="r">${AED(it.amount * share)}</td><td class="r">${pct(m.execQtyAt(it, m.dataDay) / it.qty, 0)}</td></tr>`)}</tbody></table></div>`}
  <//>`;
}

function ProgrammeView({ state, setState, m, toast, sub, setSub }) {
  const [zoom, setZoom] = useState('month'); const [filter, setFilter] = useState('all'); const [showBL, setShowBL] = useState(true); const [sel, setSel] = useState(null); const [q, setQ] = useState('');
  const cal = m.cal;
  const la = useMemo(() => (filter === 'la2' ? new Set(E.lookahead(m, 14).map((x) => x.a.key)) : filter === 'la3' ? new Set(E.lookahead(m, 21).map((x) => x.a.key)) : null), [m, filter]);
  const rows = useMemo(() => { const out = []; STAGES.forEach((st) => { const acts = m.acts.filter((a) => a.wbs === st.no && (filter !== 'crit' || (a.cur.critical && a.status !== 'Completed')) && (filter !== 'near' || ((a.cur.critical || a.cur.nearCritical) && a.status !== 'Completed')) && (!la || la.has(a.key)) && (filter !== 'open' || a.status !== 'Completed') && (!q || (a.code + ' ' + a.name).toLowerCase().includes(q.toLowerCase()))).sort((x, y) => (x.cur.es ?? 0) - (y.cur.es ?? 0) || x.idx - y.idx); if (acts.length) { out.push({ wbs: st }); acts.forEach((a) => out.push({ a })); } }); return out; }, [m, filter, la, q]);
  const selA = sel ? m.actByKey.get(sel) : null;
  const critCount = m.acts.filter((a) => a.cur.critical && a.status !== 'Completed').length;
  return html`<${Fragment}>
    <div class="kpis">
      <${Kpi} label="Activities / relationships" value=${`${m.acts.length} / ${m.curNet.rels.length}`} detail=${`${m.acts.filter((a) => a.status === 'Completed').length} complete · ${m.acts.filter((a) => a.status === 'In progress').length} in progress`} />
      <${Kpi} label="Baseline completion" value=${cal.fmt(m.baselineFinish)} detail=${`Baselined ${fmtDate(E.parseISO(state.baselinedAt || state.project.startDate))}`} />
      <${Kpi} label="Forecast completion" value=${cal.fmt(m.forecastFinish)} detail=${`${sgn(m.finishVarDays)} WD finish variance`} tone=${m.finishVarDays < -10 ? 'watch' : ''} />
      <${Kpi} label="Contract completion" value=${cal.fmt(m.finishBy)} detail=${`${state.project.durationMonths} months from ${fmtDate(E.parseISO(state.project.startDate))}`} />
      <${Kpi} label="Critical path float" value=${`${m.cur.minTF} WD`} detail=${`${critCount} critical activities open`} tone=${m.cur.minTF < 0 ? 'alert' : m.cur.minTF < 10 ? 'watch' : ''} />
      <${Kpi} label="Schedule SPI" value=${m.evm.spi.toFixed(2)} detail="Earned value ÷ planned value" tone=${m.evm.spi < 0.9 ? 'alert' : m.evm.spi < 0.95 ? 'watch' : ''} />
    </div>
    <section class="panel">
      <${SubTabs} tabs=${[['gantt', 'Schedule (Gantt)'], ['lookahead', '2 / 3-week lookahead'], ['recovery', `Recovery triggers (${m.recovery.length})`], ['logic', 'Norms & logic'], ['calendar', 'UAE calendar'], ['p6', 'P6 exchange (.xer / .xml)']]} value=${sub} onChange=${setSub} />
      ${sub === 'gantt' && html`<${Fragment}>
        <div class="panel-h"><div class="row">
          <${Seg} options=${[['all', 'All'], ['open', 'Open'], ['crit', 'Critical'], ['near', 'Near-critical'], ['la2', '2-wk'], ['la3', '3-wk']]} value=${filter} onChange=${setFilter} />
          <${Seg} options=${[['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter']]} value=${zoom} onChange=${setZoom} />
          <label class="check"><input type="checkbox" id="show-bl" checked=${showBL} onChange=${(e) => setShowBL(e.target.checked)} /> Baseline bars</label>
          <input class="inp sm" id="act-search" placeholder="Find activity" value=${q} onInput=${(e) => setQ(e.target.value)} style=${{ width: '160px' }} />
        </div>
        <div class="legend"><span><i style=${{ background: 'var(--accent)' }}></i>Current</span><span><i style=${{ background: 'var(--crit)' }}></i>Critical</span><span><i style=${{ background: 'var(--muted)' }}></i>Complete</span><span><i style=${{ background: 'var(--s-bl)', height: '4px' }}></i>Baseline</span><span><i class="ln" style=${{ background: 'var(--sand)' }}></i>Data date</span><span>TF / FV in working days</span></div></div>
        <${Gantt} m=${m} rows=${rows} zoom=${zoom} showBL=${showBL} sel=${sel} onSel=${setSel} />
      <//>`}
      ${sub === 'lookahead' && html`<${LookaheadPanel} m=${m} />`}
      ${sub === 'recovery' && html`<${RecoveryPanel} m=${m} />`}
      ${sub === 'logic' && html`<${NormsPanel} state=${state} setState=${setState} m=${m} toast=${toast} />`}
      ${sub === 'calendar' && html`<${CalendarPanel} state=${state} setState=${setState} m=${m} />`}
      ${sub === 'p6' && html`<${P6Panel} state=${state} setState=${setState} m=${m} toast=${toast} />`}
    </section>
    ${sub === 'gantt' && selA && html`<${ActivityDetail} m=${m} a=${selA} onSel=${setSel} />`}
  <//>`;
}

function LookaheadPanel({ m }) {
  const [win, setWin] = useState(14); const cal = m.cal; const la = E.lookahead(m, win);
  return html`<div class="panel-b"><div class="row" style=${{ justifyContent: 'space-between', marginBottom: '10px' }}><${Seg} options=${[[14, '2-week'], [21, '3-week']]} value=${win} onChange=${setWin} /><span class="note">From ${cal.fmt(m.dataDay)} to ${cal.fmt(m.dataDay + win)}. Quantities are the remaining BOQ work falling inside the window.</span></div>
    <div class="tw"><table class="t"><thead><tr><th>Activity ID</th><th>Activity</th><th>Start</th><th>Finish</th><th class="r">Float</th><th class="r">Qty in window</th><th class="r">Value AED</th><th>Constraints</th></tr></thead><tbody>
      ${la.map((x) => html`<tr key=${x.a.key}><td class="mono">${x.a.code}</td><td>${x.a.name} ${x.a.cur.critical && html`<${Chip} tone="crit">Critical<//>`}</td><td class="mono">${cal.fmt(x.a.cur.es)}${x.a.as != null ? ' A' : ''}</td><td class="mono">${cal.fmt(x.a.cur.ef)}</td><td class="r">${x.a.cur.tf ?? ''}</td><td class="r">${x.qty ? `${AED(x.qty, x.unit === 'LS' ? 2 : 0)} ${x.unit}` : '—'}</td><td class="r">${x.value ? AED(x.value) : '—'}</td><td>${x.constraints.length ? x.constraints.map((c, i) => html`<${Chip} key=${i} tone="warn">${c}<//> `) : html`<${Chip} tone="good">Clear<//>`}</td></tr>`)}
    </tbody></table></div></div>`;
}

function RecoveryPanel({ m }) {
  return html`<div class="panel-b grid" style=${{ gap: '14px' }}>
    <p class="note" style=${{ margin: 0, maxWidth: '80ch' }}>Thresholds: forecast completion later than the contract date, completion slipping more than 10 WD against baseline, SPI below 0.95 (watch) or 0.90 (recovery), a critical activity finishing more than 15 WD late, a long-lead delivery after its required-on-site date, or an authority NOC forecast after its need-by date.</p>
    <div class="alerts">${m.recovery.length ? m.recovery.map((r, i) => html`<div key=${i} class=${'alert-i ' + (r.level === 'critical' ? 'crit' : '')}><i></i><div><b>${r.level === 'critical' ? 'Recovery required: ' : 'Watch: '}${r.title}</b><span>${r.detail}</span></div></div>`) : html`<div class="empty">No recovery triggers are active.</div>`}</div>
    <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>Activities with the largest finish slippage</h4><table class="t"><thead><tr><th>ID</th><th>Activity</th><th>BL finish</th><th>Forecast</th><th class="r">FV (WD)</th><th class="r">TF</th><th>Suggested recovery measure</th></tr></thead><tbody>
      ${m.acts.filter((a) => a.type === 'TT_Task' && a.status !== 'Completed' && a.finishVar < -5).sort((a, b) => a.finishVar - b.finishVar).slice(0, 12).map((a) => { const remWin = Math.max(1, a.rd + a.finishVar); const up = Math.round(((a.rd || a.dur) / remWin - 1) * 100); const meas = a.group === 'frame' ? 'Second formwork set, cut the floor cycle to 12 days' : a.group === 'block' ? `Add ${Math.max(1, Math.round(up / 15))} blockwork gang(s)` : FLOOR_GROUPS.includes(a.group) ? 'Open a second work front (zone B) in parallel' : a.noc ? 'Escalate with authority; consultant to attend review meeting' : a.key.startsWith('proc_') ? 'Expedite factory slot; air-freight critical parts' : 'Night shift or overlapping start (FS → SS)'; return html`<tr key=${a.key}><td class="mono">${a.code}</td><td>${a.name}</td><td class="mono">${m.cal.fmt(a.bl.ef)}</td><td class="mono">${m.cal.fmt(a.cur.ef)}</td><td class="r" style=${{ color: 'var(--crit)' }}>${a.finishVar}</td><td class="r">${a.cur.tf ?? ''}</td><td>${meas}${up > 0 && up <= 60 ? html` <span class="muted">(+${up}% output to recover)</span>` : up > 60 ? html` <span class="muted">(output alone cannot recover it: re-sequence or claim an EOT)</span>` : ''}</td></tr>`; })}
    </tbody></table></div></div>`;
}
const FLOOR_GROUPS = ['block', 'firstfix', 'plaster', 'finish', 'secondfix'];

function NormsPanel({ state, setState, m, toast }) {
  const s = state.settings;
  const setNorm = (id, v) => setState((st) => ({ ...st, settings: { ...st.settings, norms: st.settings.norms.map((n) => (n.id === id ? { ...n, perDay: v } : n)) } }));
  const setSched = (k, v) => setState((st) => ({ ...st, settings: { ...st.settings, sched: { ...st.settings.sched, [k]: v } } }));
  const setFixed = (k, v) => setState((st) => ({ ...st, settings: { ...st.settings, fixed: { ...st.settings.fixed, [k]: v } } }));
  const rebaseline = () => { setState((st) => ({ ...st, baselineSettings: JSON.parse(JSON.stringify(st.settings)), baselinedAt: st.project.dataDate })); toast('Baseline re-set with the current norms and calendar. Variances now measure against the new baseline.'); };
  const reset = () => { setState((st) => ({ ...st, settings: defaultSettings() })); toast('Norms, durations and calendar reset to defaults.'); };
  const used = new Set(m.acts.flatMap((a) => a.items.map((x) => x.id)).map((id) => m.itemById.get(id)).filter(Boolean).map((it) => { const n = s.norms.find((nn) => nn.unit === it.unit && new RegExp(nn.match, 'i').test(it.desc)); return n && n.id; }).filter(Boolean));
  const changed = JSON.stringify(state.settings) !== JSON.stringify(state.baselineSettings);
  return html`<div class="panel-b grid" style=${{ gap: '16px' }}>
    <div class="row" style=${{ justifyContent: 'space-between' }}><span class="note" style=${{ maxWidth: '80ch' }}>Duration = BOQ quantity ÷ output per day, taking the longest item in the work package. Floor-wise packages are split equally across levels and linked floor by floor. Edits change the current schedule straight away. The baseline only changes when you re-baseline.</span>
      <div class="row">${changed && html`<${Chip} tone="warn">Current settings differ from baseline<//>`}<button class="btn sm" onClick=${reset}>Reset defaults</button><button class="btn primary sm" onClick=${rebaseline}>Re-baseline</button></div></div>
    <div class="grid g3">
      <label class="field">Typical floors above ground<input type="number" id="floors" min="1" max="40" value=${s.sched.floors} onChange=${(e) => setSched('floors', Math.max(1, Math.min(40, Number(e.target.value) || 1)))} /></label>
      <label class="field">Typical floor cycle (working days)<input type="number" id="cycle" min="5" max="40" value=${s.sched.floorCycle} onChange=${(e) => setSched('floorCycle', Math.max(3, Number(e.target.value) || 14))} /></label>
      <label class="field">Roof slab cycle (working days)<input type="number" id="rcycle" min="3" max="40" value=${s.sched.roofCycle} onChange=${(e) => setSched('roofCycle', Math.max(3, Number(e.target.value) || 12))} /></label>
    </div>
    <div class="grid g2">
      <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>Productivity norms (measured work)</h4><table class="t"><thead><tr><th>Norm</th><th>Unit</th><th class="r">Output / day</th><th>Used</th></tr></thead><tbody>
        ${s.norms.map((n) => html`<tr key=${n.id}><td>${n.label}<div class="note mono">/${n.match}/</div></td><td>${n.unit}</td><td class="r"><input class="inp sm num" id=${'n-' + n.id} type="number" step="any" min="0.01" value=${round(n.perDay, 3)} onChange=${(e) => { const v = Number(e.target.value); if (v > 0) setNorm(n.id, v); }} style=${{ width: '90px', textAlign: 'right' }} /></td><td>${used.has(n.id) ? html`<${Chip} tone="good">Yes<//>` : html`<span class="muted">—</span>`}</td></tr>`)}
      </tbody></table></div>
      <div class="grid" style=${{ gap: '14px', alignContent: 'start' }}>
        <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>Fixed durations (lump-sum packages, WD)</h4><table class="t"><tbody>
          ${Object.entries(s.fixed).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td class="r"><input class="inp sm num" id=${'f-' + k} type="number" min="0" value=${v} onChange=${(e) => setFixed(k, Math.max(0, Number(e.target.value) || 0))} style=${{ width: '80px', textAlign: 'right' }} /></td></tr>`)}
        </tbody></table></div>
        <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>Logic template (generated relationships)</h4><table class="t"><tbody>
          ${[['Building permit', 'FS', 'Mobilisation'], ['Piling / shoring', 'FS', 'Bulk excavation'], ['Excavation', 'SS +60%', 'Blinding'], ['Waterproofing', 'SS +5', 'Raft & retaining walls'], ['RCC floor n', 'FS', 'RCC floor n+1 (cycle)'], ['RCC floor n+1', 'FS +7', 'Blockwork floor n (de-propping)'], ['Blockwork floor n', 'SS +5', 'MEP first fix floor n'], ['First fix', 'FS', 'Plaster floor n'], ['Plaster', 'FS +3', 'Finishes floor n'], ['Finishes', 'SS +40% / FF +5', 'MEP second fix'], ['MAR + shop dwg', 'FS', 'Procure → install (long lead)'], ['DCD drawings NOC', 'FS', 'MEP first fix'], ['Substation + DEWA', 'FF +10', 'Testing & commissioning'], ['T&C', 'SS +60%', 'Snagging'], ['DCD final + BCC', 'FS', 'Practical completion']].map(([a, r, b], i) => html`<tr key=${i}><td>${a}</td><td class="mono">${r}</td><td>${b}</td></tr>`)}
        </tbody></table></div>
      </div>
    </div></div>`;
}

function CalendarPanel({ state, setState, m }) {
  const c = state.settings.cal; const set = (k, v) => setState((st) => ({ ...st, settings: { ...st.settings, cal: { ...st.settings.cal, [k]: v } } }));
  const sm = m.cal.summary(0, m.forecastFinish || m.finishBy);
  return html`<div class="panel-b grid" style=${{ gap: '16px' }}>
    <div class="grid g3">
      <div class="field">Working week<div class="row">${E.DOW.map((d, i) => html`<label class="check" key=${d}><input type="checkbox" id=${'dow-' + i} checked=${!c.offDays.includes(i)} onChange=${(e) => set('offDays', e.target.checked ? c.offDays.filter((x) => x !== i) : [...c.offDays, i])} />${d}</label>`)}</div><span class="note">${7 - c.offDays.length}-day week. Friday is the default rest day.</span></div>
      <div class="field">Hours per day (P6 calendar)<input type="number" id="hpd" min="6" max="12" value=${c.hoursPerDay} onChange=${(e) => set('hoursPerDay', Math.max(4, Math.min(12, Number(e.target.value) || 9)))} /></div>
      <label class="check" style=${{ alignSelf: 'end' }}><input type="checkbox" id="hol" checked=${c.holidays} onChange=${(e) => set('holidays', e.target.checked)} /> UAE public holidays as non-working days</label>
      <div class="field"><label class="check"><input type="checkbox" id="summer" checked=${c.summer} onChange=${(e) => set('summer', e.target.checked)} /> Summer midday break (15 Jun – 15 Sep, 12:30–15:00)</label>Outdoor productivity factor<input type="number" id="sf" step="0.05" min="0.5" max="1" value=${c.summerFactor} disabled=${!c.summer} onChange=${(e) => set('summerFactor', Math.max(0.5, Math.min(1, Number(e.target.value) || 0.85)))} /><span class="note">Applied to outdoor activities: substructure, frame, façade and external works.</span></div>
      <div class="field"><label class="check"><input type="checkbox" id="ram" checked=${c.ramadan} onChange=${(e) => set('ramadan', e.target.checked)} /> Ramadan reduced working hours</label>Productivity factor<input type="number" id="rf" step="0.05" min="0.5" max="1" value=${c.ramadanFactor} disabled=${!c.ramadan} onChange=${(e) => set('ramadanFactor', Math.max(0.5, Math.min(1, Number(e.target.value) || 0.8)))} /><span class="note">Ramadan ${E.RAMADAN.map(([a, b]) => `${fmtDate(E.parseISO(a))}–${fmtDate(E.parseISO(b))}`).join(', ')} (estimated)</span></div>
      <dl class="kv" style=${{ alignContent: 'start' }}><dt>Working days to forecast finish</dt><dd class="num">${sm.work}</dd><dt>Public holidays in window</dt><dd class="num">${sm.holidays}</dd><dt>Ramadan working days</dt><dd class="num">${sm.ramadan}</dd><dt>Summer working days</dt><dd class="num">${sm.summer}</dd></dl>
    </div>
    <div class="tw"><h4 class="eyebrow" style=${{ marginBottom: '6px' }}>UAE public holidays (Islamic dates estimated; confirm on official announcement)</h4><table class="t"><thead><tr><th>Date</th><th>Day</th><th>Holiday</th></tr></thead><tbody>${E.UAE_HOLIDAYS.filter(([d]) => d >= state.project.startDate.slice(0, 4)).map(([d, n]) => html`<tr key=${d}><td class="mono">${fmtDate(E.parseISO(d))}</td><td>${E.DOW[new Date(E.parseISO(d)).getUTCDay()]}</td><td>${n}</td></tr>`)}</tbody></table></div>
  </div>`;
}

function P6Panel({ state, setState, m, toast }) {
  const [table, setTable] = useState('TASK'); const fileRef = useRef(null); const [busy, setBusy] = useState(false);
  const xer = useMemo(() => E.toXER(m), [m]);
  const preview = useMemo(() => { const lines = xer.split('\r\n'); const i = lines.findIndex((l) => l === `%T\t${table}`); if (i < 0) return ''; const out = []; for (let k = i; k < lines.length && out.length < 40; k++) { if (k > i && lines[k].startsWith('%T')) break; out.push(lines[k].length > 260 ? lines[k].slice(0, 260) + ' …' : lines[k]); } return out.join('\n'); }, [xer, table]);
  const base = `${state.project.code}_P6_${state.project.dataDate}`;
  const exportZip = async () => { setBusy(true); try { await loadScript(LIBS.jszip); const z = new JSZip(); z.file(`${base}.xer`, xer); z.file(`${base}.xml`, E.toP6XML(m)); z.file(`${base}_activities.csv`, E.csvOf(E.activitiesTable(m))); z.file('README.txt', `SiteLedger UAE: Primavera P6 exchange package\nProject: ${state.project.name}\nData date: ${state.project.dataDate}\n\n${base}.xer  Import in P6 Professional (File > Import > XER). Contains PROJECT, CALENDAR (UAE work week + holidays), PROJWBS (16 lifecycle stages), TASK (baseline as target dates, current early/late dates, float, actuals), TASKPRED (FS/SS/FF + lags) and UDFs (BOQ refs, duration basis).\n${base}.xml  P6 XML (APIBusinessObjects) for P6 EPPM or tools that read XML.\n${base}_activities.csv  Flat activity list for Excel.\n\nAfter updating in P6, export an .xer and import it in SiteLedger to sync dates, float and critical path.\nCheck an import in a sandbox P6 database before using it on a live project.\n`); const buf = await z.generateAsync({ type: 'arraybuffer' }); const r = await saveFile(`${base}.zip`, new Blob([buf])); toast(r.msg); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const exportXlsx = async () => { setBusy(true); try { await loadScript(LIBS.xlsx); const wb = XLSX.utils.book_new(); const at = E.activitiesTable(m); const ws = XLSX.utils.aoa_to_sheet([at.head, ...at.rows]); ws['!cols'] = at.head.map((h, i) => ({ wch: i === 1 ? 52 : i >= 17 ? 30 : 12 })); XLSX.utils.book_append_sheet(wb, ws, 'Activities'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Predecessor', 'Successor', 'Type', 'Lag (WD)'], ...m.curNet.rels.map((r) => [m.actByKey.get(r.from).code, m.actByKey.get(r.to).code, r.type, r.lag])]), 'Relationships'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Norm', 'Unit', 'Output per day', 'Match'], ...state.settings.norms.map((n) => [n.label, n.unit, n.perDay, n.match])]), 'Productivity norms'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Holiday'], ...E.UAE_HOLIDAYS]), 'UAE holidays'); const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); const r = await saveFile(`${base}.xlsx`, new Blob([out])); toast(r.msg); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const importXer = async (file) => { if (!file) return; try { const text = await file.text(); const res = E.parseXER(text, m.cal); const codes = new Set(m.acts.map((a) => a.code)); const matched = Object.keys(res.tasks).filter((c) => codes.has(c)); let changed = 0; matched.forEach((c) => { const a = m.acts.find((x) => x.code === c); const t = res.tasks[c]; if (t.es !== a.cur.es || t.ef !== a.cur.ef || t.tf !== a.cur.tf) changed++; }); const tasks = {}; matched.forEach((c) => { tasks[c] = res.tasks[c]; }); setState((s) => ({ ...s, p6Import: { fileName: file.name, at: new Date().toISOString().slice(0, 16).replace('T', ' '), tasks, total: res.count, matched: matched.length, changed, rels: res.rels, project: res.project, dataDate: res.dataDate } })); toast(`P6 import: ${matched.length} of ${res.count} activities matched by Activity ID; ${changed} with changed dates or float.`); } catch (e) { toast(e.message || 'Could not read the .xer file.'); } };
  const imp = state.p6Import;
  return html`<div class="panel-b grid" style=${{ gap: '16px' }}>
    <div class="grid g2">
      <div class="grid" style=${{ gap: '10px', alignContent: 'start' }}>
        <h3 style=${{ fontSize: '15px' }}>Export to Primavera P6</h3>
        <p class="note" style=${{ margin: 0 }}>The .zip holds the native <b>.xer</b> (PROJECT, CALENDAR, PROJWBS, TASK, TASKPRED, UDF tables), a <b>P6 XML</b> file and a CSV activity list. Baseline dates go out as target dates; current dates, float and actuals go out as early/late and actual dates.</p>
        <div class="row"><button class="btn primary" disabled=${busy} onClick=${exportZip}>Export P6 package (.zip: XER + XML + CSV)</button><button class="btn" disabled=${busy} onClick=${exportXlsx}>Export programme (.xlsx)</button></div>
        <span class="note">${m.acts.length} activities · ${m.curNet.rels.length} relationships · 17 WBS nodes · calendar "${7 - state.settings.cal.offDays.length}-day week, ${state.settings.cal.hoursPerDay} h/day"</span>
      </div>
      <div class="grid" style=${{ gap: '10px', alignContent: 'start' }}>
        <h3 style=${{ fontSize: '15px' }}>Import an updated .xer from P6</h3>
        <p class="note" style=${{ margin: 0 }}>Activities are matched on Activity ID. Imported early/actual dates, total float and the driving path replace the computed values in the current schedule and reports.</p>
        <div class="row"><button class="btn" onClick=${() => fileRef.current.click()}>Choose .xer file</button>${imp && html`<button class="btn ghost" onClick=${() => { setState((s) => ({ ...s, p6Import: null })); toast('P6 import cleared. Using computed CPM dates.'); }}>Clear import</button>`}</div>
        <input ref=${fileRef} id="xer-file" type="file" accept=".xer,.txt" hidden onChange=${(e) => { importXer(e.target.files[0]); e.target.value = ''; }} />
        ${imp ? html`<dl class="kv"><dt>File</dt><dd>${imp.fileName}</dd><dt>Imported</dt><dd>${imp.at}</dd><dt>Activities matched</dt><dd class="num">${imp.matched} of ${imp.total}</dd><dt>Changed dates / float</dt><dd class="num">${imp.changed}</dd><dt>Relationships in file</dt><dd class="num">${imp.rels}</dd></dl>` : html`<span class="note">No P6 import yet. To test the round trip, export the package, then import its .xer here.</span>`}
      </div>
    </div>
    <div><div class="row" style=${{ justifyContent: 'space-between', marginBottom: '6px' }}><h4 class="eyebrow">.xer preview</h4><${Seg} options=${['PROJECT', 'CALENDAR', 'PROJWBS', 'TASK', 'TASKPRED', 'UDFVALUE'].map((t) => [t, t])} value=${table} onChange=${setTable} /></div><div class="code" tabindex="0">${preview}</div></div>
  </div>`;
}

// ───────────────────────── documents & authority ─────────────────────────
function DocsView({ state, setState, m, sub, setSub }) {
  const cal = m.cal; const [type, setType] = useState('all'); const [st, setSt] = useState('all'); const [q, setQ] = useState('');
  const setNoc = (key, status) => setState((s) => ({ ...s, nocOverrides: { ...s.nocOverrides, [key]: { status, approvedDay: status === 'APPROVED' ? m.dataDay : undefined } } }));
  const setSub2 = (key, status) => setState((s) => ({ ...s, subOverrides: { ...s.subOverrides, [key]: status } }));
  const subs = m.docs.subs.filter((s) => (type === 'all' || s.type === type) && (st === 'all' || (st === 'overdue' ? s.overdue : s.status === st)) && (!q || (s.id + ' ' + s.title + ' ' + s.itemRef).toLowerCase().includes(q.toLowerCase())));
  const counts = {}; m.docs.subs.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; });
  return html`<${Fragment}>
    <div class="kpis">
      <${Kpi} label="Authority NOCs approved" value=${`${m.docs.nocs.filter((n) => n.status === 'APPROVED').length} / ${m.docs.nocs.length}`} detail=${`${m.docs.nocs.filter((n) => n.late).length} forecast late`} tone=${m.docs.nocs.some((n) => n.late) ? 'watch' : ''} />
      <${Kpi} label="Submittals generated" value=${String(m.docs.subs.length)} detail="MAR · SD · MS · ITP · plans" />
      <${Kpi} label="Approved (A / B)" value=${String((counts.A || 0) + (counts.B || 0))} detail=${`${counts.C || 0} revise & resubmit`} />
      <${Kpi} label="Overdue" value=${String(m.docs.subs.filter((s) => s.overdue).length)} detail="Past required approval date" tone=${m.docs.subs.some((s) => s.overdue) ? 'watch' : ''} />
      <${Kpi} label="WIRs raised / planned" value=${`${sum(m.docs.wirs, (w) => w.raised)} / ${sum(m.docs.wirs, (w) => w.planned)}`} detail=${`${sum(m.docs.wirs, (w) => w.rejected)} rejected`} />
      <${Kpi} label="Long-lead packages" value=${String(m.docs.procurement.length)} detail=${`${m.docs.procurement.filter((p) => p.float < 0).length} with negative float`} />
    </div>
    <section class="panel">
      <${SubTabs} tabs=${[['nocs', 'Authority NOCs & permits'], ['subs', 'Submittal log (MAR / SD / MS / ITP)'], ['wirs', 'WIR log'], ['proc', 'Procurement & long lead']]} value=${sub} onChange=${setSub} />
      ${sub === 'nocs' && html`<div class="tw scroll-y"><table class="t"><thead><tr><th>Activity</th><th>Authority</th><th>Permit / NOC</th><th>Triggered by</th><th class="r">SLA</th><th>Need by</th><th>Forecast approval</th><th class="r">TF</th><th>Status</th><th>Reference</th></tr></thead><tbody>
        ${m.docs.nocs.map((n) => html`<tr key=${n.key}><td class="mono">${n.code}</td><td><b>${n.auth}</b></td><td>${n.name} ${n.late && html`<${Chip} tone="crit">Late<//>`}</td><td class="mono">${n.trigger ? 'BOQ ' + n.trigger : 'Template'}</td><td class="r">${n.sla} d</td><td class="mono">${cal.fmt(n.needBy)}</td><td class="mono">${n.status === 'APPROVED' && n.approvedDay != null ? cal.fmt(n.approvedDay) + ' A' : cal.fmt(n.curFinish)}</td><td class="r">${n.tf ?? ''}</td>
          <td><select class="inp sm" id=${'noc-' + n.key} value=${n.status} onChange=${(e) => setNoc(n.key, e.target.value)} style=${{ minWidth: '150px', borderColor: `var(--${statusTone(n.status) === 'good' ? 'good' : statusTone(n.status) === 'warn' ? 'warn' : 'line'})` }}>${E.NOC_STATUSES.map((s) => html`<option key=${s} value=${s}>${E.NOC_LABEL[s]}</option>`)}</select></td><td class="mono">${n.refNo || '—'}</td></tr>`)}
      </tbody></table></div>`}
      ${sub === 'subs' && html`<${Fragment}><div class="panel-h"><div class="row">
          <select class="inp sm" id="sub-type" value=${type} onChange=${(e) => setType(e.target.value)} style=${{ width: 'auto' }}><option value="all">All types</option>${Object.entries(E.SUB_TYPES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
          <select class="inp sm" id="sub-status" value=${st} onChange=${(e) => setSt(e.target.value)} style=${{ width: 'auto' }}><option value="all">All statuses</option><option value="overdue">Overdue only</option>${E.SUB_STATUSES.map((s) => html`<option key=${s} value=${s}>${E.SUB_LABEL[s]}</option>`)}</select>
          <input class="inp sm" id="sub-q" placeholder="Search" value=${q} onInput=${(e) => setQ(e.target.value)} style=${{ width: '160px' }} /></div><span class="note">${subs.length} documents. Required date = BOQ item baseline start − review lead (MAR 42 d, SD 28 d, MS/ITP 21 d) − procurement lead for long-lead items.</span></div>
        <div class="tw scroll-y"><table class="t"><thead><tr><th>Doc no.</th><th>Type</th><th>Title</th><th>BOQ</th><th>Stage</th><th>Required by</th><th>Status (consultant code)</th></tr></thead><tbody>
          ${subs.slice(0, 400).map((s) => html`<tr key=${s.id}><td class="mono">${s.id}</td><td>${s.type}</td><td>${s.title} ${s.longLead && html`<${Chip} tone="warn">Long lead<//>`} ${s.overdue && html`<${Chip} tone="crit">Overdue<//>`}</td><td class="mono">${s.itemRef}</td><td>${s.stage}</td><td class="mono">${cal.fmt(s.reqDay)}</td>
            <td><select class="inp sm" id=${'s-' + s.id} value=${s.status} onChange=${(e) => setSub2(s.key, e.target.value)} style=${{ minWidth: '170px' }}>${E.SUB_STATUSES.map((x) => html`<option key=${x} value=${x}>${E.SUB_LABEL[x]}</option>`)}</select></td></tr>`)}
        </tbody></table></div><//>`}
      ${sub === 'wirs' && html`<div class="tw scroll-y"><table class="t"><thead><tr><th>BOQ</th><th>Work item</th><th>Trade</th><th class="r">Inspection lot</th><th class="r">Planned WIRs</th><th class="r">Raised</th><th class="r">Approved</th><th class="r">Pending</th><th class="r">Rejected</th><th style=${{ minWidth: '110px' }}>Coverage</th></tr></thead><tbody>
        ${m.docs.wirs.map((w) => html`<tr key=${w.itemId}><td class="mono">${w.ref}</td><td>${w.desc}</td><td>${w.trade}</td><td class="r">${w.unit === 'LS' || w.unit === 'PS' ? pct(w.lot, 0) + ' of item' : `${AED(w.lot)} ${w.unit}`}</td><td class="r">${w.planned}</td><td class="r">${w.raised}</td><td class="r">${w.approved}</td><td class="r">${w.pending}</td><td class="r" style=${{ color: w.rejected ? 'var(--crit)' : 'inherit' }}>${w.rejected}</td><td><${Bar} value=${w.raised / w.planned} /></td></tr>`)}
      </tbody></table></div>`}
      ${sub === 'proc' && html`<div class="tw"><table class="t"><thead><tr><th>Activity</th><th>Package</th><th class="r">Lead time</th><th>PO / start</th><th>Expected delivery</th><th>Required on site</th><th class="r">Float (WD)</th><th>Status</th></tr></thead><tbody>
        ${m.docs.procurement.map((p) => html`<tr key=${p.key}><td class="mono">${p.code}</td><td>${p.name}</td><td class="r">${p.leadWk} wk</td><td class="mono">${cal.fmt(p.poDay)}</td><td class="mono">${cal.fmt(p.expDay)}</td><td class="mono">${cal.fmt(p.reqDay)}</td><td class="r" style=${{ color: p.float < 0 ? 'var(--crit)' : 'inherit' }}>${p.float}</td><td><${Chip} tone=${statusTone(p.status)}>${p.status}<//></td></tr>`)}
      </tbody></table></div>`}
    </section>
  <//>`;
}

// ───────────────────────── site diary (field app) ─────────────────────────
const TRADES = ['Carpenters', 'Steel fixers', 'Concrete gang', 'Masons', 'Plasterers', 'Tilers', 'Painters', 'Electricians', 'Plumbers', 'Duct fitters', 'Façade installers', 'General labour', 'Engineers & foremen', 'HSE officers & first aiders'];
function DiaryView({ state, setState, m, toast, go }) {
  const latest = m.logs[m.logs.length - 1];
  const blank = () => ({ date: state.project.dataDate, weather: 'Sunny, clear', tempMax: 29, humidity: 55, wind: 14, incidents: 0, nearMiss: 0, tbt: 1, manpower: Object.fromEntries(TRADES.map((t) => [t, latest && latest.manpower[t] ? latest.manpower[t] : 0])), equipment: latest ? { ...latest.equipment } : { 'Tower crane': 1 }, qty: [{ itemId: '', qty: '', loc: '' }], pours: [], insp: [], photos: [], blockers: '' });
  const [f, setF] = useState(blank); const [confirmDel, setConfirmDel] = useState(null);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const active = useMemo(() => { const set = new Set(E.lookahead(m, 21).flatMap((x) => x.a.items.map((i) => i.id))); return m.items.filter((i) => !i.c.reserve && !i.c.loe && i.c.stage !== 2 && i.c.stage !== 16).sort((a, b) => (set.has(b.id) ? 1 : 0) - (set.has(a.id) ? 1 : 0)).map((i) => ({ i, active: set.has(i.id) })); }, [m]);
  const valueToday = sum(f.qty, (q) => { const it = m.itemById.get(q.itemId); return it ? Number(q.qty || 0) * it.rate : 0; });
  const addPhotos = async (files) => { const out = []; for (const file of [...files].slice(0, 6)) { try { out.push({ src: await fileToJpeg(file), caption: file.name.replace(/\.[^.]+$/, '') }); } catch (e) { toast(`${file.name} is not an image.`); } } setF((x) => ({ ...x, photos: [...x.photos, ...out] })); };
  const save = () => {
    const qty = f.qty.filter((q) => q.itemId && Number(q.qty) > 0).map((q) => ({ itemId: q.itemId, qty: Number(q.qty), loc: q.loc || 'Site' }));
    if (!qty.length && !f.blockers && !f.photos.length) { toast('Add at least one executed quantity, a photo or a note before saving.'); return; }
    const d = new Date(E.parseISO(f.date));
    const log = { ...f, id: 'u' + Date.now(), user: true, qty, dow: E.DOW[d.getUTCDay()], manpower: Object.fromEntries(Object.entries(f.manpower).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])), insp: f.insp.filter((x) => x.ref) };
    setState((s) => ({ ...s, userLogs: [...(s.userLogs || []), log] }));
    toast(`Diary for ${fmtDate(E.parseISO(f.date))} saved: AED ${AED(valueToday)} of work. DPR, quantities, EV and the P6 update are recalculated.`);
    setF(blank());
  };
  const byDate = useMemo(() => { const g = new Map(); m.logs.forEach((l) => { if (!g.has(l.date)) g.set(l.date, []); g.get(l.date).push(l); }); return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])); }, [m.logs]);
  return html`<div class="grid g-main">
    <${Panel} title="Site diary — daily entry" sub="Built for phones on site. Saved quantities flow into the BOQ tracker, EV, the P6 update and the daily, weekly and monthly reports.">
      <div class="grid" style=${{ gap: '16px' }}>
        <div class="diary-grid">
          <label class="field">Date<input type="date" id="d-date" value=${f.date} min=${state.project.startDate} max=${state.project.dataDate} onChange=${(e) => up('date', e.target.value)} /></label>
          <label class="field">Weather<select id="d-weather" value=${f.weather} onChange=${(e) => up('weather', e.target.value)}>${['Sunny, clear', 'Hazy, light dust', 'Humid, fog in morning', 'Windy, sandstorm', 'Rain'].map((w) => html`<option key=${w}>${w}</option>`)}</select></label>
          <label class="field">Max temp °C<input type="number" id="d-temp" value=${f.tempMax} onChange=${(e) => up('tempMax', Number(e.target.value))} /></label>
          <label class="field">Humidity %<input type="number" id="d-hum" value=${f.humidity} onChange=${(e) => up('humidity', Number(e.target.value))} /></label>
          <label class="field">Lost-time injuries<input type="number" id="d-inc" min="0" value=${f.incidents} onChange=${(e) => up('incidents', Number(e.target.value))} /></label>
          <label class="field">Near misses<input type="number" id="d-nm" min="0" value=${f.nearMiss} onChange=${(e) => up('nearMiss', Number(e.target.value))} /></label>
          <label class="field">Toolbox talks<input type="number" id="d-tbt" min="0" value=${f.tbt} onChange=${(e) => up('tbt', Number(e.target.value))} /></label>
          <div class="field">Midday break<span class="note" style=${{ fontWeight: 400 }}>${m.cal.info(m.cal.dayOf(E.parseISO(f.date))).inSummer ? 'Applies today: no outdoor work 12:30–15:00' : 'Not applicable (15 Jun – 15 Sep only)'}</span></div>
        </div>
        <div><h4 class="eyebrow" style=${{ marginBottom: '8px' }}>BOQ quantities executed today</h4>
          <div class="grid" style=${{ gap: '8px' }}>${f.qty.map((q, k) => { const it = m.itemById.get(q.itemId); const done = it ? m.execQtyAt(it, m.dataDay) : 0; const over = it && Number(q.qty) + done > it.qty * 1.001; return html`<div key=${k}><div class="qrow">
            <label class="field">BOQ item<select id=${'q-item-' + k} value=${q.itemId} onChange=${(e) => up('qty', f.qty.map((x, j) => (j === k ? { ...x, itemId: e.target.value } : x)))}><option value="">Select an item…</option><optgroup label="In the 3-week lookahead">${active.filter((x) => x.active).map(({ i }) => html`<option key=${i.id} value=${i.id}>${i.ref} · ${i.desc.slice(0, 60)}</option>`)}</optgroup><optgroup label="All other items">${active.filter((x) => !x.active).map(({ i }) => html`<option key=${i.id} value=${i.id}>${i.ref} · ${i.desc.slice(0, 60)}</option>`)}</optgroup></select></label>
            <label class="field">Qty ${it ? `(${it.unit})` : ''}<input type="number" id=${'q-qty-' + k} step="any" min="0" inputmode="decimal" value=${q.qty} onChange=${(e) => up('qty', f.qty.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} /></label>
            <label class="field loc">Location<input id=${'q-loc-' + k} placeholder="e.g. L4 Zone B" value=${q.loc} onChange=${(e) => up('qty', f.qty.map((x, j) => (j === k ? { ...x, loc: e.target.value } : x)))} /></label>
            <button class="btn sm" aria-label="Remove row" onClick=${() => up('qty', f.qty.filter((_, j) => j !== k))}>✕</button></div>
            ${it && html`<div class=${over ? 'warnline' : 'note'}>${over ? `Exceeds BOQ quantity by ${AED(Number(q.qty) + done - it.qty, 2)} ${it.unit}. Raise a re-measurement or a VO.` : `Executed to date ${AED(done, 2)} of ${AED(it.qty, 2)} ${it.unit} · today's value AED ${AED(Number(q.qty || 0) * it.rate)}`}</div>`}</div>`; })}
          <div class="row"><button class="btn sm" onClick=${() => up('qty', [...f.qty, { itemId: '', qty: '', loc: '' }])}>+ Add quantity</button><span class="note">Value today: <b class="num">AED ${AED(valueToday)}</b></span></div></div>
        </div>
        <details><summary class="eyebrow" style=${{ cursor: 'pointer' }}>Manpower by trade (${sum(Object.values(f.manpower), Number)} on site)</summary>
          <div class="diary-grid" style=${{ marginTop: '8px' }}>${TRADES.map((t, k) => html`<label class="field" key=${t}>${t}<input type="number" id=${'mp-' + k} min="0" inputmode="numeric" value=${f.manpower[t] || 0} onChange=${(e) => up('manpower', { ...f.manpower, [t]: Number(e.target.value) })} /></label>`)}</div></details>
        <details><summary class="eyebrow" style=${{ cursor: 'pointer' }}>Equipment (${Object.keys(f.equipment).length} types)</summary>
          <div class="diary-grid" style=${{ marginTop: '8px' }}>${Object.entries(f.equipment).map(([k, v], i) => html`<label class="field" key=${k}>${k}<input type="number" id=${'eq-' + i} min="0" value=${v} onChange=${(e) => up('equipment', { ...f.equipment, [k]: Number(e.target.value) })} /></label>`)}</div></details>
        <details><summary class="eyebrow" style=${{ cursor: 'pointer' }}>Concrete pours & inspection requests (${f.pours.length + f.insp.length})</summary>
          <div class="grid" style=${{ gap: '8px', marginTop: '8px' }}>
            ${f.pours.map((p, k) => html`<div class="diary-grid" key=${'p' + k}><label class="field">Element<input id=${'pe-' + k} value=${p.element} onChange=${(e) => up('pours', f.pours.map((x, j) => (j === k ? { ...x, element: e.target.value } : x)))} /></label><label class="field">Grade<input id=${'pg-' + k} value=${p.grade} onChange=${(e) => up('pours', f.pours.map((x, j) => (j === k ? { ...x, grade: e.target.value } : x)))} /></label><label class="field">Volume m³<input type="number" id=${'pv-' + k} value=${p.vol} onChange=${(e) => up('pours', f.pours.map((x, j) => (j === k ? { ...x, vol: Number(e.target.value) } : x)))} /></label><label class="field">Cubes taken<input type="number" id=${'pc-' + k} value=${p.cubes} onChange=${(e) => up('pours', f.pours.map((x, j) => (j === k ? { ...x, cubes: Number(e.target.value) } : x)))} /></label></div>`)}
            ${f.insp.map((p, k) => html`<div class="diary-grid" key=${'i' + k}><label class="field">Type<select id=${'it-' + k} value=${p.kind} onChange=${(e) => up('insp', f.insp.map((x, j) => (j === k ? { ...x, kind: e.target.value } : x)))}><option>WIR</option><option>MIR</option></select></label><label class="field">Reference<input id=${'ir-' + k} value=${p.ref} onChange=${(e) => up('insp', f.insp.map((x, j) => (j === k ? { ...x, ref: e.target.value } : x)))} /></label><label class="field" style=${{ gridColumn: 'span 2' }}>Description<input id=${'id-' + k} value=${p.desc} onChange=${(e) => up('insp', f.insp.map((x, j) => (j === k ? { ...x, desc: e.target.value } : x)))} /></label></div>`)}
            <div class="row"><button class="btn sm" onClick=${() => up('pours', [...f.pours, { element: '', grade: 'C40/20', vol: 0, supplier: 'Ready-mix supplier A', cubes: 6 }])}>+ Concrete pour</button><button class="btn sm" onClick=${() => up('insp', [...f.insp, { kind: 'WIR', ref: `WIR-STR-${String(200 + f.insp.length).padStart(4, '0')}`, desc: '', result: 'Pending' }])}>+ WIR / MIR</button></div>
          </div></details>
        <div class="grid g2"><label class="field">Blockers & issues<textarea id="d-block" value=${f.blockers} onChange=${(e) => up('blockers', e.target.value)} placeholder="e.g. Awaiting consultant inspection of L4 slab rebar"></textarea></label>
          <div class="field">Site photos<input type="file" id="d-photos" accept="image/*" multiple onChange=${(e) => { addPhotos(e.target.files); e.target.value = ''; }} /><div class="row">${f.photos.map((p, k) => html`<img key=${k} src=${p.src} alt=${p.caption} style=${{ width: '64px', height: '48px', objectFit: 'cover', borderRadius: '4px' }} />`)}</div><span class="note" style=${{ fontWeight: 400 }}>Photos are resized and attached to the DPR and the MPR photo log.</span></div></div>
        <div class="row"><button class="btn primary" onClick=${save}>Save daily diary</button><button class="btn ghost" onClick=${() => setF(blank())}>Clear form</button></div>
      </div>
    <//>
    <${Panel} title="Recent diaries" sub="Demo history is simulated from the baseline at a lower productivity. Your entries are marked Site engineer.">
      <div class="tw"><table class="t"><thead><tr><th>Date</th><th class="r">Manpower</th><th class="r">Value AED</th><th>Source</th><th></th></tr></thead><tbody>
        ${byDate.slice(0, 16).map(([d, ls]) => { const v = sum(ls, (l) => sum(l.qty || [], (q) => { const it = m.itemById.get(q.itemId); return it ? q.qty * it.rate : 0; })); const mp = sum(ls, (l) => sum(Object.values(l.manpower || {}))); const user = ls.filter((l) => l.user); return html`<tr key=${d}><td class="mono">${ls[0].dow || ''} ${fmtDate(E.parseISO(d))}</td><td class="r">${mp}</td><td class="r">${AED(v)}</td><td>${user.length ? html`<${Chip} tone="info">Site engineer${ls.length > user.length ? ' + demo' : ''}<//>` : html`<${Chip}>Demo<//>`}</td><td><div class="row" style=${{ flexWrap: 'nowrap' }}><button class="btn sm" onClick=${() => go('reports', 'dpr:' + d)}>DPR</button>${user.length > 0 && (confirmDel === d ? html`<button class="btn sm" style=${{ borderColor: 'var(--crit)', color: 'var(--crit)' }} onClick=${() => { setState((s) => ({ ...s, userLogs: s.userLogs.filter((l) => l.date !== d) })); setConfirmDel(null); toast('Your diary entries for that date were deleted.'); }}>Confirm delete</button>` : html`<button class="btn sm ghost" onClick=${() => setConfirmDel(d)}>Delete</button>`)}</div></td></tr>`; })}
      </tbody></table></div>
    <//>
  </div>`;
}

// ───────────────────────── reports ─────────────────────────
function ReportPreview({ rep, m }) {
  const sec = (s, i) => {
    if (s.kind === 'kpis') return html`<section key=${i}><h3>${s.title}</h3><div class="pk">${s.items.map(([k, v]) => html`<div key=${k}><span>${k}</span><b>${v}</b></div>`)}</div></section>`;
    if (s.kind === 'kv') return html`<section key=${i}><h3>${s.title}</h3><div class="paper-meta">${s.items.map(([k, v]) => html`<div key=${k}><b>${k}</b><span>${v}</span></div>`)}</div></section>`;
    if (s.kind === 'text') return html`<section key=${i}><h3>${s.title}</h3>${s.paras.map((p, k) => html`<p key=${k}>${p}</p>`)}</section>`;
    if (s.kind === 'list') return html`<section key=${i}><h3>${s.title}</h3><ul>${s.items.map((p, k) => html`<li key=${k}>${p}</li>`)}</ul></section>`;
    if (s.kind === 'chart') return html`<section key=${i}><h3>${s.title}</h3><${SCurve} months=${s.months} bac=${s.bac} cutDay=${s.cut} dataDay=${m.dataDay} height=${260} compact=${true} /></section>`;
    if (s.kind === 'photos') return html`<section key=${i}><h3>${s.title}</h3>${s.photos.length ? html`<div class="photos">${s.photos.map((p, k) => html`<figure key=${k}><img src=${photoSrc(p)} alt=${p.caption || 'Site photo'} /><figcaption>${p.caption}</figcaption></figure>`)}</div>` : html`<p class="muted">No photos for this period.</p>`}</section>`;
    const num = new Set(s.numeric || []);
    return html`<section key=${i}><h3>${s.title}</h3>${s.rows.length ? html`<div class="tw"><table class="t"><thead><tr>${s.head.map((h, k) => html`<th key=${k} class=${num.has(k) ? 'r' : ''}>${h}</th>`)}</tr></thead><tbody>${s.rows.map((r, k) => html`<tr key=${k}>${r.map((c, j) => html`<td key=${j} class=${num.has(j) || typeof c === 'number' ? 'r' : ''}>${typeof c === 'number' ? AED(c, Math.abs(c) < 100 && c % 1 ? 1 : 0) : c}</td>`)}</tr>`)}${s.total && html`<tr class="total">${s.total.map((c, j) => html`<td key=${j} class=${typeof c === 'number' ? 'r' : ''}>${typeof c === 'number' ? AED(c, Math.abs(c) < 100 && c % 1 ? 1 : 0) : c}</td>`)}</tr>`}</tbody></table></div>` : html`<p class="muted">${s.empty || 'Nothing to report.'}</p>`}</section>`;
  };
  return html`<article class="paper"><header class="paper-h"><div><span class="pn">${rep.number} · ${rep.period}</span><h2>${rep.title}</h2></div><div style=${{ textAlign: 'right' }}><b>${rep.subtitle}</b><div class="pn">Data date ${fmtDate(m.cal.date(m.dataDay))}</div></div></header>
    <div class="paper-b"><div class="paper-meta">${rep.meta.map(([k, v]) => html`<div key=${k}><b>${k}</b><span>${v}</span></div>`)}</div>${rep.empty && html`<p class="warnline">No diary was recorded for this date. Add one in the Site Diary.</p>`}${rep.sections.map(sec)}</div></article>`;
}
const pdfText = (s) => String(s ?? '').replace(/[−–—]/g, '-').replace(/²/g, '2').replace(/³/g, '3').replace(/·/g, '|').replace(/[ç]/g, 'c').replace(/[≠]/g, '!=').replace(/→/g, '->').replace(/×/g, 'x').replace(/÷/g, '/').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/✓/g, '').replace(/[^\x00-\xFF]/g, '');
function drawSCurveCanvas(s) {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 520; const g = c.getContext('2d'); const L = 80, R = 40, T = 30, B = 60; const iw = c.width - L - R, ih = c.height - T - B;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); const pts = [{ pv: 0, ev: 0, ac: 0, endDay: 0, label: '' }, ...s.months]; const n = pts.length - 1;
  const x = (i) => L + (i / n) * iw; const y = (v) => T + ih - Math.min(1.08, v / s.bac) / 1.08 * ih;
  g.font = '20px sans-serif'; g.fillStyle = '#6f7d88'; g.strokeStyle = '#e6ebee'; g.lineWidth = 2;
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => { g.beginPath(); g.moveTo(L, y(t * s.bac)); g.lineTo(L + iw, y(t * s.bac)); g.stroke(); g.textAlign = 'right'; g.fillText(t * 100 + '%', L - 10, y(t * s.bac) + 6); });
  g.textAlign = 'center'; const step = Math.ceil(n / 10); pts.forEach((p, i) => { if (i && (i % step === 0 || (i === n && n % step > step / 2))) g.fillText(p.label, x(i), c.height - 22); });
  const line = (key, col, cutOnly) => { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); let first = true; pts.forEach((p, i) => { if (cutOnly && i > 0 && pts[i - 1].endDay >= s.cut) return; const v = p[key]; if (v == null) return; if (first) { g.moveTo(x(i), y(v)); first = false; } else g.lineTo(x(i), y(v)); }); g.stroke(); };
  line('pv', '#2a78d6'); line('ac', '#1baf7a', true); line('ev', '#eb6834', true);
  g.textAlign = 'left'; [['Planned value', '#2a78d6'], ['Earned value', '#eb6834'], ['Actual cost', '#1baf7a']].forEach(([t, col], i) => { g.fillStyle = col; g.fillRect(L + i * 230, 6, 28, 6); g.fillStyle = '#44535f'; g.fillText(t, L + i * 230 + 36, 16); });
  return c.toDataURL('image/jpeg', 0.85);
}
async function reportToPDF(rep, m) {
  await loadScript(LIBS.jspdf); await loadScript(LIBS.autotable);
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' }); const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight(); const M = 36;
  doc.setFillColor(13, 74, 94); doc.rect(0, 0, W, 70, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(pdfText(rep.title), M, 32); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(pdfText(`${rep.number} | ${rep.period}`), M, 52); doc.text(pdfText(rep.subtitle), W - M, 32, { align: 'right' }); doc.text(pdfText(`Data date ${fmtDate(m.cal.date(m.dataDay))}`), W - M, 52, { align: 'right' });
  doc.setTextColor(23, 34, 43); let y = 86;
  const head = (t) => { if (y > H - 90) { doc.addPage(); y = 50; } doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(13, 74, 94); doc.text(pdfText(t.toUpperCase()), M, y); doc.setDrawColor(13, 74, 94); doc.setLineWidth(1.2); doc.line(M, y + 4, W - M, y + 4); doc.setTextColor(23, 34, 43); doc.setFont('helvetica', 'normal'); y += 12; };
  const tbl = (opts) => { doc.autoTable({ startY: y, margin: { left: M, right: M }, styles: { fontSize: 7.6, cellPadding: 3, overflow: 'linebreak' }, headStyles: { fillColor: [228, 236, 240], textColor: [23, 34, 43], fontStyle: 'bold' }, ...opts }); y = doc.lastAutoTable.finalY + 16; };
  tbl({ body: rep.meta.map(([k, v]) => [pdfText(k), pdfText(v)]), theme: 'plain', columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } } });
  const fmtCell = (c) => (typeof c === 'number' ? AED(c, Math.abs(c) < 100 && c % 1 ? 1 : 0).replace('−', '-') : pdfText(c));
  for (const s of rep.sections) {
    head(s.title);
    if (s.kind === 'kpis' || s.kind === 'kv') { const rows = []; for (let i = 0; i < s.items.length; i += 3) rows.push(s.items.slice(i, i + 3).flatMap(([k, v]) => [pdfText(k), pdfText(v)])); tbl({ body: rows, theme: 'grid', styles: { fontSize: 8 }, columnStyles: { 0: { textColor: [111, 125, 136] }, 2: { textColor: [111, 125, 136] }, 4: { textColor: [111, 125, 136] }, 1: { fontStyle: 'bold' }, 3: { fontStyle: 'bold' }, 5: { fontStyle: 'bold' } } }); }
    else if (s.kind === 'text') { doc.setFontSize(9); s.paras.forEach((p) => { const lines = doc.splitTextToSize(pdfText(p), W - 2 * M); if (y + lines.length * 12 > H - 40) { doc.addPage(); y = 50; } doc.text(lines, M, y + 6); y += lines.length * 12 + 6; }); y += 6; }
    else if (s.kind === 'list') { doc.setFontSize(9); s.items.forEach((p) => { const lines = doc.splitTextToSize('- ' + pdfText(p), W - 2 * M); if (y + lines.length * 12 > H - 40) { doc.addPage(); y = 50; } doc.text(lines, M, y + 6); y += lines.length * 12 + 2; }); y += 10; }
    else if (s.kind === 'chart') { const img = drawSCurveCanvas(s); const h = (W - 2 * M) * 520 / 1400; if (y + h > H - 40) { doc.addPage(); y = 50; } doc.addImage(img, 'JPEG', M, y, W - 2 * M, h); y += h + 14; }
    else if (s.kind === 'photos') { if (!s.photos.length) { doc.setFontSize(9); doc.text('No photos for this period.', M, y + 6); y += 20; continue; } const cw = (W - 2 * M - 20) / 3, ch = cw * 0.75; s.photos.forEach((p, k) => { const col = k % 3; if (col === 0 && k) y += ch + 24; if (y + ch + 20 > H - 30) { doc.addPage(); y = 50; } try { doc.addImage(photoSrc(p), 'JPEG', M + col * (cw + 10), y, cw, ch); } catch (e) { /* skip */ } doc.setFontSize(7); doc.text(doc.splitTextToSize(pdfText(p.caption || ''), cw)[0] || '', M + col * (cw + 10), y + ch + 10); }); y += ch + 30; }
    else if (s.rows && s.rows.length) { const num = new Set(s.numeric || []); const colStyles = {}; s.head.forEach((_, k) => { if (num.has(k)) colStyles[k] = { halign: 'right' }; }); if (s.wide != null) colStyles[s.wide] = { cellWidth: 150 }; tbl({ head: [s.head.map(pdfText)], body: [...s.rows.map((r) => r.map(fmtCell)), ...(s.total ? [s.total.map(fmtCell)] : [])], columnStyles: colStyles, didParseCell: (d) => { if (s.total && d.section === 'body' && d.row.index === s.rows.length) d.cell.styles.fontStyle = 'bold'; if (typeof (s.rows[d.row.index] || [])[d.column.index] === 'number') d.cell.styles.halign = 'right'; } }); }
    else { doc.setFontSize(9); doc.text(pdfText(s.empty || 'Nothing to report.'), M, y + 6); y += 20; }
  }
  const pages = doc.internal.getNumberOfPages(); for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(111, 125, 136); doc.text(pdfText(`${m.project.name} | ${rep.number} | Generated by SiteLedger UAE prototype`), M, H - 18); doc.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: 'right' }); }
  return doc.output('arraybuffer');
}
async function reportToXLSX(rep) {
  await loadScript(LIBS.xlsx); const wb = XLSX.utils.book_new(); const used = new Set();
  const sheetName = (t) => { let n = t.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Sheet'; let k = 2; const b = n; while (used.has(n)) n = `${b.slice(0, 25)} ${k++}`; used.add(n); return n; };
  const summary = [[rep.title], [rep.number, rep.period], [], ...rep.meta]; rep.sections.forEach((s) => { if (s.kind === 'kpis' || s.kind === 'kv') { summary.push([], [s.title], ...s.items); } if (s.kind === 'text' || s.kind === 'list') { summary.push([], [s.title], ...(s.paras || s.items).map((p) => [p])); } });
  const ws0 = XLSX.utils.aoa_to_sheet(summary); ws0['!cols'] = [{ wch: 34 }, { wch: 90 }]; XLSX.utils.book_append_sheet(wb, ws0, sheetName('Summary'));
  rep.sections.forEach((s) => { if (s.kind === 'table' && s.rows.length) { const ws = XLSX.utils.aoa_to_sheet([s.head, ...s.rows, ...(s.total ? [s.total] : [])]); ws['!cols'] = s.head.map((h, i) => ({ wch: i === (s.wide ?? 1) ? 60 : Math.max(12, String(h).length + 2) })); XLSX.utils.book_append_sheet(wb, ws, sheetName(s.title)); } if (s.kind === 'chart') { const ws = XLSX.utils.aoa_to_sheet([['Month', 'Month end', 'Planned value (cum.)', 'Earned value (cum.)', 'Actual cost (cum.)', 'PV %', 'EV %'], ...s.months.map((x) => [x.label, x.endISO, Math.round(x.pv), x.ev == null ? null : Math.round(x.ev), x.ac == null ? null : Math.round(x.ac), round((x.pv / s.bac) * 100, 2), x.ev == null ? null : round((x.ev / s.bac) * 100, 2)])]); XLSX.utils.book_append_sheet(wb, ws, sheetName('S-curve data')); } });
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

function ReportsView({ m, toast, sub, setSub }) {
  const [kind0, arg0] = (sub || 'dpr').split(':');
  const [kind, setKind] = useState(kind0 || 'dpr');
  const dates = useMemo(() => [...new Set(m.logs.map((l) => l.date))].sort().reverse(), [m.logs]);
  const [dprDate, setDprDate] = useState(arg0 && kind0 === 'dpr' ? arg0 : dates[0]);
  useEffect(() => { if (kind0 === 'dpr' && arg0) { setKind('dpr'); setDprDate(arg0); } }, [sub]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, k) => m.cal.iso(m.dataDay - 7 * k)), [m]);
  const [wk, setWk] = useState(weeks[0]);
  const curMonth = m.months.findIndex((x) => x.endDay >= m.dataDay); const [mi, setMi] = useState(curMonth);
  const rep = useMemo(() => (kind === 'dpr' ? E.dprReport(m, dprDate || m.project.dataDate) : kind === 'wpr' ? E.wprReport(m, wk) : E.mprReport(m, Math.max(0, mi))), [m, kind, dprDate, wk, mi]);
  const [busy, setBusy] = useState('');
  const fname = `${m.project.code}_${rep.number}_${kind === 'dpr' ? dprDate : kind === 'wpr' ? wk : m.months[mi].endISO.slice(0, 7)}`;
  const doPdf = async () => { setBusy('pdf'); try { const buf = await reportToPDF(rep, m); toast((await saveFile(fname + '.pdf', new Blob([buf]))).msg); } catch (e) { toast(e.message || 'PDF export failed.'); } finally { setBusy(''); } };
  const doXlsx = async () => { setBusy('xlsx'); try { const out = await reportToXLSX(rep); toast((await saveFile(fname + '.xlsx', new Blob([out]))).msg); } catch (e) { toast(e.message || 'Excel export failed.'); } finally { setBusy(''); } };
  return html`<${Fragment}>
    <${Panel} title="One-click progress reports" sub="Generated from BOQ quantities, diaries, EVM and the P6 current update. Preview below; export to PDF or Excel."
      actions=${html`<button class="btn primary" disabled=${!!busy} onClick=${doPdf}>${busy === 'pdf' ? 'Building PDF…' : 'Export PDF'}</button><button class="btn" disabled=${!!busy} onClick=${doXlsx}>${busy === 'xlsx' ? 'Building Excel…' : 'Export Excel'}</button>`}>
      <div class="row" style=${{ justifyContent: 'space-between' }}>
        <${Seg} options=${[['dpr', 'Daily (DPR)'], ['wpr', 'Weekly (WPR)'], ['mpr', 'Monthly (MPR)']]} value=${kind} onChange=${(k) => { setKind(k); setSub(k); }} />
        ${kind === 'dpr' && html`<label class="field" style=${{ flexDirection: 'row', alignItems: 'center', display: 'flex', gap: '8px' }}>Date <select class="inp sm" id="dpr-date" value=${dprDate} onChange=${(e) => setDprDate(e.target.value)} style=${{ width: 'auto' }}>${dates.map((d) => html`<option key=${d} value=${d}>${fmtDate(E.parseISO(d))}</option>`)}</select></label>`}
        ${kind === 'wpr' && html`<label class="field" style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>Week ending <select class="inp sm" id="wpr-date" value=${wk} onChange=${(e) => setWk(e.target.value)} style=${{ width: 'auto' }}>${weeks.map((d) => html`<option key=${d} value=${d}>${fmtDate(E.parseISO(d))}</option>`)}</select></label>`}
        ${kind === 'mpr' && html`<label class="field" style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>Month <select class="inp sm" id="mpr-month" value=${mi} onChange=${(e) => setMi(Number(e.target.value))} style=${{ width: 'auto' }}>${m.months.slice(0, curMonth + 1).map((x, i) => html`<option key=${i} value=${i}>${x.label}</option>`).reverse()}</select></label>`}
      </div>
    <//>
    <${ReportPreview} rep=${rep} m=${m} />
  <//>`;
}

// ───────────────────────── commercial ─────────────────────────
function CommercialView({ state, setState, m }) {
  const divs = [...new Set(m.items.map((i) => i.division))].map((d) => { const its = m.items.filter((i) => i.division === d); const amt = sum(its, (i) => i.amount); return { d, amt, ps: sum(its.filter((i) => i.ps), (i) => i.amount), ev: m.evAt(m.dataDay, (i) => i.division === d) }; });
  const setVo = (no, status) => setState((s) => ({ ...s, vos: s.vos.map((v) => (v.no === no ? { ...v, status } : v)) }));
  const adv = m.contractSum * state.project.advancePct; const last = m.ipcs[m.ipcs.length - 1];
  return html`<${Fragment}>
    <div class="kpis">
      <${Kpi} label="Original contract sum" value=${'AED ' + shortAED(m.contractSum)} detail="Excl. VAT" />
      <${Kpi} label="Approved variations" value=${'AED ' + shortAED(m.approvedVO)} detail=${`${m.vos.filter((v) => v.status !== 'Approved' && v.status !== 'Rejected').length} VOs pending, AED ${shortAED(sum(m.vos.filter((v) => v.status !== 'Approved' && v.status !== 'Rejected'), (v) => v.amount))}`} />
      <${Kpi} label="Revised contract sum" value=${'AED ' + shortAED(m.revisedSum)} detail=${`AED ${shortAED(m.revisedSum * 1.05)} incl. VAT`} />
      <${Kpi} label="Gross certified to date" value=${'AED ' + shortAED(last ? last.gross : 0)} detail=${last ? `IPC-${String(last.no).padStart(2, '0')} · ${last.status}` : 'No IPCs yet'} />
      <${Kpi} label="Retention held" value=${'AED ' + shortAED(last ? last.ret : 0)} detail=${`${pct(state.project.retentionPct, 0)} capped at ${pct(state.project.retentionCapPct, 0)} of contract`} />
      <${Kpi} label="Advance recovered" value=${'AED ' + shortAED(last ? last.rec : 0)} detail=${`of AED ${shortAED(adv)} (${pct(state.project.advancePct, 0)})`} />
    </div>
    <div class="grid g2">
      <${Panel} title="Monthly cash flow: forecast vs earned vs certified"><${MonthlyBars} months=${m.months} ipcs=${m.ipcs} dataDay=${m.dataDay} /><//>
      <${Panel} title="Budget by bill / division" pad=${false}><div class="tw"><table class="t"><thead><tr><th>Division</th><th class="r">Amount AED</th><th class="r">Weight</th><th class="r">VAT 5%</th><th class="r">Earned</th></tr></thead><tbody>
        ${divs.map((x) => html`<tr key=${x.d}><td>${x.d}${x.ps > 0 && html` <${Chip} tone="sand">PS ${shortAED(x.ps)}<//>`}</td><td class="r">${AED(x.amt)}</td><td class="r">${pct(x.amt / m.contractSum)}</td><td class="r">${AED(x.amt * 0.05)}</td><td class="r">${pct(x.ev / x.amt, 0)}</td></tr>`)}
        <tr class="total"><td>Total</td><td class="r">${AED(m.contractSum)}</td><td class="r">100%</td><td class="r">${AED(m.contractSum * 0.05)}</td><td class="r">${pct(m.evm.ev / m.contractSum, 0)}</td></tr>
      </tbody></table></div><//>
    </div>
    <${Panel} title="Interim payment certificates (IPC)" sub=${`Gross = cumulative earned value. Advance recovered at ${pct(state.project.advancePct, 0)} of gross. Retention ${pct(state.project.retentionPct, 0)} capped at ${pct(state.project.retentionCapPct, 0)} of the contract sum. VAT 5% on net.`} pad=${false}>
      <div class="tw"><table class="t"><thead><tr><th>IPC</th><th>Period</th><th class="r">Claimed (cum.)</th><th class="r">Certified gross (cum.)</th><th class="r">Advance rec. (cum.)</th><th class="r">Retention (cum.)</th><th class="r">Net this IPC</th><th class="r">VAT 5%</th><th class="r">Payable</th><th>Status</th></tr></thead><tbody>
        ${m.ipcs.map((i) => html`<tr key=${i.no}><td class="mono">IPC-${String(i.no).padStart(2, '0')}</td><td>${i.period}</td><td class="r">${AED(i.claimed)}</td><td class="r">${i.status === 'Submitted' ? '—' : AED(i.gross)}</td><td class="r">${AED(i.rec)}</td><td class="r">${AED(i.ret)}</td><td class="r">${AED(i.net)}</td><td class="r">${AED(i.vat)}</td><td class="r">${AED(i.payable)}</td><td><${Chip} tone=${statusTone(i.status)}>${i.status}<//></td></tr>`)}
      </tbody></table></div>
    <//>
    <${Panel} title="Variation orders" pad=${false}><div class="tw"><table class="t"><thead><tr><th>VO</th><th>Description</th><th class="r">Amount AED</th><th class="r">Time (days)</th><th>Status</th></tr></thead><tbody>
      ${m.vos.map((v) => html`<tr key=${v.no}><td class="mono">${v.no}</td><td>${v.title}</td><td class="r">${AED(v.amount)}</td><td class="r">${v.days}</td><td><select class="inp sm" id=${'vo-' + v.no} value=${v.status} onChange=${(e) => setVo(v.no, e.target.value)} style=${{ width: 'auto' }}>${['Submitted', 'Under review', 'Approved', 'Rejected'].map((s) => html`<option key=${s}>${s}</option>`)}</select></td></tr>`)}
    </tbody></table></div><//>
  <//>`;
}

// ───────────────────────── architecture ─────────────────────────
function BlueprintView() {
  const layers = [
    ['Clients', [['Office web app', 'Next.js 15 · React 19 · TypeScript · Tailwind'], ['Field PWA', 'Offline diary, camera, background sync (IndexedDB)'], ['Consultant / client portal', 'Read-only dashboards, approvals']]],
    ['Edge & BFF', [['Next.js BFF', 'SSO (Entra ID / Auth0), RBAC, caching'], ['Object storage', 'S3 in a UAE region, signed URLs']]],
    ['Domain services (FastAPI)', [['boq-ingest', 'openpyxl · pdfplumber · OCR · Claude classification'], ['wbs-planner', 'Template WBS, productivity norms, logic'], ['cpm-scheduler', 'Forward/backward pass, UAE calendars, float'], ['p6-exchange', 'XER / P6 XML read & write'], ['cost-control', 'EVM, IPC, VAT, VOs'], ['docs-control', 'MAR/SD/MS/ITP/WIR, authority NOCs'], ['reporting', 'DPR/WPR/MPR → WeasyPrint PDF, XlsxWriter']]],
    ['Data & jobs', [['PostgreSQL 16', 'RLS, pg_trgm, pgvector'], ['Redis + workers', 'Parsing, CPM runs, report rendering'], ['Audit log', 'Every write, before/after']]],
  ];
  const tables = [['projects', 'Contract, authority (DM/DDA/Trakhees), dates, VAT, retention'], ['boq_uploads · boq_divisions · boq_items', 'Parsed lines, stage mapping, confidence, embedding'], ['wbs_nodes', '16-stage WBS hierarchy'], ['calendars · calendar_exceptions', 'Work week, UAE holidays, summer & Ramadan factors'], ['productivity_norms', 'Output per day by work type and unit'], ['schedule_versions', 'Baseline / current / recovery / P6 import, data date'], ['activities · activity_relationships', 'P6 activity data: OD/RD, ES/EF/LS/LF, AS/AF, TF, critical, FS/SS/FF + lag'], ['activity_boq_items', 'Quantity share of each BOQ item per activity'], ['budget_lines · cashflow_periods · item_progress_snapshots', 'Budget, S-curve, EVM history'], ['variation_orders · payment_certificates', 'VOs and IPCs'], ['submittals · inspection_requests · authority_permits · procurement_items', 'Document control & approvals'], ['daily_logs (+ manpower, equipment, quantities, pours) · site_photos', 'Field diary'], ['ncrs · risks · generated_reports · p6_exchange_log', 'Quality, risk, report snapshots, XER import/export history']];
  return html`<div class="grid g2">
    <${Panel} title="System architecture" sub="Full write-up in docs/ARCHITECTURE.md"><div class="arch">${layers.map(([n, boxes]) => html`<div class="arch-layer" key=${n}><b>${n}</b><div class="arch-boxes">${boxes.map(([t, d]) => html`<span key=${t}>${t}<em>${d}</em></span>`)}</div></div>`)}</div>
      <h4 class="eyebrow" style=${{ margin: '16px 0 8px' }}>BOQ-to-execution pipeline</h4>
      <ol style=${{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '13px' }}><li>Upload → detect header → extract items, bills, provisional sums</li><li>Validate qty × rate, units, duplicates</li><li>Classify to 16 UAE stages (rules → division fallback → Claude)</li><li>Generate WBS, activities, durations from norms, FS/SS/FF logic</li><li>CPM on the UAE calendar → baseline → PV S-curve and cash flow</li><li>Generate submittals, WIRs, NOCs and long-lead procurement</li><li>Diaries → executed qty → EV/AC → P6 update → DPR/WPR/MPR</li></ol><//>
    <${Panel} title="Database schema (PostgreSQL)" sub="Full DDL in db/schema.sql"><div class="tw"><table class="t"><thead><tr><th>Tables</th><th>Purpose</th></tr></thead><tbody>${tables.map(([t, d]) => html`<tr key=${t}><td class="mono" style=${{ fontSize: '12px' }}>${t}</td><td>${d}</td></tr>`)}</tbody></table></div><//>
  </div>`;
}

// ───────────────────────── project settings ─────────────────────────
function ProjectSettings({ state, setState, toast }) {
  const p = state.project; const set = (k, v) => setState((s) => ({ ...s, project: { ...s.project, [k]: v } }));
  return html`<${Panel} title="Project & contract settings" sub="Changing dates or the authority regenerates the programme, NOCs and reports.">
    <div class="diary-grid">
      <label class="field">Project name<input id="p-name" value=${p.name} onChange=${(e) => set('name', e.target.value)} /></label>
      <label class="field">Contract no.<input id="p-cno" value=${p.contractNo} onChange=${(e) => set('contractNo', e.target.value)} /></label>
      <label class="field">Permitting authority<select id="p-auth" value=${p.authority} onChange=${(e) => set('authority', e.target.value)}>${Object.entries(E.AUTH_NAMES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></label>
      <label class="field">Commencement date<input type="date" id="p-start" value=${p.startDate} onChange=${(e) => e.target.value && set('startDate', e.target.value)} /></label>
      <label class="field">Contract duration (months)<input type="number" id="p-dur" min="6" max="60" value=${p.durationMonths} onChange=${(e) => set('durationMonths', Math.max(6, Math.min(60, Number(e.target.value) || 20)))} /></label>
      <label class="field">Retention %<input type="number" id="p-ret" step="0.5" value=${p.retentionPct * 100} onChange=${(e) => set('retentionPct', (Number(e.target.value) || 0) / 100)} /></label>
      <label class="field">Advance payment %<input type="number" id="p-adv" step="0.5" value=${p.advancePct * 100} onChange=${(e) => set('advancePct', (Number(e.target.value) || 0) / 100)} /></label>
      <div class="field">Reset<button class="btn sm" onClick=${() => { store.del('siteledger-v2'); setState(initialState()); toast('Prototype reset to the sample project.'); }}>Reset prototype</button></div>
    </div><//>`;
}

// ───────────────────────── app shell ─────────────────────────
const TABS = [['overview', 'Dashboard'], ['boq', 'BOQ ingest'], ['lifecycle', 'Lifecycle & budget'], ['programme', 'P6 programme'], ['docs', 'Submittals & NOCs'], ['diary', 'Site diary'], ['reports', 'Reports'], ['commercial', 'Commercial'], ['blueprint', 'Architecture']];
const TITLES = { overview: 'Project control dashboard', boq: 'BOQ ingestion & auto-mapping', lifecycle: 'Lifecycle, quantities & budget', programme: 'Primavera P6 planning & lookahead', docs: 'Submittals, inspections & authority NOCs', diary: 'Site diary (field app)', reports: 'Progress reports', commercial: 'Budget, cash flow, IPCs & variations', blueprint: 'Architecture & data model' };
function App() {
  const [state, setState] = useState(initialState);
  const readHash = () => { const h = (location.hash || '').slice(1); return TABS.some(([k]) => k === h) ? h : 'overview'; };
  const [tab, setTab] = useState(readHash); const [subs, setSubs] = useState({ programme: 'gantt', docs: 'nocs', reports: 'dpr' });
  const [msg, setMsg] = useState(''); const tRef = useRef(null);
  const toast = useCallback((t) => { setMsg(t); clearTimeout(tRef.current); tRef.current = setTimeout(() => setMsg(''), 4800); }, []);
  useEffect(() => { const f = () => setTab(readHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { const t = setTimeout(() => { if (!store.set('siteledger-v2', state)) { const lite = { ...state, userLogs: (state.userLogs || []).map((l) => ({ ...l, photos: [] })) }; store.set('siteledger-v2', lite); } }, 400); return () => clearTimeout(t); }, [state]);
  const model = useMemo(() => { try { return { m: E.buildModel(state) }; } catch (e) { console.error(e); return { err: e.message || String(e) }; } }, [state]);
  const go = (t, sub) => { if (sub) setSubs((s) => ({ ...s, [t]: sub })); if (location.hash !== '#' + t) location.hash = t; setTab(t); window.scrollTo({ top: 0 }); };
  const setSub = (t) => (v) => setSubs((s) => ({ ...s, [t]: v }));
  const m = model.m; const p = state.project;
  return html`<div class="app">
    <nav class="rail" aria-label="Modules">
      <div class="brand"><div class="brand-mark">SL</div><div><b>SiteLedger UAE</b><span>BOQ → execution</span></div></div>
      <div class="proj-card"><b>${p.name}</b><span class="muted">${p.plot} · ${E.AUTH_NAMES[p.authority]}</span><span class="muted">Contract ${p.contractNo}</span>${m && html`<span class="num">AED ${AED(m.contractSum * 1.05)} incl. VAT</span>`}</div>
      <div class="nav">${TABS.map(([k, l], i) => html`<a key=${k} href=${'#' + k} aria-current=${tab === k ? 'page' : undefined} onClick=${(e) => { e.preventDefault(); go(k); }}><span class="k">${String(i + 1).padStart(2, '0')}</span>${l}</a>`)}</div>
      <div class="rail-foot"><span>Prototype with sample data. Figures are illustrative, not the user's records.</span><span>Data date ${fmtDate(E.parseISO(p.dataDate))}</span></div>
    </nav>
    <main class="main"><div class="main-inner">
      <div class="topbar"><div><div class="eyebrow">${p.name} · ${p.contractNo}</div><h1>${TITLES[tab]}</h1></div><div class="row"><span class="datechip"><i></i>Data date ${fmtDate(E.parseISO(p.dataDate))}</span>${state.p6Import && html`<${Chip} tone="info">P6 import active<//>`}${state.boq.source === 'upload' && html`<${Chip} tone="sand">Uploaded BOQ<//>`}</div></div>
      ${!m ? html`<${Panel} title="The project could not be calculated"><p>${model.err}</p><button class="btn" onClick=${() => { store.del('siteledger-v2'); setState(initialState()); }}>Reset to sample project</button><//>` : html`<${Fragment}>
        ${tab === 'overview' && html`<${Dashboard} m=${m} go=${go} /><${ProjectSettings} state=${state} setState=${setState} toast=${toast} />`}
        ${tab === 'boq' && html`<${BoqView} state=${state} setState=${setState} m=${m} toast=${toast} />`}
        ${tab === 'lifecycle' && html`<${LifecycleView} m=${m} />`}
        ${tab === 'programme' && html`<${ProgrammeView} state=${state} setState=${setState} m=${m} toast=${toast} sub=${subs.programme} setSub=${setSub('programme')} />`}
        ${tab === 'docs' && html`<${DocsView} state=${state} setState=${setState} m=${m} sub=${subs.docs} setSub=${setSub('docs')} />`}
        ${tab === 'diary' && html`<${DiaryView} state=${state} setState=${setState} m=${m} toast=${toast} go=${go} />`}
        ${tab === 'reports' && html`<${ReportsView} m=${m} toast=${toast} sub=${subs.reports} setSub=${setSub('reports')} />`}
        ${tab === 'commercial' && html`<${CommercialView} state=${state} setState=${setState} m=${m} />`}
        ${tab === 'blueprint' && html`<${BlueprintView} />`}
      <//>`}
    </div></main>
    ${msg && html`<div class="toast" role="status">${msg}</div>`}
  </div>`;
}
ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
