/* SiteLedger UAE — domain engine (pure functions, no DOM).
   BOQ parsing → classification → P6-style CPM schedule → PV/EV/AC → documents → reports. */
(function (root) {
'use strict';

// ───────────────────────── utilities ─────────────────────────
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round = (x, n = 0) => { const p = 10 ** n; return Math.round(x * p) / p; };
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);
function hash01(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtDate(ms) { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2,'0')}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`; }
function addMonthsISO(s, n) { const d = new Date(parseISO(s)); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); }
const AED = (x, dp = 0) => (x < 0 ? '−' : '') + Math.abs(x).toLocaleString('en-AE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const shortAED = (x) => { const a = Math.abs(x); const s = x < 0 ? '−' : ''; if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M'; if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'k'; return s + a.toFixed(0); };

// ───────────────────────── 16 lifecycle stages ─────────────────────────
const STAGES = [
  { no: 1,  code: 'PC', name: 'Pre-Construction', desc: 'Programme, cash flow, submittal & shop drawing schedules, ITPs, HSE & QA/QC plans' },
  { no: 2,  code: 'AU', name: 'Authority Approvals & Permits', desc: 'DM / DDA / Trakhees, DEWA, RTA, Civil Defence NOCs & permits' },
  { no: 3,  code: 'MB', name: 'Site Mobilization & Preparation', desc: 'Site establishment, hoarding, welfare, survey & setting out' },
  { no: 4,  code: 'SB', name: 'Substructure Works', desc: 'Piling, shoring, excavation, dewatering, waterproofing, foundations' },
  { no: 5,  code: 'SS', name: 'Superstructure – RCC', desc: 'Columns, core walls, PT slabs, floor cycles' },
  { no: 6,  code: 'BW', name: 'Blockwork & Masonry', desc: 'External & internal blockwork, lintels, stiffeners' },
  { no: 7,  code: 'M1', name: "MEP First Fix & Builder's Work", desc: 'Conduits, containment, pipework, ductwork, sleeves' },
  { no: 8,  code: 'FN', name: 'Plastering & Internal Finishing', desc: 'Plaster, screed, tiling, ceilings, paint, joinery' },
  { no: 9,  code: 'FC', name: 'External Façade & Roof', desc: 'Aluminium & glazing, GRC, roofing & waterproofing' },
  { no: 10, code: 'M2', name: 'MEP Second Fix', desc: 'Wiring & devices, sanitary, equipment, lifts, ELV' },
  { no: 11, code: 'EX', name: 'External Infrastructure & Site Development', desc: 'Substation, drainage, roads, paving, landscaping' },
  { no: 12, code: 'TC', name: 'Testing & Commissioning', desc: 'TAB, Civil Defence, DEWA, integrated systems' },
  { no: 13, code: 'SN', name: 'Snagging & Rectification', desc: 'Snag lists, rectification, de-snag walk' },
  { no: 14, code: 'HO', name: 'Final Cleaning & Handover', desc: 'As-builts, O&M manuals, completion certificates' },
  { no: 15, code: 'DL', name: 'Defects Liability Period & Closure', desc: '12-month DLP, retention release, final account' },
  { no: 16, code: 'PM', name: 'Project Management & Document Control', desc: 'Site management, document control, time-related prelims' },
];
const stageByNo = (n) => STAGES[n - 1];

// ───────────────────────── classification rules ─────────────────────────
// docs flags: M=MAR, S=shop drawing, D=method statement, I=ITP, W=WIR, P=plan submittal, H=handover document
const R = (id, re, stage, o = {}) => ({ id, re, stage, trade: 'GEN', docs: '', lot: 0, ...o });
const RULES = [
  R('contingency', /contingenc/i, 16, { reserve: true, wt: 'Contingency reserve' }),
  R('authfee', /(provisional sum|\bps\b).*(permit|authority|dewa|civil defen|rta|etisalat|\bdu\b|municipality|trakhees|dda|noc)|(permit|connection|inspection|noc)\b.*\b(fees?|charges)/i, 2, { wt: 'Authority fees & charges' }),
  R('programme', /programme|cash ?flow forecast|submittal.*schedule|procurement schedule|primavera/i, 1, { wt: 'Baseline programme & schedules', docs: 'P' }),
  R('plans', /hse plan|quality (management )?plan|itp register|environmental (management )?plan|qa\/?qc plan|logistics plan/i, 1, { wt: 'HSE, QA/QC & environmental plans', docs: 'P' }),
  R('insurance', /insurance|bank guarantee|performance bond/i, 1, { wt: 'Insurances & bonds' }),
  R('tandc', /testing,? adjust|balanc|\btab\b|commissioning|integrated systems? test|pressure test|chlorinat|disinfect|energi[sz]/i, 12, { trade: 'MEP', docs: 'DI', wt: 'Testing & commissioning' }),
  R('demob', /demobili/i, 14, { wt: 'Demobilisation' }),
  R('mob', /mobili[sz]ation|site establishment|site offices?|hoarding|welfare/i, 3, { wt: 'Mobilisation & site establishment' }),
  R('temp', /temporary (power|water|electric)/i, 16, { wt: 'Temporary services', loe: true }),
  R('crane', /tower crane|hoist/i, 16, { wt: 'Tower crane & hoisting', loe: true }),
  R('staff', /supervision|management staff|site staff|document control|progress report/i, 16, { wt: 'Site management & document control', loe: true }),
  R('clean', /clean/i, 14, { wt: 'Final cleaning' }),
  R('asbuilt', /as-?built|o&m|operation (and|&) maintenance manual|handover doc/i, 14, { wt: 'As-builts, O&M & handover documents', docs: 'H' }),
  R('snag', /snag/i, 13, { wt: 'Snagging & rectification' }),
  R('dlp', /defects? liability|\bdlp\b|maintenance of (the )?works/i, 15, { wt: 'DLP maintenance' }),
  R('survey', /site clearance|topographic|setting out/i, 3, { trade: 'CIV', wt: 'Site clearance & survey' }),
  R('shoring', /shoring|sheet.?pil|secant|soldier pile/i, 4, { trade: 'STR', docs: 'MSDIW', lot: 60, wt: 'Shoring' }),
  R('dewater', /dewater/i, 4, { trade: 'CIV', docs: 'SDI', wt: 'Dewatering' }),
  R('piling', /pil(e|ing)/i, 4, { trade: 'STR', docs: 'MSDIW', lot: 16, wt: 'Piling' }),
  R('excav', /excavat/i, 4, { trade: 'CIV', docs: 'DIW', lot: 2500, wt: 'Bulk excavation' }),
  R('blinding', /blinding/i, 4, { trade: 'STR', docs: 'MIW', lot: 80, wt: 'Blinding' }),
  R('subwp', /waterproof.*(raft|retaining|basement|foundation|substructure)|tanking/i, 4, { trade: 'ARC', docs: 'MSDIW', lot: 600, wt: 'Substructure waterproofing' }),
  R('termite', /termite/i, 4, { trade: 'CIV', docs: 'MDW', lot: 1000, wt: 'Anti-termite treatment' }),
  R('backfill', /backfill|compaction/i, 4, { trade: 'CIV', docs: 'MDIW', lot: 600, wt: 'Backfilling' }),
  R('found', /raft|foundation|footing|pile cap|retaining wall|ground beam|substructure/i, 4, { trade: 'STR', docs: 'MSDIW', lot: 150, wt: 'Raft & retaining walls' }),
  R('rebar', /reinforcement|rebar|steel bars/i, 5, { trade: 'STR', docs: 'MSIW', lot: 40, wt: 'Reinforcement', byDivision: true }),
  R('roofwp', /roof (waterproof|insulation)|inverted roof/i, 9, { trade: 'ARC', docs: 'MSDIW', lot: 500, wt: 'Roof waterproofing & insulation' }),
  R('block', /block ?work|masonry|partition|lintel|stiffener/i, 6, { trade: 'ARC', docs: 'MDIW', lot: 1500, wt: 'Blockwork' }),
  R('facade', /alumin|window|curtain wall|glazing|grc|fa[cç]ade|external paint|balustrade|louvre|cladding panel/i, 9, { trade: 'FAC', docs: 'MSDIW', lot: 300, wt: 'Façade & glazing' }),
  R('pt', /post.?tension|\bpt\b|flat slab/i, 5, { trade: 'STR', docs: 'MSDIW', lot: 800, wt: 'PT slabs' }),
  R('rcc', /column|core wall|shear wall|slab|beam|stair|parapet|superstructure/i, 5, { trade: 'STR', docs: 'MSDIW', lot: 60, wt: 'RCC frame' }),
  R('bwic', /builder'?s work|core cutting|sleeves/i, 7, { trade: 'MEP', docs: 'SW', lot: 0.1, wt: "Builder's work in connection" }),
  R('firstfix', /first fix|conduit|containment|cable tray|ductwork|pipework|sprinkler|hose reel/i, 7, { trade: 'MEP', docs: 'MSDIW', lot: 0.1, wt: 'MEP first fix' }),
  R('plaster', /plaster|render|screed/i, 8, { trade: 'ARC', docs: 'MDIW', lot: 2500, wt: 'Plaster & screed' }),
  R('finish', /tile|tiling|ceiling|gypsum|paint|door|joinery|cabinet|marble|granite|ironmongery|wardrobe|countertop/i, 8, { trade: 'ARC', docs: 'MSIW', lot: 800, wt: 'Internal finishes' }),
  R('substation', /substation|\brmu\b|transformer/i, 11, { trade: 'MEP', docs: 'MSDIW', lot: 0.25, longLead: true, leadWk: 20, wt: 'DEWA substation' }),
  R('lift', /\blifts?\b|elevator/i, 10, { trade: 'MEP', docs: 'MSDIW', lot: 1, longLead: true, leadWk: 18, wt: 'Passenger lifts' }),
  R('genset', /generator/i, 10, { trade: 'MEP', docs: 'MSDIW', lot: 1, longLead: true, leadWk: 16, wt: 'Standby generator' }),
  R('hvac', /vrf|chiller|\bahu\b|\bfcu\b|split|air.?condition|dx unit/i, 10, { trade: 'MEP', docs: 'MSDIW', lot: 0.1, longLead: true, leadWk: 14, wt: 'HVAC equipment' }),
  R('firepump', /fire pump/i, 10, { trade: 'MEP', docs: 'MSDIW', lot: 1, longLead: true, leadWk: 12, wt: 'Fire pump set' }),
  R('panels', /lv panel|main panel|\bmdbs?\b|switchgear|distribution board/i, 10, { trade: 'MEP', docs: 'MSDIW', lot: 0.2, longLead: true, leadWk: 12, wt: 'LV panels & MDBs' }),
  R('secondfix', /second fix|wiring|switch|socket|light fitting|sanitary|water heater|pump|tank|cctv|access control|matv|intercom|\belv\b|fire alarm/i, 10, { trade: 'MEP', docs: 'MSDIW', lot: 0.1, wt: 'MEP second fix' }),
  R('external', /drainage|manhole|sewer|asphalt|paving|interlock|kerb|road|parking|boundary wall|gate|landscap|irrigation|external lighting|swimming pool|\bpool\b|planting/i, 11, { trade: 'CIV', docs: 'MSDIW', lot: 400, wt: 'External works' }),
];
const DIVISION_FALLBACK = [
  [/prelim|general/i, 16], [/authority|provisional/i, 2], [/sub-?structure|earthwork|piling|foundation/i, 4],
  [/super-?structure|concrete|rcc|structural/i, 5], [/block|masonry/i, 6], [/finish|plaster|joinery/i, 8],
  [/fa[cç]ade|roof|glazing|cladding/i, 9], [/mep|mechanical|electrical|plumbing|hvac|fire/i, 10],
  [/external|infrastructure|landscap/i, 11], [/testing|commission/i, 12],
];
const STAGE_TRADE = { 3: 'CIV', 4: 'STR', 5: 'STR', 6: 'ARC', 7: 'MEP', 8: 'ARC', 9: 'FAC', 10: 'MEP', 11: 'CIV', 12: 'MEP' };

function classify(desc, division) {
  const text = desc || '';
  for (const r of RULES) {
    if (r.re.test(text)) {
      let stage = r.stage, group = r.id;
      if (r.byDivision && /sub-?structure|foundation|earthwork|piling/i.test(division || '')) { stage = 4; group = 'found'; }
      if (r.id === 'rcc' || r.id === 'pt' || (r.id === 'rebar' && stage === 5)) group = 'frame';
      const longLead = r.longLead || (r.id === 'facade' && /alumin|curtain/i.test(text));
      const leadWk = r.leadWk || (longLead ? 14 : 0);
      return { stage, rule: r.id, group, trade: r.trade, docs: r.docs, lot: r.lot, wt: r.wt, reserve: !!r.reserve, loe: !!r.loe, longLead, leadWk, conf: 0.92, source: 'Rule' };
    }
  }
  for (const [re, st] of DIVISION_FALLBACK) {
    if (re.test(division || '')) return { stage: st, rule: 'div', group: 'gen' + st, trade: STAGE_TRADE[st] || 'GEN', docs: st >= 4 && st <= 11 ? 'MSIW' : '', lot: 0.1, wt: 'Other works', conf: 0.6, source: 'Division' };
  }
  return { stage: 16, rule: 'none', group: 'gen16', trade: 'GEN', docs: '', lot: 0, wt: 'Unclassified', conf: 0.3, source: 'None' };
}
function applyStageOverride(it) {
  if (!it.stageOverride || it.stageOverride === it.cls.stage) return it.cls;
  const st = it.stageOverride;
  return { ...it.cls, stage: st, group: 'gen' + st, rule: 'user', trade: STAGE_TRADE[st] || 'GEN', docs: st >= 4 && st <= 11 ? 'MSIW' : '', lot: 0.1, wt: 'Other works', conf: 1, source: it.overrideSource || 'User', loe: false, longLead: false, leadWk: 0 };
}

// ───────────────────────── sample BOQ (G+4 residential, Dubai) ─────────────────────────
const SAMPLE_BOQ = [
  ['SAMPLE — Bill of Quantities: G+4+Roof Residential Building, Al Furjan, Dubai (illustrative rates)'],
  [],
  ['Item', 'Description', 'Unit', 'Qty', 'Rate (AED)', 'Amount (AED)'],
  ['', 'BILL No. 1 — PRELIMINARIES & GENERAL REQUIREMENTS'],
  ['1.01', 'Mobilisation, site establishment, site offices, welfare facilities and temporary hoarding', 'LS', 1, 420000],
  ['1.02', 'Project management and site supervision staff (PM, CM, engineers, QA/QC, HSE) for 20 months', 'month', 20, 165000],
  ['1.03', 'Baseline programme (Primavera P6), cash flow forecast, submittal & procurement schedules', 'LS', 1, 45000],
  ['1.04', 'Project HSE plan, quality management plan, ITP register and environmental plan', 'LS', 1, 38000],
  ['1.05', 'Temporary power (generator) and water supply until DEWA permanent connection', 'month', 18, 22000],
  ['1.06', 'Tower crane supply, erection, operation and dismantling', 'month', 10, 48000],
  ['1.07', "Contractor's All Risk insurance, performance & advance payment bank guarantees", 'LS', 1, 185000],
  ['1.08', 'Document control, EDMS licence and monthly progress reporting', 'month', 20, 9500],
  ['1.09', 'Final cleaning of building and site prior to handover', 'LS', 1, 65000],
  ['1.10', 'As-built drawings, O&M manuals, warranties and handover documentation', 'LS', 1, 55000],
  ['1.11', 'Snagging and rectification works allowance', 'LS', 1, 120000],
  ['1.12', 'Maintenance of works during the 12-month Defects Liability Period', 'LS', 1, 90000],
  ['1.13', 'Demobilisation and removal of temporary facilities', 'LS', 1, 60000],
  ['', 'Total carried to Collection', '', '', '', 7038000],
  ['', 'BILL No. 2 — AUTHORITY FEES & PROVISIONAL SUMS'],
  ['2.01', 'Provisional sum for Dubai Municipality building permit and inspection fees', 'PS', 1, 150000],
  ['2.02', 'Provisional sum for DEWA electricity & water connection charges', 'PS', 1, 650000],
  ['2.03', 'Provisional sum for Civil Defence approvals, inspections and completion certificate', 'PS', 1, 45000],
  ['2.04', 'Provisional sum for RTA right-of-way and road access NOC fees', 'PS', 1, 30000],
  ['2.05', 'Provisional sum for Etisalat / du telecom infrastructure NOC and connection', 'PS', 1, 40000],
  ['', 'BILL No. 3 — SUBSTRUCTURE'],
  ['3.01', 'Site clearance and topographic survey', 'm2', 2400, 6],
  ['3.02', 'Secant pile shoring system incl. monitoring', 'm', 210, 2900],
  ['3.03', 'Dewatering system incl. monitoring and discharge', 'LS', 1, 240000],
  ['3.04', 'Bored cast-in-situ piles 600mm dia., 18m deep, incl. reinforcement', 'nr', 96, 6800],
  ['3.05', 'Static pile load test and pile integrity tests', 'nr', 3, 28000],
  ['3.06', 'Cutting and trimming pile heads', 'nr', 96, 350],
  ['3.07', 'Bulk excavation in any material incl. disposal off-site', 'm3', 9800, 32],
  ['3.08', 'Blinding concrete C20, 75mm thick under foundations', 'm3', 160, 420],
  ['3.09', 'Anti-termite treatment to ground', 'm2', 2200, 14],
  ['3.10', 'Waterproofing membrane to raft & retaining walls incl. protection board', 'm2', 2900, 95],
  ['3.11', 'Reinforced concrete raft foundation C40 incl. formwork', 'm3', 1450, 980],
  ['3.12', 'Reinforced concrete retaining walls C40', 'm3', 380, 1150],
  ['3.13', 'Reinforcement steel bars Grade 460B to substructure', 'ton', 210, 3450],
  ['3.14', 'Backfilling with approved material, compacted in layers', 'm3', 2600, 45],
  ['', 'BILL No. 4 — SUPERSTRUCTURE (RCC)'],
  ['4.01', 'RC columns C50 incl. formwork', 'm3', 620, 1350],
  ['4.02', 'RC core walls and shear walls C50', 'm3', 540, 1250],
  ['4.03', 'Post-tensioned flat slabs C40, 250mm, incl. tendons & stressing', 'm2', 9600, 285],
  ['4.04', 'RC beams and drop panels C40', 'm3', 310, 1280],
  ['4.05', 'Reinforcement steel bars Grade 460B to superstructure', 'ton', 520, 3450],
  ['4.06', 'RC staircases and landings', 'm3', 95, 1450],
  ['4.07', 'Roof slab and parapets', 'm2', 1950, 310],
  ['', 'BILL No. 5 — BLOCKWORK & MASONRY'],
  ['5.01', '200mm hollow concrete blockwork to external walls', 'm2', 6800, 72],
  ['5.02', '100/150mm solid block internal partitions', 'm2', 11200, 58],
  ['5.03', 'Lintels, tie beams and stiffener columns', 'm', 3100, 85],
  ['', "BILL No. 6 — MEP FIRST FIX & BUILDER'S WORK"],
  ['6.01', "Builder's work in connection with services: sleeves, openings, core cutting", 'LS', 1, 180000],
  ['6.02', 'Electrical conduits, back boxes and cable trays (first fix)', 'LS', 1, 860000],
  ['6.03', 'Plumbing water supply PPR pipework first fix', 'LS', 1, 540000],
  ['6.04', 'Drainage uPVC soil, waste and vent pipework first fix', 'LS', 1, 480000],
  ['6.05', 'HVAC ductwork, refrigerant pipework and insulation', 'LS', 1, 1650000],
  ['6.06', 'Fire fighting sprinkler and hose reel pipework', 'LS', 1, 720000],
  ['6.07', 'Fire alarm and ELV containment', 'LS', 1, 210000],
  ['', 'BILL No. 7 — PLASTER & INTERNAL FINISHES'],
  ['7.01', 'Internal cement plaster 15–20mm', 'm2', 28500, 28],
  ['7.02', 'External cement render', 'm2', 7200, 42],
  ['7.03', 'Cement sand screed to floors 50–75mm', 'm2', 9400, 38],
  ['7.04', 'Porcelain floor tiles 600x600 incl. skirting', 'm2', 8100, 145],
  ['7.05', 'Ceramic wall tiles to wet areas', 'm2', 5600, 120],
  ['7.06', 'Gypsum board false ceilings', 'm2', 6900, 95],
  ['7.07', 'Emulsion paint to walls and ceilings, 3 coats', 'm2', 34000, 18],
  ['7.08', 'Timber flush doors incl. ironmongery', 'nr', 260, 2650],
  ['7.09', 'Kitchen cabinets and granite countertops', 'nr', 60, 14500],
  ['7.10', 'Marble cladding to entrance lobby', 'm2', 380, 520],
  ['', 'BILL No. 8 — FAÇADE & ROOF'],
  ['8.01', 'Aluminium windows and sliding doors, double glazed, thermal break', 'm2', 2100, 1150],
  ['8.02', 'Curtain wall glazing to lobby and staircase', 'm2', 420, 1650],
  ['8.03', 'Roof waterproofing, inverted roof system incl. insulation and tiles', 'm2', 1950, 210],
  ['8.04', 'GRC cladding panels and feature elements', 'm2', 1250, 480],
  ['8.05', 'External paint, textured elastomeric', 'm2', 7200, 32],
  ['8.06', 'Balcony glass balustrades', 'm', 640, 780],
  ['', 'BILL No. 9 — MEP SECOND FIX & EQUIPMENT'],
  ['9.01', 'Electrical wiring, switches, sockets and light fittings (second fix)', 'LS', 1, 1120000],
  ['9.02', 'Main LV panel, MDBs and SMDBs', 'LS', 1, 780000],
  ['9.03', 'Sanitary wares and fittings', 'LS', 1, 640000],
  ['9.04', 'Water pumps, tanks and water heaters', 'LS', 1, 360000],
  ['9.05', 'VRF air-conditioning units incl. controls', 'LS', 1, 2150000],
  ['9.06', 'Fire alarm system devices and panel (DCD approved)', 'LS', 1, 330000],
  ['9.07', 'Fire pump set (electric, diesel, jockey)', 'LS', 1, 280000],
  ['9.08', 'Passenger lifts, 13-person, 6 stops', 'nr', 2, 265000],
  ['9.09', 'ELV systems: CCTV, access control, MATV, intercom', 'LS', 1, 390000],
  ['9.10', 'Standby diesel generator 500 kVA', 'nr', 1, 310000],
  ['', 'BILL No. 10 — EXTERNAL WORKS'],
  ['10.01', '11kV substation building, RMU and 1500 kVA transformer (DEWA standard)', 'LS', 1, 1250000],
  ['10.02', 'External drainage, manholes and connection to DM sewer', 'LS', 1, 340000],
  ['10.03', 'Asphalt road and parking incl. sub-base', 'm2', 1800, 95],
  ['10.04', 'Interlocking paving to walkways', 'm2', 1100, 85],
  ['10.05', 'Boundary wall and gates', 'm', 230, 1450],
  ['10.06', 'Landscaping, irrigation and planting', 'LS', 1, 260000],
  ['10.07', 'External lighting', 'LS', 1, 140000],
  ['10.08', 'Roof-level swimming pool incl. filtration plant', 'LS', 1, 480000],
  ['', 'BILL No. 11 — TESTING & COMMISSIONING'],
  ['11.01', 'Testing, adjusting and balancing (TAB) of HVAC systems', 'LS', 1, 140000],
  ['11.02', 'Integrated systems testing (fire & life safety) and Civil Defence inspection', 'LS', 1, 95000],
  ['11.03', 'Electrical testing, DEWA inspection and energisation', 'LS', 1, 85000],
  ['11.04', 'Water and drainage pressure testing, disinfection and chlorination', 'LS', 1, 45000],
  ['', 'BILL No. 12 — CONTINGENCY'],
  ['12.01', 'Contingency sum, to be expended as directed by the Engineer', 'PS', 1, 600000],
  [],
  ['', 'GRAND TOTAL (excluding VAT)'],
];

// ───────────────────────── BOQ parser ─────────────────────────
const UNIT_MAP = { cum: 'm3', 'cu.m': 'm3', m3: 'm3', 'm³': 'm3', sqm: 'm2', 'sq.m': 'm2', m2: 'm2', 'm²': 'm2', lm: 'm', rm: 'm', m: 'm', 'l.m': 'm', no: 'nr', 'no.': 'nr', nos: 'nr', nr: 'nr', each: 'nr', ea: 'nr', set: 'set', t: 'ton', ton: 'ton', tons: 'ton', tonne: 'ton', kg: 'kg', ls: 'LS', 'l.s': 'LS', 'l.s.': 'LS', lump: 'LS', item: 'LS', sum: 'LS', ps: 'PS', 'p.s': 'PS', 'p.s.': 'PS', month: 'month', months: 'month', mth: 'month', day: 'day', days: 'day', wk: 'week', week: 'week' };
const normUnit = (u) => { const k = String(u || '').trim().toLowerCase(); return UNIT_MAP[k] || String(u || '').trim(); };
const toNum = (v) => { if (typeof v === 'number') return v; if (v == null) return NaN; const s = String(v).replace(/[, ]|AED|aed|Dhs\.?/g, '').trim(); if (s === '' || s === '-') return NaN; return Number(s); };

function detectHeader(rows) {
  const keys = { ref: /^(item|ref|s\.? ?no|no\.?|code)\b/i, desc: /desc|particular|work item/i, unit: /^unit|uom/i, qty: /qty|quant/i, rate: /rate|unit price/i, amount: /amount|total|value/i };
  let best = { score: 0, row: -1, map: null };
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] || []; const map = {}; let score = 0;
    row.forEach((cell, c) => {
      const s = String(cell ?? '').trim(); if (!s) return;
      for (const [k, re] of Object.entries(keys)) if (map[k] == null && re.test(s)) { map[k] = c; score++; break; }
    });
    if (score > best.score) best = { score, row: r, map };
  }
  return best.score >= 3 ? best : null;
}

function parseRows(rows, fileName = 'BOQ') {
  const log = []; const warnings = [];
  const head = detectHeader(rows);
  let map, start;
  if (head) { map = head.map; start = head.row + 1; log.push(`Header found on row ${head.row + 1}: ` + Object.entries(map).map(([k, v]) => `${k}→col ${String.fromCharCode(65 + v)}`).join(', ')); }
  else { map = { ref: 0, desc: 1, unit: 2, qty: 3, rate: 4, amount: 5 }; start = 0; warnings.push('No header row detected; assumed columns A–F = Item, Description, Unit, Qty, Rate, Amount.'); }
  if (map.desc == null) { map.desc = 1; }
  const items = []; const divisions = []; let division = 'General'; const refs = new Set(); let skipped = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] || [];
    const desc = String(row[map.desc] ?? '').trim();
    const ref = map.ref != null ? String(row[map.ref] ?? '').trim() : '';
    const qty = toNum(row[map.qty]); const rate = toNum(row[map.rate]); const amtRead = map.amount != null ? toNum(row[map.amount]) : NaN;
    if (!desc && !ref) continue;
    if (/(^|\b)(sub-?total|total|carried|collection|brought forward|grand)/i.test(desc) && !(qty > 0 && rate > 0)) { skipped++; continue; }
    const isHeading = (!(qty > 0) && !(rate > 0) && !(amtRead > 0)) || /^bill\s*(no\.?)?\s*\d+/i.test(desc) && !(qty > 0);
    if (isHeading) { division = desc.replace(/\s+/g, ' ').replace(/^bill\s*no\.?\s*(\d+)\s*[—–:-]\s*/i, 'Bill $1 – '); divisions.push(division); continue; }
    let unit = normUnit(row[map.unit]);
    let q = qty, rt = rate;
    if (!(q > 0) && amtRead > 0) { q = 1; rt = amtRead; if (!unit) unit = 'LS'; }
    if (!(rt > 0) && amtRead > 0 && q > 0) rt = amtRead / q;
    if (!(q > 0) || !(rt > 0)) { warnings.push(`Row ${r + 1} (${ref || desc.slice(0, 30)}): missing quantity or rate, skipped.`); skipped++; continue; }
    const amount = round(q * rt, 2);
    if (amtRead > 0 && Math.abs(amtRead - amount) / amount > 0.01) warnings.push(`Item ${ref || r + 1}: printed amount AED ${AED(amtRead)} ≠ qty × rate AED ${AED(amount)}. Recalculated.`);
    let finalRef = ref || `R${r + 1}`; if (refs.has(finalRef)) { warnings.push(`Duplicate item ref ${finalRef}; renamed ${finalRef}-b.`); finalRef += '-b'; }
    refs.add(finalRef);
    const ps = unit === 'PS' || /provisional sum/i.test(desc);
    items.push({ id: 'i' + items.length, ref: finalRef, desc, unit: unit || 'LS', qty: q, rate: round(rt, 2), amount, division, ps, row: r + 1 });
  }
  if (!divisions.length) divisions.push('General');
  log.push(`${items.length} priced line items extracted across ${divisions.length} bills/divisions; ${skipped} heading/total rows skipped.`);
  items.forEach((it) => { it.cls = classify(it.desc, it.division); });
  return { fileName, items, divisions, warnings, log, columnMap: map };
}

// Line-based extraction for text pulled out of PDFs
function parsePdfLines(lines) {
  const rows = [['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']];
  const unitRe = '(m3|m³|cum|m2|m²|sqm|m|lm|rm|nr|no\\.?|nos|ton|t|kg|ls|l\\.s\\.?|item|sum|ps|p\\.s\\.?|month|set|day)';
  const re = new RegExp(`^\\s*([A-Z]?\\d+(?:\\.\\d+)*[a-z]?)?\\s+(.+?)\\s+${unitRe}\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d,]+(?:\\.\\d+)?)(?:\\s+([\\d,]+(?:\\.\\d+)?))?\\s*$`, 'i');
  for (const line of lines) {
    const m = line.match(re);
    if (m) rows.push([m[1] || '', m[2], m[3], m[4], m[5], m[6] || '']);
    else if (/^\s*(bill|section|division|part)\b/i.test(line) || /^[A-Z][A-Z &,'/-]{6,}$/.test(line.trim())) rows.push(['', line.trim()]);
  }
  return rows;
}

// ───────────────────────── UAE calendar ─────────────────────────
// Islamic dates are estimates and move with moon sighting; confirm on official announcement.
const UAE_HOLIDAYS = [
  ['2026-01-01', "New Year's Day"], ['2026-03-20', 'Eid al-Fitr'], ['2026-03-21', 'Eid al-Fitr'], ['2026-03-22', 'Eid al-Fitr'],
  ['2026-05-26', 'Arafat Day'], ['2026-05-27', 'Eid al-Adha'], ['2026-05-28', 'Eid al-Adha'], ['2026-05-29', 'Eid al-Adha'],
  ['2026-06-16', 'Hijri New Year'], ['2026-08-25', "Prophet's Birthday"], ['2026-12-01', 'Commemoration Day'], ['2026-12-02', 'National Day'], ['2026-12-03', 'National Day'],
  ['2027-01-01', "New Year's Day"], ['2027-03-10', 'Eid al-Fitr'], ['2027-03-11', 'Eid al-Fitr'], ['2027-03-12', 'Eid al-Fitr'],
  ['2027-05-15', 'Arafat Day'], ['2027-05-16', 'Eid al-Adha'], ['2027-05-17', 'Eid al-Adha'], ['2027-05-18', 'Eid al-Adha'],
  ['2027-06-06', 'Hijri New Year'], ['2027-08-14', "Prophet's Birthday"], ['2027-12-01', 'Commemoration Day'], ['2027-12-02', 'National Day'], ['2027-12-03', 'National Day'],
  ['2028-01-01', "New Year's Day"], ['2028-02-26', 'Eid al-Fitr'], ['2028-02-27', 'Eid al-Fitr'], ['2028-02-28', 'Eid al-Fitr'],
  ['2028-05-04', 'Arafat Day'], ['2028-05-05', 'Eid al-Adha'], ['2028-05-06', 'Eid al-Adha'], ['2028-05-07', 'Eid al-Adha'],
  ['2028-05-25', 'Hijri New Year'], ['2028-08-03', "Prophet's Birthday"], ['2028-12-01', 'Commemoration Day'], ['2028-12-02', 'National Day'], ['2028-12-03', 'National Day'],
];
const RAMADAN = [['2026-02-18', '2026-03-19'], ['2027-02-08', '2027-03-09'], ['2028-01-28', '2028-02-25']];
const DEFAULT_CAL = { offDays: [5], holidays: true, summer: true, summerFactor: 0.85, ramadan: true, ramadanFactor: 0.8, hoursPerDay: 9 };

function buildCalendar(startISO, cal, horizon = 1600) {
  const s0 = parseISO(startISO); const PRE = 500; const N = PRE + horizon;
  const hol = new Map(cal.holidays ? UAE_HOLIDAYS : []);
  const ram = RAMADAN.map(([a, b]) => [parseISO(a), parseISO(b)]);
  const work = new Uint8Array(N), capIn = new Float32Array(N), capOut = new Float32Array(N), pref = new Int32Array(N + 1);
  const flags = new Array(N);
  for (let i = 0; i < N; i++) {
    const ms = s0 + (i - PRE) * DAY; const d = new Date(ms); const dow = d.getUTCDay(); const key = iso(ms);
    const md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const isOff = cal.offDays.includes(dow); const holName = hol.get(key);
    const inRam = cal.ramadan && ram.some(([a, b]) => ms >= a && ms <= b);
    const inSummer = cal.summer && md >= 615 && md <= 915;
    const w = !isOff && !holName; work[i] = w ? 1 : 0;
    const rf = inRam ? cal.ramadanFactor : 1; const sf = inSummer ? cal.summerFactor : 1;
    capIn[i] = w ? rf : 0; capOut[i] = w ? rf * sf : 0;
    flags[i] = { holName, inRam, inSummer, isOff };
    pref[i + 1] = pref[i] + work[i];
  }
  const ix = (d) => clamp(d + PRE, 0, N - 1);
  const C = {
    startISO, s0, PRE, N,
    isWork: (d) => work[ix(d)] === 1,
    cap: (d, cls) => (cls === 'out' ? capOut : capIn)[ix(d)],
    info: (d) => flags[ix(d)],
    nextWork(d) { let x = d; while (!work[ix(x)] && x < horizon) x++; return x; },
    prevWork(d) { let x = d; while (!work[ix(x)] && x > -PRE) x--; return x; },
    fwd(d, k) { let x = d; let n = k; while (n > 0) { x++; if (work[ix(x)]) n--; } return x; },
    back(d, k) { let x = d; let n = k; while (n > 0) { x--; if (work[ix(x)]) n--; } return x; },
    addWork(es, dur, cls) { if (dur <= 0) return es; let acc = 0, x = es; const arr = cls === 'out' ? capOut : capIn; for (let g = 0; g < 5000; g++) { acc += arr[ix(x)]; if (acc >= dur - 1e-6) return x; x++; } return x; },
    subWork(lf, dur, cls) { if (dur <= 0) return lf; let acc = 0, x = lf; const arr = cls === 'out' ? capOut : capIn; for (let g = 0; g < 5000; g++) { acc += arr[ix(x)]; if (acc >= dur - 1e-6) return x; x--; } return x; },
    wd: (a, b) => pref[ix(b) + 1] - pref[ix(a) + 1], // working days in (a, b]
    date: (d) => s0 + d * DAY,
    dayOf: (ms) => Math.round((ms - s0) / DAY),
    iso: (d) => iso(s0 + d * DAY),
    fmt: (d) => fmtDate(s0 + d * DAY),
    summary(fromD, toD) { let w = 0, h = 0, r = 0, s = 0; for (let d = fromD; d <= toD; d++) { const f = flags[ix(d)]; if (work[ix(d)]) w++; if (f.holName) h++; if (f.inRam && work[ix(d)]) r++; if (f.inSummer && work[ix(d)]) s++; } return { work: w, holidays: h, ramadan: r, summer: s }; },
  };
  return C;
}

// ───────────────────────── productivity norms ─────────────────────────
const DEFAULT_NORMS = [
  { id: 'pilehead', label: 'Pile head trimming', match: 'pile head|trimming', unit: 'nr', perDay: 20 },
  { id: 'piletest', label: 'Pile load / integrity tests', match: 'load test|integrity', unit: 'nr', perDay: 0.25 },
  { id: 'pile', label: 'Bored piles (2 rigs)', match: 'pile', unit: 'nr', perDay: 6 },
  { id: 'shore', label: 'Secant / sheet-pile shoring', match: 'shoring|secant|sheet', unit: 'm', perDay: 9 },
  { id: 'clear', label: 'Site clearance & survey', match: 'clearance|survey', unit: 'm2', perDay: 400 },
  { id: 'excav', label: 'Bulk excavation', match: 'excavat', unit: 'm3', perDay: 380 },
  { id: 'blind', label: 'Blinding concrete', match: 'blinding', unit: 'm3', perDay: 40 },
  { id: 'subwp', label: 'Substructure waterproofing', match: 'waterproof', unit: 'm2', perDay: 200 },
  { id: 'raft', label: 'Raft concrete incl. formwork', match: 'raft|foundation', unit: 'm3', perDay: 70 },
  { id: 'retwall', label: 'Retaining walls', match: 'retaining', unit: 'm3', perDay: 16 },
  { id: 'subrebar', label: 'Rebar fixing – substructure', match: 'reinforcement|rebar', unit: 'ton', perDay: 9 },
  { id: 'backfill', label: 'Backfilling & compaction', match: 'backfill', unit: 'm3', perDay: 200 },
  { id: 'termite', label: 'Anti-termite treatment', match: 'termite', unit: 'm2', perDay: 700 },
  { id: 'block', label: 'Blockwork (all gangs)', match: 'block', unit: 'm2', perDay: 95 },
  { id: 'lintel', label: 'Lintels & stiffeners', match: 'lintel|tie beam|stiffener', unit: 'm', perDay: 60 },
  { id: 'plaster', label: 'Internal plaster', match: 'plaster', unit: 'm2', perDay: 300 },
  { id: 'render', label: 'External render', match: 'render', unit: 'm2', perDay: 200 },
  { id: 'screed', label: 'Floor screed', match: 'screed', unit: 'm2', perDay: 300 },
  { id: 'tile', label: 'Floor & wall tiling', match: 'tile', unit: 'm2', perDay: 55 },
  { id: 'paint', label: 'Internal painting', match: 'paint', unit: 'm2', perDay: 700 },
  { id: 'ceiling', label: 'Gypsum false ceilings', match: 'ceiling', unit: 'm2', perDay: 75 },
  { id: 'door', label: 'Doors & ironmongery', match: 'door', unit: 'nr', perDay: 8 },
  { id: 'kitchen', label: 'Kitchen cabinets', match: 'kitchen|cabinet', unit: 'nr', perDay: 2.5 },
  { id: 'marble', label: 'Marble cladding', match: 'marble', unit: 'm2', perDay: 15 },
  { id: 'window', label: 'Aluminium windows & doors', match: 'window|sliding', unit: 'm2', perDay: 22 },
  { id: 'cw', label: 'Curtain wall', match: 'curtain', unit: 'm2', perDay: 10 },
  { id: 'grc', label: 'GRC cladding', match: 'grc|cladding', unit: 'm2', perDay: 18 },
  { id: 'extpaint', label: 'External paint', match: 'external paint|textured', unit: 'm2', perDay: 200 },
  { id: 'balus', label: 'Glass balustrades', match: 'balustrade', unit: 'm', perDay: 15 },
  { id: 'roofwp', label: 'Roof waterproofing system', match: 'roof', unit: 'm2', perDay: 60 },
  { id: 'asphalt', label: 'Asphalt paving', match: 'asphalt', unit: 'm2', perDay: 200 },
  { id: 'paving', label: 'Interlocking paving', match: 'paving|interlock', unit: 'm2', perDay: 70 },
  { id: 'bwall', label: 'Boundary wall', match: 'boundary', unit: 'm', perDay: 6 },
  { id: 'lift', label: 'Lift installation (per car)', match: 'lift|elevator', unit: 'nr', perDay: 1 / 40 },
  { id: 'gen', label: 'Generator installation', match: 'generator', unit: 'nr', perDay: 1 / 20 },
];
// Fixed durations (working days) for lump-sum work packages without a measurable norm
const DEFAULT_FIXED = { programme: 20, plans: 15, insurance: 10, mob: 25, survey: 8, dewater: 70, firstfix: 125, bwic: 0, secondfix: 130, hvac: 55, panels: 30, firepump: 25, substation: 80, external: 95, tandc: 45, snag: 30, clean: 15, asbuilt: 30, demob: 12, dlp: 310, gen: 20, procSubmittal: 30 };
const DEFAULT_SCHED = { floors: 4, floorCycle: 15, roofCycle: 12 };

// ───────────────────────── authority NOC templates ─────────────────────────
const AUTH_NAMES = { DM: 'Dubai Municipality', DDA: 'Dubai Development Authority', TRAKHEES: 'Trakhees (PCFC)' };
function nocTemplates(authority) {
  const A = AUTH_NAMES[authority] || 'Dubai Municipality';
  return [
    { key: 'noc_affection', auth: A, name: 'Affection plan & site demarcation', sla: 5, stage: 2, preds: [['ntp', 'FS', 0]] },
    { key: 'noc_bp', auth: A, name: 'Building permit (structural & architectural approval)', sla: 30, stage: 2, preds: [['noc_affection', 'FS', 0]] },
    { key: 'noc_dewa_load', auth: 'DEWA', name: 'Electricity load NOC (building permit stage)', sla: 15, stage: 2, preds: [['noc_bp', 'SS', 0]] },
    { key: 'noc_dewa_water', auth: 'DEWA', name: 'Water NOC (building permit stage)', sla: 10, stage: 2, preds: [['noc_bp', 'SS', 0]] },
    { key: 'noc_rta_access', auth: 'RTA', name: 'Right-of-way & site access NOC', sla: 12, stage: 2, preds: [['noc_bp', 'SS', 5]] },
    { key: 'noc_telecom', auth: 'Etisalat / du', name: 'Telecom infrastructure NOC', sla: 10, stage: 2, preds: [['noc_bp', 'SS', 5]] },
    { key: 'noc_shoring', auth: A, name: 'Excavation & shoring permit', sla: 12, stage: 2, preds: [['noc_bp', 'SS', 10]], trigger: /shoring|excavat/i },
    { key: 'noc_dewater', auth: 'DM Environment', name: 'Dewatering & discharge permit', sla: 15, stage: 2, preds: [['noc_bp', 'SS', 10]], trigger: /dewater/i },
    { key: 'noc_dcd_dwg', auth: 'Civil Defence', name: 'Fire & life safety drawings approval', sla: 25, stage: 2, preds: [['noc_bp', 'FS', 20]] },
    { key: 'noc_substation', auth: 'DEWA', name: 'Substation NOC & RMU / transformer approval', sla: 30, stage: 2, preds: [['noc_dewa_load', 'FS', 60]], trigger: /substation|\brmu\b|transformer/i },
    { key: 'noc_drain', auth: authority === 'DM' ? 'Dubai Municipality' : A, name: 'Sewer / drainage connection NOC', sla: 20, stage: 2, preds: [['noc_bp', 'FS', 120]], trigger: /sewer|manhole|drainage connection/i },
    { key: 'noc_road', auth: 'RTA', name: 'Road cutting & utility trench NOC', sla: 15, stage: 2, preds: [['noc_bp', 'FS', 140]], trigger: /road|asphalt|parking/i },
    { key: 'noc_pool', auth: 'DM Public Health', name: 'Swimming pool permit & inspection', sla: 15, stage: 12, preds: [['external', 'FS', 0]], trigger: /\bpool\b/i },
    { key: 'noc_energise', auth: 'DEWA', name: 'DEWA final inspection & energisation', sla: 15, stage: 12, preds: [['substation', 'FS', 0]] },
    { key: 'noc_lift', auth: A, name: 'Lift inspection & operating certificate', sla: 10, stage: 12, preds: [['lift', 'FS', 0]], trigger: /\blifts?\b|elevator/i },
    { key: 'noc_dcd_final', auth: 'Civil Defence', name: 'Civil Defence final inspection & completion certificate', sla: 15, stage: 12, preds: [['tandc', 'FS', 0]] },
    { key: 'noc_water_final', auth: 'DEWA', name: 'Water meter & final water connection', sla: 10, stage: 12, preds: [['tandc', 'SS', 10]] },
    { key: 'noc_bcc', auth: A, name: 'Building Completion Certificate', sla: 20, stage: 14, preds: [['noc_dcd_final', 'FS', 0], ['noc_energise', 'FS', 0]] },
    { key: 'noc_makani', auth: A, name: 'Makani number & address plate', sla: 5, stage: 14, preds: [['noc_bcc', 'SS', 0]] },
  ];
}

// ───────────────────────── schedule generation (WBS + activities + logic) ─────────────────────────
const FLOORWISE = ['frame', 'block', 'firstfix', 'plaster', 'finish', 'secondfix'];
const OUTDOOR_STAGES = new Set([3, 4, 5, 9, 11]);
const GROUP_NAMES = {
  frame: 'RCC frame – columns, core walls & PT slab', block: 'Blockwork & lintels', firstfix: 'MEP first fix', plaster: 'Plaster & screed',
  finish: 'Tiling, ceilings, joinery & paint', secondfix: 'MEP second fix & devices',
};

function normFor(item, norms) {
  for (const n of norms) {
    if (n.unit !== item.unit) continue;
    try { if (new RegExp(n.match, 'i').test(item.desc)) return n; } catch (e) { /* bad user regex */ }
  }
  return null;
}

function generateSchedule(items, settings, project) {
  const { norms, fixed, sched } = settings;
  const levelsFrame = ['Ground floor', ...Array.from({ length: sched.floors }, (_, i) => `Level ${i + 1}`), 'Roof'];
  const levelsUse = levelsFrame.slice(0, -1);
  const groups = new Map();
  for (const it of items) {
    const c = applyStageOverride(it);
    if (c.reserve) continue;
    const key = c.group;
    if (!groups.has(key)) groups.set(key, { key, stage: c.stage, wt: c.wt, items: [], cls: c });
    groups.get(key).items.push(it);
  }
  const acts = []; const rels = []; const byKey = new Map(); const counters = {};
  const nextCode = (stage) => { const st = stageByNo(stage); counters[st.code] = (counters[st.code] || 1000) + 10; return `${st.code}${counters[st.code]}`; };
  const add = (a) => { a.code = a.code || nextCode(a.stage); a.idx = acts.length; acts.push(a); if (a.key) byKey.set(a.key, a); return a; };
  const itemDur = (it, g) => { const n = normFor(it, norms); if (n && n.perDay > 0) return { d: Math.ceil(it.qty / n.perDay), basis: `${AED(it.qty, it.qty % 1 ? 1 : 0)} ${it.unit} ÷ ${n.perDay >= 1 ? AED(n.perDay, n.perDay % 1 ? 1 : 0) + ' ' + it.unit + '/day' : round(1 / n.perDay) + ' days/' + it.unit}`, norm: n.id }; return { d: fixed[g] ?? 20, basis: `Fixed ${fixed[g] ?? 20} d (lump sum)`, norm: null }; };

  // Milestone & pre-construction skeleton
  add({ key: 'ntp', name: 'Notice to Proceed / Commencement Date', stage: 1, type: 'TT_Mile', dur: 0, cls: 'in', items: [], wbs: 1 });
  const groupDur = (g) => {
    let best = { d: 0, basis: '' };
    for (const it of g.items) { const r = itemDur(it, g.key); if (r.d > best.d) best = r; }
    if (!g.items.length || best.d === 0) best = { d: fixed[g.key] ?? 20, basis: `Fixed ${fixed[g.key] ?? 20} d` };
    return best;
  };
  const simpleGroup = (key, name, opts = {}) => {
    const g = groups.get(key); if (!g && !opts.always) return null;
    const dd = g ? groupDur(g) : { d: fixed[key] ?? 15, basis: `Fixed ${fixed[key] ?? 15} d` };
    const stage = g ? g.stage : opts.stage;
    return add({ key, name: name || g.wt, stage, type: 'TT_Task', dur: opts.dur ?? dd.d, basis: opts.basis ?? dd.basis, cls: OUTDOOR_STAGES.has(stage) ? 'out' : 'in', items: g ? g.items.map((it) => ({ id: it.id, share: 1 })) : [], wbs: stage, group: key });
  };
  const L = (from, to, type = 'FS', lag = 0) => { rels.push({ from, to, type, lag }); };
  const has = (k) => byKey.has(k);
  const pick = (...ks) => ks.find((k) => has(k));

  simpleGroup('programme', 'Baseline programme, cash flow & submittal schedule', { always: true, stage: 1 });
  simpleGroup('plans', 'HSE, QA/QC, ITP & environmental plans', { always: true, stage: 1 });
  simpleGroup('insurance', 'Insurances, performance & advance payment bonds');
  ['programme', 'plans', 'insurance'].forEach((k) => has(k) && L('ntp', k));

  // Authority NOCs (template + BOQ triggers)
  const allText = items.map((i) => i.desc).join(' | ');
  const nocs = nocTemplates(project.authority).filter((n) => !n.trigger || n.trigger.test(allText));
  const nocDefs = [];
  for (const n of nocs) {
    const trig = n.trigger ? items.find((i) => n.trigger.test(i.desc)) : null;
    const a = add({ key: n.key, name: `${n.auth}: ${n.name}`, stage: 2, type: 'TT_Task', dur: n.sla, basis: `Authority review SLA ${n.sla} d`, cls: 'in', items: [], wbs: 2, noc: { ...n, triggerRef: trig ? trig.ref : null } });
    nocDefs.push({ a, n });
  }
  // Long-lead procurement
  const procKeys = [];
  for (const g of groups.values()) {
    if (!g.items.some((it) => applyStageOverride(it).longLead)) continue;
    const lead = Math.max(...g.items.map((it) => applyStageOverride(it).leadWk || 0)) || 12;
    const sub = add({ key: 'sub_' + g.key, name: `Submittal approval (MAR + shop drawings) – ${g.wt}`, stage: 1, type: 'TT_Task', dur: fixed.procSubmittal, basis: `Consultant review cycle ${fixed.procSubmittal} d`, cls: 'in', items: [], wbs: 1, proc: true });
    const pr = add({ key: 'proc_' + g.key, name: `Procure, manufacture & deliver – ${g.wt}`, stage: 1, type: 'TT_Task', dur: Math.round(lead * 6), basis: `Supplier lead time ${lead} weeks`, cls: 'in', items: [], wbs: 1, proc: true, leadWk: lead, groupKey: g.key });
    procKeys.push(g.key);
  }

  // Mobilisation & substructure
  simpleGroup('mob', null, { always: true, stage: 3 });
  simpleGroup('survey');
  ['shoring', 'dewater', 'piling', 'excav', 'blinding', 'termite', 'subwp', 'found', 'backfill'].forEach((k) => simpleGroup(k));

  // Floor-wise chains
  const chain = {};
  for (const key of FLOORWISE) {
    const g = groups.get(key); if (!g) continue;
    const levels = key === 'frame' ? levelsFrame : levelsUse;
    const total = groupDur(g);
    const valueTotal = sum(g.items, (i) => i.amount);
    chain[key] = levels.map((lvl, k) => {
      let dur, basis;
      if (key === 'frame') { dur = k === levels.length - 1 ? sched.roofCycle : sched.floorCycle; basis = `Floor cycle ${dur} d`; }
      else { dur = Math.max(3, Math.ceil(total.d / levels.length)); basis = `${total.basis} → ${levels.length} floors`; }
      return add({ key: `${key}@${k}`, name: `${GROUP_NAMES[key] || g.wt} – ${lvl}`, stage: g.stage, type: 'TT_Task', dur, basis, cls: OUTDOOR_STAGES.has(g.stage) ? 'out' : 'in', items: [], wbs: g.stage, group: key, floor: k, level: lvl });
    });
    // distribute each item equally across floors, in floor order
    g.items.forEach((it) => { chain[key].forEach((a) => a.items.push({ id: it.id, share: 1 / levels.length })); });
    void valueTotal;
  }
  const C = (key, k) => (chain[key] ? chain[key][k === 'last' ? chain[key].length - 1 : k] : null);
  const ck = (key, k) => { const a = C(key, k); return a ? a.key : null; };

  // Remaining single groups
  ['bwic', 'roofwp', 'facade', 'hvac', 'lift', 'genset', 'panels', 'firepump', 'substation', 'external', 'tandc', 'snag', 'clean', 'asbuilt', 'demob', 'dlp'].forEach((k) => simpleGroup(k));
  // Generic groups from overrides / division fallbacks
  for (const g of groups.values()) {
    if (byKey.has(g.key) || chain[g.key] || ['authfee', 'temp', 'crane', 'staff'].includes(g.key)) continue;
    simpleGroup(g.key, `${stageByNo(g.stage).name} – ${g.wt}`);
  }
  if (!has('snag')) add({ key: 'snag', name: 'Snagging & rectification', stage: 13, type: 'TT_Task', dur: fixed.snag, basis: `Fixed ${fixed.snag} d`, cls: 'in', items: [], wbs: 13 });
  add({ key: 'completion', name: 'Practical Completion / Taking-Over Certificate', stage: 14, type: 'TT_FinMile', dur: 0, cls: 'in', items: [], wbs: 14 });
  if (!has('dlp')) add({ key: 'dlp', name: 'Defects Liability Period (12 months)', stage: 15, type: 'TT_Task', dur: fixed.dlp, basis: '12 months', cls: 'in', items: [], wbs: 15 });
  else byKey.get('dlp').name = 'Defects Liability Period (12 months) & maintenance';
  add({ key: 'dlp_end', name: 'Performance Certificate / final retention release', stage: 15, type: 'TT_FinMile', dur: 0, cls: 'in', items: [], wbs: 15 });

  // LOE (time-related preliminaries, authority fees)
  const loe = (key, name, startKey, finishKey, stage) => { const g = groups.get(key); if (!g) return; add({ key, name, stage, type: 'TT_LOE', dur: 0, basis: 'Level of effort', cls: 'in', items: g.items.map((it) => ({ id: it.id, share: 1 })), wbs: stage, group: key }); L(startKey, key, 'SS', 0); L(finishKey, key, 'FF', 0); };

  // ── logic ──
  for (const { a, n } of nocDefs) for (const [p, t, lag] of n.preds) { const pk = p === 'external' || p === 'substation' || p === 'lift' || p === 'tandc' ? (has(p) ? p : null) : p; if (pk && has(pk)) L(pk, a.key, t, lag); }
  const PROC_ANCHOR = { facade: ['found', 0], substation: ['found', 10], lift: ['frame@0', 0], hvac: ['frame@1', 0], panels: ['frame@2', 0], firepump: ['frame@2', 0], genset: ['frame@2', 0] };
  for (const g of procKeys) { L('programme', 'sub_' + g); const an = PROC_ANCHOR[g]; if (an && has(an[0])) L(an[0], 'sub_' + g, 'SS', an[1]); L('sub_' + g, 'proc_' + g); }
  L(pick('noc_bp', 'ntp'), 'mob'); L('ntp', 'mob', 'SS', 0);
  if (has('survey')) L('mob', 'survey', 'SS', 5);
  const afterSurvey = pick('survey', 'mob');
  if (has('shoring')) { L(afterSurvey, 'shoring'); if (has('noc_shoring')) L('noc_shoring', 'shoring'); }
  if (has('dewater')) { L(pick('shoring', afterSurvey), 'dewater', 'SS', 5); if (has('noc_dewater')) L('noc_dewater', 'dewater'); }
  if (has('piling')) { L(afterSurvey, 'piling'); L(pick('noc_bp', 'ntp'), 'piling'); }
  if (has('excav')) { L(pick('piling', 'shoring', afterSurvey), 'excav'); if (has('shoring')) L('shoring', 'excav'); if (has('dewater')) L('dewater', 'excav', 'SS', 5); }
  const exc = byKey.get('excav');
  if (has('blinding')) L(pick('excav', afterSurvey), 'blinding', exc ? 'SS' : 'FS', exc ? Math.ceil(exc.dur * 0.6) : 0);
  if (has('termite')) L(pick('blinding', 'excav', afterSurvey), 'termite');
  if (has('subwp')) L(pick('blinding', 'excav', afterSurvey), 'subwp', 'FS', 2);
  if (has('found')) { L(pick('subwp', 'blinding', 'excav', afterSurvey), 'found', has('subwp') ? 'SS' : 'FS', has('subwp') ? 5 : 0); if (has('blinding')) L('blinding', 'found'); }
  if (has('backfill')) L(pick('found', 'excav', afterSurvey), 'backfill', 'FS', 7);
  const subEnd = pick('found', 'excav', 'piling', afterSurvey);
  if (chain.frame) chain.frame.forEach((a, k) => L(k === 0 ? subEnd : chain.frame[k - 1].key, a.key));
  if (chain.block) chain.block.forEach((a, k) => { const above = C('frame', k + 1) || C('frame', 'last'); if (above) L(above.key, a.key, 'FS', 7); if (k > 0) L(chain.block[k - 1].key, a.key); });
  if (chain.firstfix) chain.firstfix.forEach((a, k) => { const b = C('block', k); if (b) L(b.key, a.key, 'SS', 5); else L(pick(ck('frame', 'last'), subEnd), a.key); if (k > 0) L(chain.firstfix[k - 1].key, a.key, 'SS', Math.ceil(a.dur / 2)); if (k === 0 && has('noc_dcd_dwg')) L('noc_dcd_dwg', a.key); });
  if (has('bwic') && chain.firstfix) { L(ck('firstfix', 0), 'bwic', 'SS', 0); L(ck('firstfix', 'last'), 'bwic', 'FF', 0); byKey.get('bwic').dur = Math.max(10, byKey.get('bwic').dur); }
  else if (has('bwic')) L(pick(ck('block', 0), subEnd), 'bwic');
  if (chain.plaster) chain.plaster.forEach((a, k) => { const f = C('firstfix', k); if (f) L(f.key, a.key); else L(pick(ck('block', k), subEnd), a.key); if (k > 0) L(chain.plaster[k - 1].key, a.key, 'SS', Math.ceil(a.dur / 2)); });
  if (has('roofwp')) L(pick(ck('frame', 'last'), subEnd), 'roofwp', 'FS', 14);
  if (has('facade')) { L(pick(ck('block', 1), ck('block', 0), ck('frame', 'last'), subEnd), 'facade', 'SS', 10); if (has('proc_facade')) L('proc_facade', 'facade'); }
  if (chain.finish) chain.finish.forEach((a, k) => { const p = C('plaster', k); if (p) L(p.key, a.key, 'FS', 3); else L(pick(ck('block', k), subEnd), a.key); if (k > 0) L(chain.finish[k - 1].key, a.key, 'SS', Math.ceil(a.dur / 2)); });
  if (chain.secondfix) chain.secondfix.forEach((a, k) => { const f = C('finish', k); if (f) { L(f.key, a.key, 'SS', Math.ceil(f.dur * 0.4)); L(f.key, a.key, 'FF', 5); } else L(pick(ck('firstfix', k), subEnd), a.key); if (k > 0) L(chain.secondfix[k - 1].key, a.key, 'SS', Math.ceil(a.dur / 2)); });
  const lastInternal = pick(ck('secondfix', 'last'), ck('finish', 'last'), ck('firstfix', 'last'), ck('block', 'last'), ck('frame', 'last'), subEnd);
  if (has('hvac')) { L(pick(ck('firstfix', 'last'), subEnd), 'hvac'); if (has('roofwp')) L('roofwp', 'hvac'); if (has('proc_hvac')) L('proc_hvac', 'hvac'); }
  if (has('lift')) { L(pick(ck('frame', 'last'), subEnd), 'lift', 'FS', 20); if (has('proc_lift')) L('proc_lift', 'lift'); }
  if (has('panels')) { L(pick(ck('secondfix', 0), ck('firstfix', 'last'), subEnd), 'panels', 'SS', 0); if (has('proc_panels')) L('proc_panels', 'panels'); }
  if (has('firepump')) { L(pick(ck('firstfix', 'last'), subEnd), 'firepump'); if (has('proc_firepump')) L('proc_firepump', 'firepump'); }
  if (has('external')) { L(has('facade') ? 'facade' : pick(ck('frame', 'last'), subEnd), 'external', has('facade') ? 'SS' : 'FS', has('facade') ? Math.ceil(byKey.get('facade').dur * 0.5) : 30); if (has('backfill')) L('backfill', 'external'); if (has('noc_drain')) L('noc_drain', 'external'); if (has('noc_road')) L('noc_road', 'external'); }
  if (has('substation')) { L(pick('external', subEnd), 'substation', 'SS', 0); if (has('noc_substation')) L('noc_substation', 'substation'); if (has('proc_substation')) L('proc_substation', 'substation'); }
  if (has('genset')) { L(pick('external', lastInternal), 'genset', 'SS', 10); if (has('proc_genset')) L('proc_genset', 'genset'); }
  for (const g of groups.values()) if (g.key.startsWith('gen') && has(g.key)) { const first = acts.find((x) => x.stage === g.stage && x.key !== g.key && x.type === 'TT_Task'); L(first ? first.key : 'ntp', g.key, first ? 'SS' : 'FS', 0); }
  if (has('tandc')) { [lastInternal, 'hvac', 'lift', 'firepump', 'panels', 'genset', 'substation'].forEach((k) => k && has(k) && L(k, 'tandc')); if (has('noc_energise')) L('noc_energise', 'tandc', 'FF', 10); }
  const tc = pick('tandc', lastInternal);
  L(tc, 'snag', has('tandc') ? 'SS' : 'FS', has('tandc') ? Math.ceil(byKey.get('tandc').dur * 0.6) : 0);
  if (has('clean')) L('snag', 'clean');
  if (has('asbuilt')) L('snag', 'asbuilt', 'SS', 0);
  if (has('demob')) L(pick('clean', 'snag'), 'demob');
  ['clean', 'asbuilt', 'noc_bcc', 'noc_makani', 'noc_lift', 'noc_pool', 'noc_water_final', 'noc_telecom', 'external', 'snag'].forEach((k) => has(k) && L(k, 'completion'));
  if (has('demob')) L('completion', 'demob', 'SS', 0);
  L('completion', 'dlp'); L('dlp', 'dlp_end');
  // dangling activities feed completion
  const succCount = new Map(); rels.forEach((r) => succCount.set(r.from, (succCount.get(r.from) || 0) + 1));
  for (const a of acts) if (!succCount.get(a.key) && !['completion', 'dlp', 'dlp_end', 'demob'].includes(a.key) && a.type !== 'TT_LOE') L(a.key, 'completion');
  // activities without predecessors hang off NTP
  const predCount = new Map(); rels.forEach((r) => predCount.set(r.to, (predCount.get(r.to) || 0) + 1));
  for (const a of acts) if (a.key !== 'ntp' && !predCount.get(a.key) && a.type !== 'TT_LOE') L('ntp', a.key);

  loe('staff', 'Site management, supervision & document control (LOE)', 'ntp', 'completion', 16);
  loe('temp', 'Temporary power & water (LOE)', 'mob', pick('noc_energise', 'completion'), 16);
  if (groups.has('crane')) loe('crane', 'Tower crane & hoisting (LOE)', pick('found', 'mob'), pick(ck('frame', 'last'), 'completion'), 16);
  loe('authfee', 'Authority fees & connection charges (LOE)', 'ntp', pick('noc_bcc', 'completion'), 2);

  // integer, positive durations for tasks
  acts.forEach((a) => { if (a.type === 'TT_Task') a.dur = Math.max(1, Math.round(a.dur)); });
  // de-duplicate relationships
  const seen = new Set(); const relsU = rels.filter((r) => { if (!r.from || !r.to || r.from === r.to || !byKey.has(r.from) || !byKey.has(r.to)) return false; const k = `${r.from}>${r.to}>${r.type}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // successor/predecessor indices
  acts.forEach((a) => { a.preds = []; a.succs = []; });
  relsU.forEach((r, i) => { r.id = i; byKey.get(r.to).preds.push(r); byKey.get(r.from).succs.push(r); });
  return { acts, rels: relsU, byKey, levelsFrame, levelsUse };
}

// ───────────────────────── CPM (forward / backward pass) ─────────────────────────
function topoOrder(acts, byKey) {
  const indeg = new Map(acts.map((a) => [a.key, 0]));
  acts.forEach((a) => a.preds.forEach(() => indeg.set(a.key, indeg.get(a.key) + 1)));
  const q = acts.filter((a) => indeg.get(a.key) === 0).map((a) => a.key); const out = [];
  while (q.length) { const k = q.shift(); out.push(byKey.get(k)); for (const r of byKey.get(k).succs) { indeg.set(r.to, indeg.get(r.to) - 1); if (indeg.get(r.to) === 0) q.push(r.to); } }
  if (out.length !== acts.length) throw new Error('Logic loop detected in schedule network');
  return out;
}

/* progress: Map key → {pct, as, af, rd}  (only for the current/updated schedule)
   dataDay: data date (day index); finishBy: contract completion day index */
function cpm(net, cal, { dataDay = null, progress = null, finishBy }) {
  const { acts, byKey } = net; const order = topoOrder(acts, byKey);
  const R = new Map();
  const startFloor = dataDay == null ? 0 : cal.nextWork(dataDay + 1);
  for (const a of order) {
    const p = progress ? progress.get(a.key) : null;
    if (a.type === 'TT_LOE') continue;
    if (p && p.af != null) { R.set(a.key, { es: p.as, ef: p.af, done: true }); continue; }
    let es = 0, efMin = -Infinity;
    for (const r of a.preds) {
      const pr = R.get(r.from); if (!pr) continue; const pa = byKey.get(r.from); const pz = pa.type !== 'TT_Task';
      if (r.type === 'FS') es = Math.max(es, pz ? cal.fwd(pr.ef, r.lag) : cal.fwd(pr.ef, 1 + r.lag));
      else if (r.type === 'SS') es = Math.max(es, cal.fwd(pr.es, r.lag));
      else if (r.type === 'FF') efMin = Math.max(efMin, cal.fwd(pr.ef, r.lag));
    }
    if (p && p.as != null) {
      // in progress: remaining duration from data date (progress override)
      const ef = a.dur === 0 ? startFloor : cal.addWork(startFloor, p.rd, a.cls);
      R.set(a.key, { es: p.as, ef: Math.max(ef, p.as), inProg: true }); continue;
    }
    if (dataDay != null) es = Math.max(es, startFloor);
    if (a.type === 'TT_Task') es = cal.nextWork(es);
    let ef = a.type === 'TT_Task' ? cal.addWork(es, a.dur, a.cls) : es;
    if (efMin > ef) { ef = cal.prevWork(efMin); es = cal.subWork(ef, a.dur, a.cls); }
    R.set(a.key, { es, ef });
  }
  // backward pass
  const projLF = cal.prevWork(finishBy);
  for (const a of [...order].reverse()) {
    if (a.type === 'TT_LOE') continue;
    const me = R.get(a.key); const isZ = a.type !== 'TT_Task';
    let lf = a.key === 'dlp' || a.key === 'dlp_end' ? Math.max(projLF, me.ef) : projLF; let lsLim = Infinity;
    if (a.key === 'dlp' || a.key === 'dlp_end') { me.lf = me.ef; me.ls = me.es; me.tf = null; continue; }
    for (const r of a.succs) {
      const s = R.get(r.to); const sa = byKey.get(r.to); if (!s || sa.type === 'TT_LOE' || s.ls == null) continue;
      if (r.to === 'dlp') continue;
      if (r.type === 'FS') lf = Math.min(lf, isZ ? cal.back(s.ls, r.lag) : cal.back(s.ls, 1 + r.lag));
      else if (r.type === 'SS') lsLim = Math.min(lsLim, cal.back(s.ls, r.lag));
      else if (r.type === 'FF') lf = Math.min(lf, cal.back(s.lf, r.lag));
    }
    if (me.done) { me.ls = me.es; me.lf = me.ef; me.tf = null; continue; }
    if (a.type === 'TT_Task') lf = cal.prevWork(lf);
    const remDur = me.inProg ? Math.max(0, cal.wd(cal.prevWork(startFloor - 1), me.ef)) : a.dur;
    let ls = a.type === 'TT_Task' ? cal.subWork(lf, me.inProg ? remDur : a.dur, a.cls) : lf;
    if (!me.inProg && lsLim < ls) { ls = lsLim; lf = a.type === 'TT_Task' ? cal.addWork(ls, me.inProg ? remDur : a.dur, a.cls) : ls; }
    me.ls = me.inProg ? me.es : ls; me.lf = lf;
    me.tf = cal.wd(me.ef, lf) - (lf < me.ef ? 0 : 0);
    if (lf < me.ef) me.tf = -cal.wd(lf, me.ef);
  }
  // LOE spans
  for (const a of acts) if (a.type === 'TT_LOE') {
    const s = a.preds.filter((r) => r.type === 'SS').map((r) => R.get(r.from).es); const f = a.preds.filter((r) => r.type === 'FF').map((r) => R.get(r.from).ef);
    const es = Math.min(...s), ef = Math.max(...f); R.set(a.key, { es, ef, ls: es, lf: ef, tf: null, loe: true, done: progress ? ef <= dataDay : false });
  }
  const tfs = [...R.entries()].filter(([k, v]) => v.tf != null && !v.done && !v.loe).map(([, v]) => v.tf);
  const minTF = tfs.length ? Math.min(...tfs) : 0;
  for (const [k, v] of R) { v.critical = v.tf != null && !v.done && (v.tf <= Math.max(0, minTF)); v.nearCritical = v.tf != null && !v.done && !v.critical && v.tf <= Math.max(0, minTF) + 10; }
  // longest path: walk back from completion through driving predecessors
  const longest = new Set(); const walk = (k) => { if (longest.has(k)) return; longest.add(k); const a = byKey.get(k); const me = R.get(k); for (const r of a.preds) { const p = R.get(r.from); const pa = byKey.get(r.from); if (!p || pa.type === 'TT_LOE' || p.done) continue; const pz = pa.type !== 'TT_Task'; let drives = false; if (r.type === 'FS') drives = (pz ? cal.fwd(p.ef, r.lag) : cal.fwd(p.ef, 1 + r.lag)) >= me.es - 0 && cal.wd(pz ? cal.fwd(p.ef, r.lag) : cal.fwd(p.ef, 1 + r.lag), me.es) <= 0; else if (r.type === 'SS') drives = cal.wd(cal.fwd(p.es, r.lag), me.es) <= 0; else if (r.type === 'FF') drives = cal.wd(cal.fwd(p.ef, r.lag), me.ef) <= 0; if (drives) walk(r.from); } };
  if (R.has('completion')) walk('completion');
  for (const [k, v] of R) v.longest = longest.has(k) && !v.done;
  return { R, minTF, finish: R.get('completion') ? R.get('completion').ef : null };
}

// ───────────────────────── planned / earned value per item ─────────────────────────
function actFrac(cal, r, d) { if (!r) return 0; if (d < r.es) return 0; if (d >= r.ef) return 1; const tot = cal.wd(r.es - 1, r.ef); if (tot <= 0) return d >= r.ef ? 1 : 0; return clamp(cal.wd(r.es - 1, d) / tot, 0, 1); }

const PERF = { 1: 1, 2: 0.98, 3: 1, 4: 0.975, 5: 0.958, 6: 0.945, 7: 0.94, 8: 0.95, 9: 0.95, 10: 0.95, 11: 0.95, 12: 0.95, 13: 0.95, 14: 0.95, 15: 1, 16: 1 };
const COSTF = { 4: 1.03, 5: 1.06, 6: 0.97, 7: 1.02, 16: 1.045, 2: 1.0, 3: 1.04 };

function buildModel(state) {
  const { project, boq, settings } = state;
  const items = boq.items.map((it) => ({ ...it, c: applyStageOverride(it) }));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const cal = buildCalendar(project.startDate, settings.cal);
  const contractEndMs = addMonthsISO(project.startDate, project.durationMonths) - DAY;
  const finishBy = cal.dayOf(contractEndMs);
  const dataDay = cal.dayOf(parseISO(project.dataDate));

  // Baseline network uses the baseline settings snapshot (re-baseline updates it)
  const blSettings = state.baselineSettings || settings;
  const blCal = buildCalendar(project.startDate, blSettings.cal);
  const blNet = generateSchedule(boq.items, blSettings, project);
  const bl = cpm(blNet, blCal, { finishBy });

  // item allocations → planned fraction from baseline activity dates
  const allocs = new Map(items.map((i) => [i.id, []]));
  blNet.acts.forEach((a) => a.items.forEach((x) => allocs.get(x.id) && allocs.get(x.id).push({ key: a.key, share: x.share })));
  const plannedFrac = (it, d) => { const al = allocs.get(it.id); if (!al || !al.length) return 0; let f = 0; for (const x of al) f += x.share * actFrac(blCal, bl.R.get(x.key), d); return clamp(f, 0, 1); };
  const itemWindow = (it) => { const al = allocs.get(it.id) || []; let s = Infinity, e = -Infinity; al.forEach((x) => { const r = bl.R.get(x.key); if (r) { s = Math.min(s, r.es); e = Math.max(e, r.ef); } }); return { s: s === Infinity ? 0 : s, e: e === -Infinity ? 0 : e }; };

  // simulated history (demo) + diary logs
  const seedFrac = (it, d) => state.seedDemo ? plannedFrac(it, Math.floor(d * (PERF[it.c.stage] || 0.92))) : 0;
  const logs = state.seedDemo ? seedLogs(items, seedFrac, cal, dataDay, project) : [];
  const allLogs = [...logs, ...(state.userLogs || [])].sort((a, b) => a.date.localeCompare(b.date));
  const logStart = cal.dayOf(parseISO(project.dataDate)) - 14;
  const logsByItem = new Map();
  for (const lg of allLogs) { const d = cal.dayOf(parseISO(lg.date)); for (const q of lg.qty || []) { if (!logsByItem.has(q.itemId)) logsByItem.set(q.itemId, []); logsByItem.get(q.itemId).push({ d, qty: q.qty }); } }
  const prior = new Map(items.map((it) => [it.id, it.qty * seedFrac(it, logStart)]));
  const execQtyAt = (it, d) => {
    if (it.c.reserve) return 0;
    let q;
    if (d < logStart) q = it.qty * seedFrac(it, d);
    else { q = prior.get(it.id); for (const x of logsByItem.get(it.id) || []) if (x.d <= d && x.d > logStart) q += x.qty; }
    return Math.max(0, q);
  };
  const evAt = (d, filter) => sum(items.filter((i) => !i.c.reserve && (!filter || filter(i))), (it) => Math.min(execQtyAt(it, d), it.qty * 1.5) * it.rate);
  const acAt = (d, filter) => sum(items.filter((i) => !i.c.reserve && (!filter || filter(i))), (it) => Math.min(execQtyAt(it, d), it.qty * 1.5) * it.rate * (COSTF[it.c.stage] || 1));
  const pvAt = (d, filter) => sum(items.filter((i) => !i.c.reserve && (!filter || filter(i))), (it) => it.amount * plannedFrac(it, d));

  const contractSum = sum(items, (i) => i.amount);
  const reserve = sum(items.filter((i) => i.c.reserve), (i) => i.amount);
  const bac = contractSum - reserve;

  // ── current (updated) schedule ──
  const curNet = generateSchedule(boq.items, settings, project);
  const nocState = buildNocState(state, blNet, bl, blCal, dataDay);
  const actProgressAt = (a, d) => {
    if (a.noc) { const ns = nocState.get(a.key); if (!ns) return 0; if (ns.approvedDay != null && ns.approvedDay <= d) return 1; if (ns.submittedDay != null && ns.submittedDay <= d) return ns.status === 'COMMENTS' ? 0.6 : 0.4; return 0; }
    if (a.type === 'TT_Mile' || a.type === 'TT_FinMile') { if (a.key === 'ntp') return 1; return 0; }
    if (!a.items.length) { const r = bl.R.get(a.key); return r ? actFrac(blCal, r, Math.floor(d * (a.proc ? 0.97 : PERF[a.stage] || 0.92))) : 0; }
    let v = 0, tot = 0;
    for (const x of a.items) {
      const it = itemById.get(x.id); if (!it) continue; const val = it.amount * x.share; tot += val;
      const f = it.qty ? execQtyAt(it, d) / it.qty : 0;
      if (FLOORWISE.includes(a.group) && a.floor != null) { const n = Math.round(1 / x.share); v += val * clamp(f * n - a.floor, 0, 1); }
      else v += val * clamp(f, 0, 1);
    }
    return tot ? v / tot : 0;
  };
  const progress = new Map();
  for (const a of curNet.acts) {
    if (a.type === 'TT_LOE') continue;
    const pct = actProgressAt(a, dataDay);
    if (pct <= 0.0005) continue;
    // actual start / finish by bisection on the progress history
    let lo = -1, hi = dataDay; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (actProgressAt(a, m) > 0.0005) hi = m; else lo = m; }
    const as = Math.max(0, cal.nextWork(hi));
    let af = null;
    if (pct >= 0.999) { let lo2 = as - 1, hi2 = dataDay; while (hi2 - lo2 > 1) { const m = (lo2 + hi2) >> 1; if (actProgressAt(a, m) >= 0.999) hi2 = m; else lo2 = m; } af = Math.max(as, cal.prevWork(hi2)); if (a.type !== 'TT_Task') af = as; }
    let rd = 0;
    if (af == null && a.type === 'TT_Task') {
      const elapsed = Math.max(1, cal.wd(as - 1, dataDay)); const perfRate = clamp((pct * a.dur) / elapsed, 0.5, 1.25);
      rd = Math.max(1, Math.ceil((a.dur * (1 - pct)) / perfRate));
    }
    progress.set(a.key, { pct, as, af, rd });
  }
  const cur = cpm(curNet, cal, { dataDay, progress, finishBy });
  // apply P6 import overrides (dates/float synced back from Primavera)
  const imported = state.p6Import && state.p6Import.tasks ? state.p6Import.tasks : null;
  if (imported) for (const a of curNet.acts) { const t = imported[a.code]; const r = cur.R.get(a.key); if (t && r) { if (t.es != null) r.es = t.es; if (t.ef != null) r.ef = t.ef; if (t.tf != null) r.tf = t.tf; r.critical = !!t.critical; r.fromP6 = true; } }

  const acts = curNet.acts.map((a) => {
    const b = bl.R.get(a.key) || {}; const c = cur.R.get(a.key) || {}; const p = progress.get(a.key) || { pct: 0 };
    const startVar = b.es != null && c.es != null ? (c.es >= b.es ? -cal.wd(b.es, c.es) : cal.wd(c.es, b.es)) : 0;
    const finishVar = b.ef != null && c.ef != null ? (c.ef >= b.ef ? -cal.wd(b.ef, c.ef) : cal.wd(c.ef, b.ef)) : 0;
    const blA = blNet.byKey.get(a.key);
    return { ...a, bl: b, cur: c, pct: p.pct, as: p.as, af: p.af, rd: a.type === 'TT_Task' ? (p.af != null ? 0 : p.as != null ? p.rd : a.dur) : 0, startVar, finishVar, blDur: blA ? blA.dur : a.dur, status: p.af != null ? 'Completed' : p.as != null ? 'In progress' : 'Not started' };
  });
  const actByKey = new Map(acts.map((a) => [a.key, a]));
  const forecastFinish = cur.finish; const baselineFinish = bl.finish;
  const finishVarDays = forecastFinish != null && baselineFinish != null ? (forecastFinish >= baselineFinish ? -cal.wd(baselineFinish, forecastFinish) : cal.wd(forecastFinish, baselineFinish)) : 0;
  const contractVarDays = forecastFinish != null ? (forecastFinish >= finishBy ? -cal.wd(finishBy, forecastFinish) : cal.wd(forecastFinish, finishBy)) : 0;

  const model = {
    project, settings, cal, blCal, items, itemById, allocs, dataDay, finishBy, contractEndMs, logStart,
    blNet, curNet, bl, cur, acts, actByKey, progress, forecastFinish, baselineFinish, finishVarDays, contractVarDays,
    plannedFrac, itemWindow, execQtyAt, evAt, acAt, pvAt, contractSum, reserve, bac, logs: allLogs, nocState,
  };
  model.months = monthSeries(model);
  model.docs = buildDocs(model, state);
  model.evm = evmAt(model, dataDay);
  model.ipcs = buildIPCs(model);
  model.vos = state.vos;
  model.approvedVO = sum(state.vos.filter((v) => v.status === 'Approved'), (v) => v.amount);
  model.revisedSum = contractSum + model.approvedVO;
  model.recovery = recoveryTriggers(model);
  return model;
}

function evmAt(m, d) {
  const pv = m.pvAt(d), ev = m.evAt(d), ac = m.acAt(d);
  const cpi = ac ? ev / ac : 1, spi = pv ? ev / pv : 1;
  const eac = cpi ? m.bac / cpi : m.bac;
  return { pv, ev, ac, cpi, spi, sv: ev - pv, cv: ev - ac, eac, etc: eac - ac, vac: m.bac - eac, tcpi: (m.bac - ev) / Math.max(1, m.bac - ac), pctPlanned: pv / m.bac, pctEarned: ev / m.bac };
}

function monthSeries(m) {
  const out = []; const s = new Date(m.cal.s0); const endDay = Math.max(m.baselineFinish || 0, m.forecastFinish || 0) + 10;
  for (let k = 0; ; k++) {
    const mEnd = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k + 1, 0); const d = m.cal.dayOf(mEnd);
    const label = `${MONTHS[new Date(mEnd).getUTCMonth()]} ${String(new Date(mEnd).getUTCFullYear()).slice(2)}`;
    const past = d <= m.dataDay; const dd = past ? d : m.dataDay;
    out.push({ k: k + 1, label, endDay: d, endISO: iso(mEnd), pv: m.pvAt(d), ev: past || out.length === 0 || out[out.length - 1].endDay < m.dataDay ? m.evAt(dd) : null, ac: past || (out.length && out[out.length - 1].endDay < m.dataDay) ? m.acAt(dd) : null, past });
    if (d >= endDay || k > 60) break;
  }
  out.forEach((x, i) => { x.pvMonth = x.pv - (i ? out[i - 1].pv : 0); x.evMonth = x.ev != null ? x.ev - (i ? out[i - 1].ev || 0 : 0) : null; });
  return out;
}

// ───────────────────────── IPCs, VOs ─────────────────────────
function buildIPCs(m) {
  const p = m.project; const cs = m.contractSum; const adv = cs * p.advancePct; const out = [];
  let prevNet = 0;
  const done = m.months.filter((x) => x.endDay < m.dataDay);
  done.forEach((mo, i) => {
    const gross = m.evAt(mo.endDay) * 1.0; const claimed = gross * 1.025;
    const rec = Math.min(adv, gross * p.advancePct); const ret = Math.min(gross * p.retentionPct, cs * p.retentionCapPct);
    const netCum = gross - rec - ret; const net = netCum - prevNet; prevNet = netCum;
    const status = i <= done.length - 3 ? 'Paid' : i === done.length - 2 ? 'Certified' : 'Submitted';
    out.push({ no: i + 1, period: mo.label, endISO: mo.endISO, claimed, gross, rec, ret, net, vat: net * 0.05, payable: net * 1.05, status });
  });
  return out;
}
const SEED_VOS = [
  { no: 'VO-001', title: 'Additional basement waterproofing to lift pit and sump (SI-007)', amount: 185000, days: 0, status: 'Approved' },
  { no: 'VO-002', title: 'Upgraded lobby finishes – client change request (SI-012)', amount: 420000, days: 10, status: 'Under review' },
  { no: 'VO-003', title: 'Omission of roof skylight (SI-015)', amount: -65000, days: 0, status: 'Approved' },
  { no: 'VO-004', title: 'Relocation of DEWA substation per DEWA comments', amount: 260000, days: 15, status: 'Submitted' },
];

// ───────────────────────── authority NOC state ─────────────────────────
const NOC_STATUSES = ['NOT_STARTED', 'PREPARING', 'SUBMITTED', 'COMMENTS', 'APPROVED', 'REJECTED'];
const NOC_LABEL = { NOT_STARTED: 'Not started', PREPARING: 'Preparing', SUBMITTED: 'Submitted', COMMENTS: 'Comments to address', APPROVED: 'Approved', REJECTED: 'Rejected' };
function buildNocState(state, blNet, bl, blCal, dataDay) {
  const out = new Map();
  for (const a of blNet.acts) {
    if (!a.noc) continue; const r = bl.R.get(a.key); if (!r) continue;
    const h = hash01(a.key + state.project.name);
    const slip = Math.round(h * 12) + (a.key === 'noc_substation' ? 25 : 0);
    let status, submittedDay = null, approvedDay = null;
    const subD = r.es + Math.round(slip / 2), appD = r.ef + slip;
    if (appD < dataDay && a.key !== 'noc_substation') { status = 'APPROVED'; submittedDay = subD; approvedDay = appD; }
    else if (subD < dataDay) { status = a.key === 'noc_substation' || h > 0.6 ? 'COMMENTS' : 'SUBMITTED'; submittedDay = subD; }
    else if (r.es - 20 < dataDay) status = 'PREPARING';
    else status = 'NOT_STARTED';
    const o = state.nocOverrides && state.nocOverrides[a.key];
    if (o) {
      status = o.status;
      if (status === 'APPROVED') { approvedDay = o.approvedDay ?? Math.min(dataDay, approvedDay ?? dataDay); submittedDay = submittedDay ?? Math.min(approvedDay, subD); }
      else { approvedDay = null; if (['SUBMITTED', 'COMMENTS', 'REJECTED'].includes(status)) submittedDay = submittedDay ?? o.submittedDay ?? dataDay; else submittedDay = null; }
    }
    out.set(a.key, { status, submittedDay, approvedDay, ref: status === 'APPROVED' ? `${a.noc.auth.split(/[ :(]/)[0].toUpperCase()}-${26000 + Math.round(h * 9000)}` : '' });
  }
  return out;
}

// ───────────────────────── submittals, WIRs, procurement ─────────────────────────
const SUB_STATUSES = ['NS', 'SUB', 'UR', 'A', 'B', 'C', 'D'];
const SUB_LABEL = { NS: 'Not submitted', SUB: 'Submitted', UR: 'Under review', A: 'A · Approved', B: 'B · Approved as noted', C: 'C · Revise & resubmit', D: 'D · Rejected' };
const SUB_TYPES = { MAR: 'Material approval (MAR)', SD: 'Shop drawing', MS: 'Method statement', ITP: 'Inspection & test plan', PLN: 'Management plan', HOD: 'Handover document' };
function buildDocs(m, state) {
  const subs = []; const wirs = []; const counters = {}; const wtSeen = new Map();
  const no = (t, tr) => { const k = t + '-' + tr; counters[k] = (counters[k] || 0) + 1; return `${t}-${tr}-${String(counters[k]).padStart(3, '0')}`; };
  const seedStatus = (key, reqDay) => {
    const h = hash01(key); const d = reqDay - m.dataDay; let s;
    if (d < -45) s = h < 0.75 ? 'A' : 'B';
    else if (d < -10) s = h < 0.45 ? 'B' : h < 0.7 ? 'A' : h < 0.88 ? 'UR' : 'C';
    else if (d < 20) s = h < 0.4 ? 'UR' : h < 0.7 ? 'SUB' : h < 0.85 ? 'C' : 'NS';
    else if (d < 60) s = h < 0.35 ? 'SUB' : 'NS';
    else s = 'NS';
    return (state.subOverrides && state.subOverrides[key]) || s;
  };
  const short = (s) => s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/incl\..*$/i, '').split(/[,;]/)[0].trim().slice(0, 60);
  for (const it of m.items) {
    const c = it.c; if (c.reserve) continue; const flags = c.docs || ''; const w = m.itemWindow(it); const tr = c.trade || 'GEN';
    const lead = c.longLead ? (c.leadWk || 12) * 7 : 0;
    const mk = (type, title, reqDay, extra = {}) => { const id = no(type, tr); subs.push({ id, key: id, type, title, trade: tr, stage: c.stage, itemRef: it.ref, itemId: it.id, reqDay, status: seedStatus(id, reqDay), longLead: c.longLead, ...extra }); };
    if (flags.includes('M')) mk('MAR', `${short(it.desc)}`, w.s - 42 - lead);
    if (flags.includes('S')) mk('SD', `${short(it.desc)}`, w.s - 28 - lead);
    if (flags.includes('P')) mk('PLN', short(it.desc), 30);
    if (flags.includes('H')) mk('HOD', short(it.desc), w.s);
    const wtk = c.rule + ':' + c.stage;
    if (!wtSeen.has(wtk)) {
      wtSeen.set(wtk, true);
      if (flags.includes('D')) mk('MS', c.wt, w.s - 21);
      if (flags.includes('I')) mk('ITP', c.wt, w.s - 21);
    }
    if (flags.includes('W') && c.lot > 0) {
      const lot = it.unit === 'LS' || it.unit === 'PS' ? (c.lot < 1 ? c.lot : 0.1) : c.lot;
      const planned = Math.min(40, Math.max(1, Math.ceil(it.qty / lot)));
      const f = it.qty ? m.execQtyAt(it, m.dataDay) / it.qty : 0;
      const raised = Math.min(planned, Math.round(planned * f + (f > 0 && f < 1 ? 1 : 0)));
      const h = hash01('wir' + it.ref);
      const rejected = raised > 3 && h > 0.6 ? 1 : 0; const pending = raised > 0 && f < 1 ? Math.min(raised - rejected, 1 + Math.round(h * 2)) : 0;
      wirs.push({ itemId: it.id, ref: it.ref, desc: short(it.desc), trade: tr, stage: c.stage, planned, raised, approved: Math.max(0, raised - rejected - pending), pending, rejected, lot, unit: it.unit });
    }
  }
  subs.forEach((s) => { s.overdue = !['A', 'B'].includes(s.status) && s.reqDay < m.dataDay; });
  // procurement log from long-lead P6 activities
  const procurement = m.acts.filter((a) => a.key.startsWith('proc_')).map((a) => {
    const inst = m.actByKey.get(a.groupKey); const req = inst ? (inst.status !== 'Not started' ? inst.as : inst.cur.ls ?? inst.cur.es) : a.bl.ef;
    const exp = a.cur.ef; const flt = exp <= req ? m.cal.wd(exp, req) : -m.cal.wd(req, exp);
    const status = a.pct >= 0.999 ? 'Delivered' : a.pct > 0.75 ? 'Shipped / in transit' : a.pct > 0 ? 'Manufacturing' : (m.actByKey.get('sub_' + a.groupKey) || {}).pct > 0 ? 'MAR under review' : 'RFQ / tendering';
    return { key: a.key, code: a.code, name: a.name.replace(/^Procure, manufacture & deliver – /, ''), leadWk: a.leadWk, poDay: a.as ?? a.cur.es, expDay: exp, reqDay: req, float: flt, status, pct: a.pct };
  });
  const nocs = m.acts.filter((a) => a.noc).map((a) => {
    const ns = m.nocState.get(a.key) || {}; const nb = a.succs.map((r) => { const sa = m.actByKey.get(r.to); if (!sa || sa.type === 'TT_LOE') return Infinity; return r.type === 'FS' ? sa.bl.es : sa.bl.ef; }).filter((x) => x != null && isFinite(x));
    const needBy = nb.length ? Math.min(...nb) : a.bl.ef;
    return { key: a.key, code: a.code, auth: a.noc.auth, name: a.noc.name, sla: a.noc.sla, stage: a.noc.stage, trigger: a.noc.triggerRef, needBy, blStart: a.bl.es, curFinish: a.cur.ef, status: ns.status, submittedDay: ns.submittedDay, approvedDay: ns.approvedDay, refNo: ns.ref, tf: a.cur.tf, critical: a.cur.critical, late: ns.status !== 'APPROVED' && a.cur.ef > needBy && needBy < m.dataDay + 120 };
  });
  return { subs, wirs, procurement, nocs };
}

// ───────────────────────── seeded daily logs (demo history) ─────────────────────────
const TRADE_SPLIT = {
  3: [['General labour', 0.7], ['Plant operators', 0.3]], 4: [['Plant operators', 0.2], ['Steel fixers', 0.3], ['Carpenters', 0.25], ['General labour', 0.25]],
  5: [['Carpenters', 0.35], ['Steel fixers', 0.33], ['Concrete gang', 0.12], ['General labour', 0.2]], 6: [['Masons', 0.6], ['General labour', 0.4]],
  7: [['Electricians', 0.32], ['Plumbers', 0.28], ['Duct fitters', 0.28], ['General labour', 0.12]], 8: [['Plasterers', 0.35], ['Tilers', 0.25], ['Painters', 0.2], ['Joiners', 0.1], ['General labour', 0.1]],
  9: [['Façade installers', 0.65], ['General labour', 0.35]], 10: [['Electricians', 0.4], ['Plumbers', 0.25], ['HVAC technicians', 0.25], ['General labour', 0.1]],
  11: [['Civil labour', 0.6], ['Plant operators', 0.4]], 12: [['Commissioning engineers', 1]],
};
const AED_PER_MANDAY = 2200;
function seedLogs(items, seedFrac, cal, dataDay, project) {
  const logs = []; let wir = { STR: 140, ARC: 60, MEP: 85, CIV: 40, FAC: 12, GEN: 5 }; let mir = 96;
  const start = dataDay - 13;
  for (let d = start; d <= dataDay; d++) {
    if (!cal.isWork(d)) continue;
    const prevD = cal.back(d, 1) < start ? start - 1 : cal.back(d, 1);
    const qty = []; const stageVal = {};
    for (const it of items) {
      if (it.c.reserve || it.c.loe || it.c.stage === 2 || it.c.stage === 16) continue;
      const dq = it.qty * (seedFrac(it, d) - seedFrac(it, Math.max(prevD, start - 1)));
      if (dq * it.rate < 800) continue;
      const q = it.unit === 'LS' || it.unit === 'PS' ? round(dq, 3) : it.unit === 'ton' ? round(dq, 1) : Math.round(dq);
      if (q <= 0) continue;
      qty.push({ itemId: it.id, qty: q, loc: locFor(it, d) });
      stageVal[it.c.stage] = (stageVal[it.c.stage] || 0) + q * it.rate;
    }
    const h = hash01('log' + d);
    const manpower = {};
    Object.entries(stageVal).forEach(([st, v]) => (TRADE_SPLIT[st] || [['General labour', 1]]).forEach(([t, s]) => { manpower[t] = (manpower[t] || 0) + Math.round((v / AED_PER_MANDAY) * s); }));
    Object.assign(manpower, { 'Engineers & foremen': 14 + Math.round(h * 3), 'HSE officers & first aiders': 4, 'Surveyors': 2, 'Security & watchmen': 5, 'Housekeeping': 8 });
    const equipment = { 'Tower crane': 1, 'Concrete pump (boom)': stageVal[5] ? 1 : 0, 'Mobile crane 50T': h > 0.6 ? 1 : 0, 'Manlift / boom lift': stageVal[9] ? 2 : 1, 'Diesel generator 500 kVA': 2, 'Telehandler': 1, 'Dumper / tipper': h > 0.5 ? 2 : 1 };
    Object.keys(equipment).forEach((k) => equipment[k] === 0 && delete equipment[k]);
    const pours = [];
    const slab = qty.find((q) => /post.?tension|slab/i.test(items.find((i) => i.id === q.itemId).desc));
    if (slab && slab.qty * 0.25 > 40) pours.push({ element: `PT slab – ${slab.loc}`, grade: 'C40/20 (PT)', vol: Math.round(slab.qty * 0.25), supplier: 'Ready-mix supplier A', cubes: Math.max(6, Math.round(slab.qty * 0.25 / 50) * 6) });
    const col = qty.find((q) => /column|core wall|shear/i.test(items.find((i) => i.id === q.itemId).desc));
    if (col && col.qty > 4) pours.push({ element: `Columns & core walls – ${col.loc}`, grade: 'C50/20', vol: Math.round(col.qty), supplier: 'Ready-mix supplier A', cubes: 6 });
    const insp = [];
    qty.slice(0, 6).forEach((q, k) => { const it = items.find((i) => i.id === q.itemId); if (!it.c.docs.includes('W') || hash01(q.itemId + d) < 0.45) return; const tr = it.c.trade || 'GEN'; wir[tr] = (wir[tr] || 0) + 1; insp.push({ kind: 'WIR', ref: `WIR-${tr}-${String(wir[tr]).padStart(4, '0')}`, desc: `${it.desc.split(/[,(]/)[0]} – ${q.loc}`, result: d < dataDay - 2 ? (hash01('r' + q.itemId + d) > 0.12 ? 'Approved' : 'Approved as noted') : 'Pending' }); });
    if (h > 0.55) { mir++; const mats = ['200mm hollow blocks – 8,000 nos', 'Rebar Ø16/Ø20 – 42 t', 'PPR pipes & fittings – 1 lot', 'Porcelain tiles 600×600 – 1,200 m²', 'Gypsum boards – 900 sheets', 'Cable trays – 1 lot']; insp.push({ kind: 'MIR', ref: `MIR-${String(mir).padStart(4, '0')}`, desc: mats[Math.floor(h * 997) % mats.length], result: d < dataDay - 1 ? 'Approved' : 'Pending' }); }
    const blockersPool = ['Aluminium window shop drawings returned Code C; façade mock-up on hold.', 'DEWA substation NOC: comments received on RMU room ventilation; resubmission in progress.', 'Rebar delivery delayed by 1 day (supplier); slab pour rescheduled.', 'Consultant inspection for WIR on upper floor deferred to next morning.', 'Blockwork gang shortfall: 2 gangs demobilised to another site.', ''];
    const blk = h < 0.45 ? blockersPool[Math.floor(h * 1000) % blockersPool.length] : '';
    const ms = cal.date(d); const dt = new Date(ms); const temp = 27 + Math.round(h * 5);
    logs.push({ id: 'seed-' + d, seed: true, date: iso(ms), weather: h > 0.82 ? 'Hazy, light dust' : 'Sunny, clear', tempMax: temp, humidity: 45 + Math.round(h * 20), wind: 10 + Math.round(h * 12), incidents: 0, nearMiss: h > 0.85 ? 1 : 0, tbt: 1, manpower, equipment, qty, pours, insp, photos: [{ gen: true, seed: d, caption: qty[0] ? `${items.find((i) => i.id === qty[0].itemId).c.wt} – ${qty[0].loc}` : 'General site view' }], blockers: blk, dow: DOW[dt.getUTCDay()] });
  }
  return logs;
}
function locFor(it, d) {
  if (['frame', 'block', 'firstfix', 'plaster', 'finish', 'secondfix'].includes(it.c.group)) { const zones = ['Zone A', 'Zone B']; return `${['GF', 'L1', 'L2', 'L3', 'L4', 'Roof'][Math.min(5, Math.floor(hash01(it.id + Math.floor(d / 12)) * 2) + Math.floor(d / 70) % 6)]} ${zones[d % 2]}`; }
  if (it.c.stage === 11) return 'External – north side';
  if (it.c.stage === 9) return 'Elevation ' + ['North', 'East', 'South', 'West'][d % 4];
  return 'Site';
}

// ───────────────────────── recovery triggers ─────────────────────────
function recoveryTriggers(m) {
  const out = [];
  if (m.contractVarDays < -10) out.push({ level: 'critical', title: 'Forecast completion beyond contract completion date', detail: `Forecast ${m.cal.fmt(m.forecastFinish)} vs contract ${m.cal.fmt(m.finishBy)} (${-m.contractVarDays} working days late). Under FIDIC 8.6 the Engineer may instruct a revised programme with methods to expedite progress.` });
  else if (m.finishVarDays < -10) out.push({ level: 'warning', title: 'Completion slipping against baseline', detail: `Forecast completion ${-m.finishVarDays} working days behind the baseline (${m.cal.fmt(m.baselineFinish)}). Contract float still covers it, ${m.contractVarDays} working days left.` });
  if (m.evm && m.evm.spi < 0.9) out.push({ level: 'critical', title: `SPI ${m.evm.spi.toFixed(2)} below 0.90 threshold`, detail: 'Earned value is more than 10% behind plan. Prepare a recovery programme and add resources to critical activities.' });
  else if (m.evm && m.evm.spi < 0.95) out.push({ level: 'warning', title: `SPI ${m.evm.spi.toFixed(2)} below 0.95 watch level`, detail: 'Monitor weekly; prepare mitigation for the critical path.' });
  const crit = m.acts.filter((a) => a.cur.critical && a.status !== 'Completed' && a.type === 'TT_Task' && a.finishVar < -15);
  crit.slice(0, 6).forEach((a) => {
    const remWin = Math.max(1, (a.rd || a.dur) + a.finishVar);
    const uplift = (a.rd || a.dur) / remWin - 1;
    out.push({ level: 'critical', title: `${a.code} ${a.name}`, detail: uplift <= 0.6 ? `Finish ${-a.finishVar} WD late on the critical path. To recover, raise output by ${Math.round(uplift * 100)}% (extra gang or second shift), or overlap with the successor (change FS to SS with a lag).` : `Finish ${-a.finishVar} WD late on the critical path. More output alone cannot recover it within the remaining duration: open a second work front, overlap with the successor (FS to SS with a lag), or prepare an extension of time claim.`, act: a.key });
  });
  m.docs && m.docs.procurement.filter((p) => p.float < 0).forEach((p) => out.push({ level: 'warning', title: `Long-lead: ${p.name}`, detail: `Delivery forecast ${m.cal.fmt(p.expDay)} is ${-p.float} WD after the required-on-site date ${m.cal.fmt(p.reqDay)}. Expedite the PO, pay for air freight, or re-sequence the installation.` }));
  m.docs && m.docs.nocs.filter((n) => n.late).forEach((n) => out.push({ level: 'warning', title: `${n.auth}: ${n.name}`, detail: `Status: ${NOC_LABEL[n.status]}. Forecast approval ${m.cal.fmt(n.curFinish)} is after the need-by date ${m.cal.fmt(n.needBy)}.` }));
  return out;
}

// ───────────────────────── lookahead ─────────────────────────
function lookahead(m, days, fromDay = m.dataDay) {
  const to = fromDay + days;
  return m.acts.filter((a) => a.type !== 'TT_LOE' && a.status !== 'Completed' && a.cur.es != null && a.cur.es <= to && a.cur.ef > fromDay)
    .sort((a, b) => a.cur.es - b.cur.es)
    .map((a) => {
      const span = Math.max(1, m.cal.wd(Math.max(a.cur.es, fromDay) - 1, a.cur.ef)); const inWin = Math.max(0, m.cal.wd(Math.max(a.cur.es, fromDay) - 1, Math.min(a.cur.ef, to)));
      const frac = (1 - a.pct) * (inWin / span);
      const qtys = a.items.map((x) => { const it = m.itemById.get(x.id); return it ? { unit: it.unit, q: it.qty * x.share * frac, val: it.amount * x.share * frac } : null; }).filter(Boolean);
      const main = qtys.sort((p, q) => q.val - p.val)[0];
      const constraints = [];
      a.preds.forEach((r) => { const p = m.actByKey.get(r.from); if (p && p.noc && p.status !== 'Completed') constraints.push(`${p.noc.auth} NOC pending`); if (p && p.key.startsWith('proc_') && p.status !== 'Completed') constraints.push('Material delivery pending'); });
      const subs = m.docs.subs.filter((s) => a.items.some((x) => x.id === s.itemId) && ['MAR', 'SD'].includes(s.type) && !['A', 'B'].includes(s.status));
      if (subs.length) constraints.push(`${subs.length} submittal(s) not approved`);
      return { a, qty: main ? main.q : 0, unit: main ? main.unit : '', value: sum(qtys, (x) => x.val), constraints };
    });
}

// ───────────────────────── P6 exchange: XER / XML / CSV ─────────────────────────
function p6Date(cal, d) { return d == null ? '' : `${cal.iso(d)} 08:00`; }
function p6DateEnd(cal, d) { return d == null ? '' : `${cal.iso(d)} 17:00`; }
const XER_TASK_TYPE = { TT_Task: 'TT_Task', TT_Mile: 'TT_Mile', TT_FinMile: 'TT_FinMile', TT_LOE: 'TT_LOE' };
function excelSerial(ms) { return Math.round(ms / DAY + 25569); }
function calendarData(cal, settings) {
  const hrs = settings.cal.hoursPerDay || 9; const days = [];
  for (let k = 1; k <= 7; k++) { const dow = k - 1; const work = !settings.cal.offDays.includes(dow); days.push(work ? `(0||${k}()(\n(0||0(s|07:00|f|${String(7 + hrs + 1).padStart(2, '0')}:00)())))` : `(0||${k}()())`); }
  const exc = settings.cal.holidays ? UAE_HOLIDAYS.map(([d]) => `(0||${UAE_HOLIDAYS.findIndex((x) => x[0] === d)}(d|${excelSerial(parseISO(d))})())`).join('\n') : '';
  return `(0||CalendarData()(\n(0||DaysOfWeek()(\n${days.join('\n')}))\n(0||VIEW(ShowTotal|Y)())\n(0||Exceptions()(\n${exc}))))`;
}
function toXER(m) {
  const cal = m.cal; const p = m.project; const hrs = m.settings.cal.hoursPerDay || 9; const now = `${p.dataDate} 08:00`;
  const L = []; const T = (name, fields, rows) => { L.push(`%T\t${name}`); L.push(`%F\t${fields.join('\t')}`); rows.forEach((r) => L.push(`%R\t${fields.map((f) => (r[f] == null ? '' : String(r[f]).replace(/[\t\r\n]+/g, ' '))).join('\t')}`)); };
  L.push(`ERMHDR\t19.12\t${p.dataDate}\tProject\tSITELEDGER\tSiteLedger\tdbxDatabaseNoName\tProject Management\tAED`);
  T('CURRTYPE', ['curr_id', 'decimal_digit_cnt', 'curr_symbol', 'decimal_symbol', 'digit_group_symbol', 'pos_curr_fmt_type', 'neg_curr_fmt_type', 'curr_type', 'curr_short_name', 'group_digit_cnt', 'base_exch_rate'], [{ curr_id: 1, decimal_digit_cnt: 2, curr_symbol: 'AED', decimal_symbol: '.', digit_group_symbol: ',', pos_curr_fmt_type: '#1.1', neg_curr_fmt_type: '(#1.1)', curr_type: 'UAE Dirham', curr_short_name: 'AED', group_digit_cnt: 3, base_exch_rate: 1 }]);
  T('PROJECT', ['proj_id', 'fy_start_month_num', 'rsrc_self_add_flag', 'allow_complete_flag', 'rsrc_multi_assign_flag', 'checkout_flag', 'project_flag', 'step_complete_flag', 'cost_qty_recalc_flag', 'batch_sum_flag', 'name_sep_char', 'def_complete_pct_type', 'proj_short_name', 'acct_id', 'orig_proj_id', 'source_proj_id', 'base_type_id', 'clndr_id', 'sum_base_proj_id', 'task_code_base', 'task_code_step', 'priority_num', 'wbs_max_sum_level', 'strgy_priority_num', 'last_checksum', 'critical_drtn_hr_cnt', 'def_cost_per_qty', 'last_recalc_date', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'add_date', 'last_tasksum_date', 'fcst_start_date', 'def_duration_type', 'task_code_prefix', 'guid', 'def_qty_type', 'add_by_name', 'web_local_root_path', 'proj_url', 'def_rate_type', 'add_act_remain_flag', 'act_this_per_link_flag', 'def_task_type', 'act_pct_link_flag', 'critical_path_type', 'task_code_prefix_flag', 'def_rollup_dates_flag', 'use_project_baseline_flag', 'rem_target_link_flag', 'reset_planned_flag', 'allow_neg_act_flag', 'sum_assign_level', 'last_fin_dates_id', 'fintmpl_id', 'last_baseline_update_date', 'cr_external_key', 'apply_actuals_date', 'location_id', 'last_schedule_date', 'loaded_scope_level', 'export_flag', 'new_fin_dates_id', 'baselines_to_export', 'baseline_names_to_export', 'next_data_date', 'close_period_flag', 'sum_refresh_date', 'trsrcsum_loaded'],
    [{ proj_id: 1, fy_start_month_num: 1, rsrc_self_add_flag: 'Y', allow_complete_flag: 'Y', rsrc_multi_assign_flag: 'Y', checkout_flag: 'N', project_flag: 'Y', step_complete_flag: 'N', cost_qty_recalc_flag: 'N', batch_sum_flag: 'Y', name_sep_char: '.', def_complete_pct_type: 'CP_Phys', proj_short_name: p.code, clndr_id: 1, task_code_base: 1000, task_code_step: 10, priority_num: 10, wbs_max_sum_level: 0, strgy_priority_num: 100, critical_drtn_hr_cnt: 0, def_cost_per_qty: 0, last_recalc_date: now, plan_start_date: `${p.startDate} 08:00`, plan_end_date: p6DateEnd(cal, m.finishBy), scd_end_date: p6DateEnd(cal, m.forecastFinish), add_date: now, fcst_start_date: now, def_duration_type: 'DT_FixedDUR2', task_code_prefix: '', guid: '', def_qty_type: 'QT_Hour', add_by_name: 'SiteLedger', def_rate_type: 'COST_PER_QTY', add_act_remain_flag: 'N', act_this_per_link_flag: 'Y', def_task_type: 'TT_Task', act_pct_link_flag: 'N', critical_path_type: 'CT_TotFloat', task_code_prefix_flag: 'Y', def_rollup_dates_flag: 'Y', use_project_baseline_flag: 'Y', rem_target_link_flag: 'Y', reset_planned_flag: 'N', allow_neg_act_flag: 'N', sum_assign_level: 'SL_Taskrsrc', export_flag: 'Y', last_schedule_date: now, next_data_date: now }]);
  T('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'],
    [{ clndr_id: 1, default_flag: 'Y', clndr_name: `UAE ${7 - m.settings.cal.offDays.length}-day week${m.settings.cal.holidays ? ' + public holidays' : ''}`, proj_id: 1, base_clndr_id: '', last_chng_date: now, clndr_type: 'CA_Project', day_hr_cnt: hrs, week_hr_cnt: hrs * (7 - m.settings.cal.offDays.length), month_hr_cnt: Math.round(hrs * (7 - m.settings.cal.offDays.length) * 4.33), year_hr_cnt: Math.round(hrs * (7 - m.settings.cal.offDays.length) * 52), rsrc_private: 'N', clndr_data: calendarData(cal, m.settings).replace(/\n/g, ' ') }]);
  const wbsRows = [{ wbs_id: 100, proj_id: 1, obs_id: '', seq_num: 0, est_wt: 1, proj_node_flag: 'Y', sum_data_flag: 'Y', status_code: 'WS_Open', wbs_short_name: p.code, wbs_name: p.name, phase_id: '', parent_wbs_id: '' }];
  STAGES.forEach((s) => wbsRows.push({ wbs_id: 100 + s.no, proj_id: 1, obs_id: '', seq_num: s.no * 10, est_wt: 1, proj_node_flag: 'N', sum_data_flag: 'N', status_code: 'WS_Open', wbs_short_name: `${String(s.no).padStart(2, '0')}.${s.code}`, wbs_name: s.name, phase_id: '', parent_wbs_id: 100 }));
  T('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'est_wt', 'proj_node_flag', 'sum_data_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'phase_id', 'parent_wbs_id'], wbsRows);
  const taskFields = ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'rev_fdbk_flag', 'est_wt', 'lock_plan_flag', 'auto_compute_act_flag', 'complete_pct_type', 'task_type', 'duration_type', 'status_code', 'task_code', 'task_name', 'rsrc_id', 'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'act_work_qty', 'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt', 'target_equip_qty', 'act_equip_qty', 'remain_equip_qty', 'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date', 'expect_end_date', 'early_start_date', 'early_end_date', 'restart_date', 'reend_date', 'target_start_date', 'target_end_date', 'rem_late_start_date', 'rem_late_end_date', 'cstr_type', 'priority_type', 'suspend_date', 'resume_date', 'float_path', 'float_path_order', 'guid', 'tmpl_guid', 'cstr_date2', 'cstr_type2', 'driving_path_flag', 'act_this_per_work_qty', 'act_this_per_equip_qty', 'external_early_start_date', 'external_late_end_date', 'create_date', 'update_date', 'create_user', 'update_user', 'location_id'];
  const tid = (a) => 2000 + a.idx;
  const taskRows = m.acts.map((a) => {
    const c = a.cur, b = a.bl; const st = a.status === 'Completed' ? 'TK_Complete' : a.status === 'In progress' ? 'TK_Active' : 'TK_NotStart';
    return { task_id: tid(a), proj_id: 1, wbs_id: 100 + a.wbs, clndr_id: 1, phys_complete_pct: round(a.pct * 100, 1), rev_fdbk_flag: 'N', est_wt: 1, lock_plan_flag: 'N', auto_compute_act_flag: 'N', complete_pct_type: 'CP_Phys', task_type: XER_TASK_TYPE[a.type], duration_type: 'DT_FixedDUR2', status_code: st, task_code: a.code, task_name: a.name, total_float_hr_cnt: c.tf == null ? '' : c.tf * hrs, free_float_hr_cnt: '', remain_drtn_hr_cnt: (a.rd || 0) * hrs, act_work_qty: 0, remain_work_qty: 0, target_work_qty: 0, target_drtn_hr_cnt: a.blDur * hrs, target_equip_qty: 0, act_equip_qty: 0, remain_equip_qty: 0, act_start_date: a.as != null ? p6Date(cal, a.as) : '', act_end_date: a.af != null ? p6DateEnd(cal, a.af) : '', late_start_date: p6Date(cal, c.ls), late_end_date: p6DateEnd(cal, c.lf), early_start_date: p6Date(cal, c.es), early_end_date: p6DateEnd(cal, c.ef), restart_date: a.status === 'In progress' ? p6Date(cal, cal.nextWork(m.dataDay + 1)) : p6Date(cal, c.es), reend_date: p6DateEnd(cal, c.ef), target_start_date: p6Date(cal, b.es), target_end_date: p6DateEnd(cal, b.ef), rem_late_start_date: p6Date(cal, c.ls), rem_late_end_date: p6DateEnd(cal, c.lf), priority_type: 'PT_Normal', float_path: '', driving_path_flag: c.longest ? 'Y' : 'N', create_date: now, update_date: now, create_user: 'siteledger', update_user: 'siteledger' };
  });
  T('TASK', taskFields, taskRows);
  const predRows = m.curNet.rels.map((r) => ({ task_pred_id: 5000 + r.id, task_id: tid(m.actByKey.get(r.to)), pred_task_id: tid(m.actByKey.get(r.from)), proj_id: 1, pred_proj_id: 1, pred_type: 'PR_' + r.type, lag_hr_cnt: r.lag * hrs, comments: '', float_path: '', aref: '', arls: '' }));
  T('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt', 'comments', 'float_path', 'aref', 'arls'], predRows);
  T('UDFTYPE', ['udf_type_id', 'table_name', 'udf_type_name', 'udf_type_label', 'logical_data_type', 'super_flag', 'indicator_expression', 'summary_indicator_expression', 'export_flag'], [{ udf_type_id: 900, table_name: 'TASK', udf_type_name: 'user_field_900', udf_type_label: 'BOQ Items', logical_data_type: 'FT_TEXT', super_flag: 'N', export_flag: 'Y' }, { udf_type_id: 901, table_name: 'TASK', udf_type_name: 'user_field_901', udf_type_label: 'Duration basis', logical_data_type: 'FT_TEXT', super_flag: 'N', export_flag: 'Y' }]);
  const udf = []; m.acts.forEach((a) => { const refs = [...new Set(a.items.map((x) => (m.itemById.get(x.id) || {}).ref).filter(Boolean))].join(', '); if (refs) udf.push({ udf_type_id: 900, fk_id: tid(a), proj_id: 1, udf_text: refs }); if (a.basis) udf.push({ udf_type_id: 901, fk_id: tid(a), proj_id: 1, udf_text: a.basis }); });
  T('UDFVALUE', ['udf_type_id', 'fk_id', 'proj_id', 'udf_date', 'udf_number', 'udf_text', 'udf_code_id'], udf);
  L.push('%E');
  return L.join('\r\n') + '\r\n';
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function toP6XML(m) {
  const cal = m.cal; const p = m.project; const hrs = m.settings.cal.hoursPerDay || 9; const dt = (d, end) => (d == null ? '' : `${cal.iso(d)}T${end ? '17' : '08'}:00:00`);
  const TYPE = { TT_Task: 'Task Dependent', TT_Mile: 'Start Milestone', TT_FinMile: 'Finish Milestone', TT_LOE: 'Level of Effort' };
  const REL = { FS: 'Finish to Start', SS: 'Start to Start', FF: 'Finish to Finish' };
  const o = ['<?xml version="1.0" encoding="UTF-8"?>', '<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6/V19.12/API/BusinessObjects">', '  <Project>', `    <ObjectId>1</ObjectId><Id>${xmlEsc(p.code)}</Id><Name>${xmlEsc(p.name)}</Name>`, `    <PlannedStartDate>${p.startDate}T08:00:00</PlannedStartDate><MustFinishByDate>${dt(m.finishBy, true)}</MustFinishByDate><DataDate>${p.dataDate}T08:00:00</DataDate>`, `    <CriticalActivityFloatLimit>0</CriticalActivityFloatLimit><ActivityDefaultDurationType>Fixed Duration and Units</ActivityDefaultDurationType>`];
  o.push(`    <Calendar><ObjectId>1</ObjectId><Name>UAE project calendar</Name><HoursPerDay>${hrs}</HoursPerDay><Type>Project</Type>`);
  o.push('      <StandardWorkWeek>' + DOW.map((dn, i) => `<StandardWorkHours><DayOfWeek>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}</DayOfWeek>${m.settings.cal.offDays.includes(i) ? '' : `<WorkTime><Start>07:00:00</Start><Finish>${String(7 + hrs + 1).padStart(2, '0')}:00:00</Finish></WorkTime>`}</StandardWorkHours>`).join('') + '</StandardWorkWeek>');
  if (m.settings.cal.holidays) o.push('      <HolidayOrExceptions>' + UAE_HOLIDAYS.map(([d]) => `<HolidayOrException><Date>${d}T00:00:00</Date></HolidayOrException>`).join('') + '</HolidayOrExceptions>');
  o.push('    </Calendar>');
  STAGES.forEach((s) => o.push(`    <WBS><ObjectId>${100 + s.no}</ObjectId><Code>${String(s.no).padStart(2, '0')}.${s.code}</Code><Name>${xmlEsc(s.name)}</Name><SequenceNumber>${s.no}</SequenceNumber></WBS>`));
  m.acts.forEach((a) => o.push(`    <Activity><ObjectId>${2000 + a.idx}</ObjectId><Id>${a.code}</Id><Name>${xmlEsc(a.name)}</Name><WBSObjectId>${100 + a.wbs}</WBSObjectId><CalendarObjectId>1</CalendarObjectId><Type>${TYPE[a.type]}</Type><PercentCompleteType>Physical</PercentCompleteType><PhysicalPercentComplete>${round(a.pct * 100, 1)}</PhysicalPercentComplete><PlannedDuration>${a.blDur * hrs}</PlannedDuration><RemainingDuration>${(a.rd || 0) * hrs}</RemainingDuration><PlannedStartDate>${dt(a.bl.es)}</PlannedStartDate><PlannedFinishDate>${dt(a.bl.ef, true)}</PlannedFinishDate>${a.as != null ? `<ActualStartDate>${dt(a.as)}</ActualStartDate>` : ''}${a.af != null ? `<ActualFinishDate>${dt(a.af, true)}</ActualFinishDate>` : ''}<Status>${a.status === 'Completed' ? 'Completed' : a.status === 'In progress' ? 'In Progress' : 'Not Started'}</Status></Activity>`));
  m.curNet.rels.forEach((r) => o.push(`    <Relationship><ObjectId>${5000 + r.id}</ObjectId><PredecessorActivityObjectId>${2000 + m.actByKey.get(r.from).idx}</PredecessorActivityObjectId><SuccessorActivityObjectId>${2000 + m.actByKey.get(r.to).idx}</SuccessorActivityObjectId><Type>${REL[r.type]}</Type><Lag>${r.lag * hrs}</Lag></Relationship>`));
  o.push('  </Project>', '</APIBusinessObjects>');
  return o.join('\n');
}
function activitiesTable(m) {
  const cal = m.cal; const head = ['Activity ID', 'Activity Name', 'WBS', 'Type', 'Original Duration', 'Remaining Duration', '% Complete', 'BL Start', 'BL Finish', 'Start', 'Finish', 'Actual Start', 'Actual Finish', 'Total Float', 'Critical', 'Start Variance', 'Finish Variance', 'Predecessors', 'BOQ Items', 'Duration Basis'];
  const rows = m.acts.map((a) => [a.code, a.name, `${String(a.wbs).padStart(2, '0')}.${stageByNo(a.wbs).code}`, a.type, a.blDur, a.rd, round(a.pct * 100, 1), a.bl.es != null ? cal.iso(a.bl.es) : '', a.bl.ef != null ? cal.iso(a.bl.ef) : '', a.cur.es != null ? cal.iso(a.cur.es) : '', a.cur.ef != null ? cal.iso(a.cur.ef) : '', a.as != null ? cal.iso(a.as) : '', a.af != null ? cal.iso(a.af) : '', a.cur.tf ?? '', a.cur.critical ? 'Y' : 'N', a.startVar, a.finishVar, a.preds.map((r) => `${m.actByKey.get(r.from).code}:${r.type}${r.lag ? (r.lag > 0 ? '+' : '') + r.lag : ''}`).join(', '), [...new Set(a.items.map((x) => (m.itemById.get(x.id) || {}).ref))].join(', '), a.basis || '']);
  return { head, rows };
}
const csvOf = ({ head, rows }) => [head, ...rows].map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');

function parseXER(text, cal) {
  const tables = {}; let cur = null, fields = null;
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split('\t');
    if (parts[0] === '%T') { cur = parts[1]; tables[cur] = []; fields = null; }
    else if (parts[0] === '%F') fields = parts.slice(1);
    else if (parts[0] === '%R' && cur && fields) { const o = {}; fields.forEach((f, i) => { o[f] = parts[i + 1]; }); tables[cur].push(o); }
  }
  if (!tables.TASK) throw new Error('No TASK table found. Is this a Primavera P6 .xer export?');
  const toDay = (s) => (s ? cal.dayOf(parseISO(s.slice(0, 10))) : null);
  const hrs = Number((tables.CALENDAR && tables.CALENDAR[0] && tables.CALENDAR[0].day_hr_cnt) || 8) || 8;
  const tasks = {};
  for (const t of tables.TASK) {
    const tf = t.total_float_hr_cnt === '' || t.total_float_hr_cnt == null ? null : Math.round(Number(t.total_float_hr_cnt) / hrs);
    tasks[t.task_code] = { name: t.task_name, es: toDay(t.act_start_date || t.early_start_date || t.restart_date), ef: toDay(t.act_end_date || t.early_end_date || t.reend_date), tf, critical: t.driving_path_flag === 'Y' || (tf != null && tf <= 0), status: t.status_code, pct: Number(t.phys_complete_pct || 0) };
  }
  const proj = tables.PROJECT && tables.PROJECT[0];
  return { tasks, count: tables.TASK.length, rels: (tables.TASKPRED || []).length, project: proj ? proj.proj_short_name : '', dataDate: proj ? (proj.last_recalc_date || '').slice(0, 10) : '' };
}

// ───────────────────────── reports (generic structure) ─────────────────────────
function dprReport(m, dateISO) {
  const cal = m.cal; const d = cal.dayOf(parseISO(dateISO)); const logs = m.logs.filter((l) => l.date === dateISO);
  const p = m.project; const info = cal.info(d);
  const merged = { manpower: {}, equipment: {}, qty: [], pours: [], insp: [], photos: [], blockers: [], incidents: 0, nearMiss: 0, tbt: 0 };
  logs.forEach((l) => { Object.entries(l.manpower || {}).forEach(([k, v]) => (merged.manpower[k] = (merged.manpower[k] || 0) + Number(v || 0))); Object.entries(l.equipment || {}).forEach(([k, v]) => (merged.equipment[k] = (merged.equipment[k] || 0) + Number(v || 0))); merged.qty.push(...(l.qty || [])); merged.pours.push(...(l.pours || [])); merged.insp.push(...(l.insp || [])); merged.photos.push(...(l.photos || [])); if (l.blockers) merged.blockers.push(l.blockers); merged.incidents += Number(l.incidents || 0); merged.nearMiss += Number(l.nearMiss || 0); merged.tbt += Number(l.tbt || 0); });
  const w = logs[0] || {}; const hrs = m.settings.cal.hoursPerDay || 9; const mpTotal = sum(Object.values(merged.manpower));
  const qtyRows = merged.qty.map((q) => { const it = m.itemById.get(q.itemId); if (!it) return null; const cum = m.execQtyAt(it, d); return [it.ref, it.desc, `S${it.c.stage}`, q.loc || '', it.unit, round(q.qty, 2), round(cum, 2), it.qty, round((cum / it.qty) * 100, 1), round(q.qty * it.rate)]; }).filter(Boolean);
  const valueToday = sum(qtyRows, (r) => r[9]);
  const pvToday = m.pvAt(d) - m.pvAt(cal.back(d, 1));
  const reportNo = cal.wd(-1, d);
  const midday = info.inSummer ? 'Applies: no outdoor work 12:30–15:00 (MoHRE midday break)' : 'Not applicable (15 Jun – 15 Sep only)';
  const loggedPhotos = merged.photos;
  return {
    type: 'DPR', title: 'Daily Progress Report', subtitle: `${p.name}`, number: `DPR-${String(reportNo).padStart(3, '0')}`, period: `${w.dow || DOW[new Date(cal.date(d)).getUTCDay()]}, ${fmtDate(cal.date(d))}`,
    meta: [['Project', p.name], ['Contract No.', p.contractNo], ['Report date', fmtDate(cal.date(d))], ['Weather', `${w.weather || '—'}, max ${w.tempMax ?? '—'}°C, RH ${w.humidity ?? '—'}%, wind ${w.wind ?? '—'} km/h`], ['Midday break rule', midday], ['Ramadan hours', info.inRam ? 'Reduced working hours apply' : 'Normal hours']],
    sections: [
      { kind: 'kpis', title: 'Day at a glance', items: [['Manpower on site', AED(mpTotal)], ['Man-hours', AED(mpTotal * hrs)], ['Work done today (AED)', AED(valueToday)], ['Planned for today (AED)', AED(pvToday)], ['Cumulative EV (AED)', AED(m.evAt(d))], ['LTI / incidents', String(merged.incidents)]] },
      { kind: 'table', title: 'HSE status', head: ['Lost-time injuries', 'Near misses', 'Toolbox talks', 'Safe man-hours today', 'Permits to work'], rows: [[merged.incidents, merged.nearMiss, merged.tbt, AED(mpTotal * hrs), 'Hot work, height, lifting – all valid']] },
      { kind: 'table', title: 'Manpower deployment', head: ['Trade', 'Headcount', 'Man-hours'], rows: Object.entries(merged.manpower).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, v * hrs]), total: ['Total', mpTotal, mpTotal * hrs] },
      { kind: 'table', title: 'Equipment deployment', head: ['Equipment', 'Units', 'Status'], rows: Object.entries(merged.equipment).map(([k, v]) => [k, v, 'Working']) },
      { kind: 'table', title: 'BOQ quantities executed today', head: ['Item', 'Description', 'Stage', 'Location', 'Unit', 'Qty today', 'Cum. qty', 'BOQ qty', '% done', 'Value AED'], rows: qtyRows, total: ['', 'Total value executed today', '', '', '', '', '', '', '', round(valueToday)], numeric: [5, 6, 7, 8, 9], wide: 1 },
      { kind: 'table', title: 'Concrete pours', head: ['Element', 'Grade', 'Volume m³', 'Supplier', 'Cubes taken'], rows: merged.pours.map((x) => [x.element, x.grade, x.vol, x.supplier, x.cubes]), empty: 'No concrete pours today.' },
      { kind: 'table', title: 'Inspections raised (WIR / MIR)', head: ['Type', 'Reference', 'Description', 'Result'], rows: merged.insp.map((x) => [x.kind, x.ref, x.desc, x.result]), empty: 'No inspection requests today.' },
      { kind: 'photos', title: 'Site photos', photos: loggedPhotos },
      { kind: 'list', title: 'Blockers & issues requiring action', items: merged.blockers.length ? merged.blockers : ['No blockers reported.'] },
    ],
    empty: !logs.length,
  };
}

function weekRange(m, endISO) { const e = m.cal.dayOf(parseISO(endISO)); return [e - 6, e]; }
function wprReport(m, endISO) {
  const cal = m.cal; const [s, e] = weekRange(m, endISO); const p = m.project;
  const pvW = m.pvAt(e) - m.pvAt(s - 1); const evW = m.evAt(e) - m.evAt(s - 1); const acW = m.acAt(e) - m.acAt(s - 1);
  const logs = m.logs.filter((l) => { const d = cal.dayOf(parseISO(l.date)); return d >= s && d <= e; });
  const mpAvg = logs.length ? Math.round(sum(logs, (l) => sum(Object.values(l.manpower || {}))) / new Set(logs.map((l) => l.date)).size) : 0;
  const stageRows = STAGES.map((st) => { const f = (i) => i.c.stage === st.no; const pv = m.pvAt(e, f) - m.pvAt(s - 1, f); const ev = m.evAt(e, f) - m.evAt(s - 1, f); const bud = sum(m.items.filter((i) => f(i) && !i.c.reserve), (i) => i.amount); if (!bud || (Math.abs(pv) < 1 && Math.abs(ev) < 1)) return null; return [`${st.no}. ${st.name}`, round(pv), round(ev), round(ev - pv), round((m.pvAt(e, f) / bud) * 100, 1), round((m.evAt(e, f) / bud) * 100, 1)]; }).filter(Boolean);
  const daily = []; for (let d = s; d <= e; d++) { const ls = logs.filter((l) => l.date === cal.iso(d)); daily.push([`${DOW[new Date(cal.date(d)).getUTCDay()]} ${fmtDate(cal.date(d))}`, cal.isWork(d) ? 'Working' : (cal.info(d).holName || 'Rest day'), sum(ls, (l) => sum(Object.values(l.manpower || {}))), round(m.pvAt(d) - m.pvAt(d - 1)), round(m.evAt(d) - m.evAt(d - 1))]); }
  const la = lookahead(m, 14, e);
  const subsBy = {}; m.docs.subs.forEach((x) => { subsBy[x.type] = subsBy[x.type] || { NS: 0, SUB: 0, UR: 0, A: 0, B: 0, C: 0, D: 0 }; subsBy[x.type][x.status]++; });
  const ev = evmAt(m, e);
  const sched = [['Data date', fmtDate(cal.date(m.dataDay))], ['Baseline completion', cal.fmt(m.baselineFinish)], ['Forecast completion', cal.fmt(m.forecastFinish)], ['Contract completion', cal.fmt(m.finishBy)], ['Finish variance vs baseline', `${m.finishVarDays} WD`], ['Critical path float', `${m.cur.minTF} WD`]];
  return {
    type: 'WPR', title: 'Weekly Progress Report', subtitle: p.name, number: `WPR-${String(Math.ceil((e + 1) / 7)).padStart(3, '0')}`, period: `${fmtDate(cal.date(s))} to ${fmtDate(cal.date(e))}`,
    meta: [['Project', p.name], ['Contract No.', p.contractNo], ['Week', `${fmtDate(cal.date(s))} – ${fmtDate(cal.date(e))}`], ['Working days in week', String(cal.wd(s - 1, e))]],
    sections: [
      { kind: 'kpis', title: 'Week at a glance', items: [['Planned value (week)', AED(pvW)], ['Earned value (week)', AED(evW)], ['Weekly SPI', pvW ? (evW / pvW).toFixed(2) : '—'], ['Cumulative planned', (ev.pctPlanned * 100).toFixed(1) + '%'], ['Cumulative earned', (ev.pctEarned * 100).toFixed(1) + '%'], ['Avg daily manpower', AED(mpAvg)]] },
      { kind: 'kv', title: 'Programme status (P6 current update)', items: sched },
      { kind: 'table', title: 'Planned vs actual by lifecycle stage (rolling 7 days)', head: ['Stage', 'Planned AED', 'Earned AED', 'Variance AED', 'Cum. planned %', 'Cum. earned %'], rows: stageRows, numeric: [1, 2, 3, 4, 5], total: ['Total', round(pvW), round(evW), round(evW - pvW), round(ev.pctPlanned * 100, 1), round(ev.pctEarned * 100, 1)] },
      { kind: 'table', title: 'Daily trend', head: ['Day', 'Calendar', 'Manpower', 'Planned AED', 'Earned AED'], rows: daily, numeric: [2, 3, 4] },
      { kind: 'table', title: '2-week lookahead (from P6 current schedule)', head: ['Activity ID', 'Activity', 'Start', 'Finish', 'Float', 'Qty in window', 'Constraints'], rows: la.map((x) => [x.a.code, x.a.name, cal.fmt(x.a.cur.es), cal.fmt(x.a.cur.ef), x.a.cur.tf ?? '', x.qty ? `${AED(x.qty, x.unit === 'LS' ? 2 : 0)} ${x.unit}` : '—', x.constraints.join('; ') || 'Clear']), wide: 1 },
      { kind: 'table', title: 'Submittal status summary', head: ['Type', 'Not submitted', 'Submitted', 'Under review', 'A', 'B', 'C', 'D', 'Overdue'], rows: Object.entries(subsBy).map(([t, c]) => [SUB_TYPES[t] || t, c.NS, c.SUB, c.UR, c.A, c.B, c.C, c.D, m.docs.subs.filter((x) => x.type === t && x.overdue).length]) },
      { kind: 'table', title: 'Authority NOC & permit tracker', head: ['Authority', 'Permit / NOC', 'Status', 'Need by', 'Forecast'], rows: m.docs.nocs.filter((n) => n.status !== 'APPROVED').map((n) => [n.auth, n.name, NOC_LABEL[n.status], cal.fmt(n.needBy), cal.fmt(n.curFinish)]), empty: 'All authority approvals obtained.' },
      { kind: 'table', title: 'Procurement & long-lead deliveries', head: ['Package', 'Lead (wk)', 'Status', 'Expected', 'Required on site', 'Float (WD)'], rows: m.docs.procurement.map((x) => [x.name, x.leadWk, x.status, cal.fmt(x.expDay), cal.fmt(x.reqDay), x.float]) },
      { kind: 'table', title: 'Quality (NCRs) & HSE summary', head: ['Ref', 'Description', 'Raised', 'Status'], rows: SEED_NCRS.map((n) => [n.no, n.title, n.raised, n.status]) },
      { kind: 'kv', title: 'HSE this week', items: [['Lost-time injuries', String(sum(logs, (l) => l.incidents))], ['Near misses', String(sum(logs, (l) => l.nearMiss))], ['Toolbox talks', String(sum(logs, (l) => l.tbt))], ['Man-hours', AED(sum(logs, (l) => sum(Object.values(l.manpower || {}))) * (m.settings.cal.hoursPerDay || 9))], ['Cost this week (AC)', AED(acW)]] },
    ],
  };
}
const SEED_NCRS = [
  { no: 'NCR-001', title: 'Honeycombing at column C12, Level 1', raised: '12-Aug-26', status: 'Closed' },
  { no: 'NCR-002', title: 'Insufficient rebar cover at PT slab edge, Level 3 Zone B', raised: '28-Oct-26', status: 'Open – repair method under review' },
  { no: 'NCR-003', title: 'Blockwork joint thickness exceeding 12mm, GF', raised: '09-Nov-26', status: 'Open – rectification ongoing' },
  { no: 'NCR-004', title: 'Waterproofing lap length at raft–wall junction', raised: '02-Jun-26', status: 'Closed' },
];
const SEED_RISKS = [
  { title: 'Rebar and ready-mix price escalation', owner: 'QS', p: 4, i: 3, mit: 'Lock in supply rates for the remaining superstructure. Review fluctuation clause.' },
  { title: 'DEWA substation NOC approval delay', owner: 'MEP manager', p: 4, i: 5, mit: 'Weekly follow-up with DEWA. Resubmit the RMU room design within 7 days.' },
  { title: 'Late delivery of lifts (18-week lead time)', owner: 'Procurement', p: 3, i: 4, mit: 'Expedite the PO and arrange factory inspection. Install a temporary hoist.' },
  { title: 'Summer heat (midday break, Jun–Sep)', owner: 'Planner', p: 5, i: 2, mit: 'Shift façade and roof work to night shifts. Calendar productivity factor 0.85 applied.' },
  { title: 'Consultant review cycles above 14 days', owner: 'Document controller', p: 3, i: 3, mit: 'Weekly submittal review meeting. Escalate overdue items.' },
  { title: 'Labour availability (visa processing, demobilisation)', owner: 'Construction manager', p: 3, i: 3, mit: 'Framework agreement with a labour supplier. Two standby gangs.' },
  { title: 'Heavy rainfall or flash-flood event', owner: 'HSE manager', p: 2, i: 4, mit: 'Dewatering pumps on standby. Protect the basement and electrical rooms.' },
];

function mprReport(m, monthIdx) {
  const cal = m.cal; const mo = m.months[monthIdx]; const p = m.project;
  const cut = Math.min(mo.endDay, m.dataDay); const ev = evmAt(m, cut);
  const pmEnd = monthIdx > 0 ? Math.min(m.months[monthIdx - 1].endDay, m.dataDay) : -1;
  const evPrev = pmEnd >= 0 ? m.evAt(pmEnd) : 0;
  const divRows = [...new Set(m.items.map((i) => i.division))].map((dv) => { const f = (i) => i.division === dv && !i.c.reserve; const bud = sum(m.items.filter(f), (i) => i.amount); if (!bud) return null; const pv = m.pvAt(cut, f), e = m.evAt(cut, f), a = m.acAt(cut, f); return [dv, round(bud), round((bud / m.bac) * 100, 1), round(pv), round(e), round(a), round(e - a), round(e - pv), round((e / bud) * 100, 1)]; }).filter(Boolean);
  const cfRows = m.months.slice(0, monthIdx + 1).map((x) => { const ipc = m.ipcs.find((i) => i.period === x.label); return [x.label, round(x.pvMonth), x.evMonth != null ? round(x.evMonth) : '', ipc ? `IPC-${String(ipc.no).padStart(2, '0')}` : '—', ipc ? round(ipc.net) : '', ipc ? round(ipc.payable) : '', ipc ? ipc.status : '']; });
  const crit = m.acts.filter((a) => a.type === 'TT_Task' && a.status !== 'Completed' && (a.cur.critical || a.finishVar < -10)).sort((a, b) => a.finishVar - b.finishVar).slice(0, 12);
  const DRIVERS = { 5: 'Floor cycle running at about 15–16 days against 14 planned; PT stressing crew shared with another site', 6: 'Blockwork gangs remobilised late after de-propping', 7: 'MEP coordinated shop drawings approved late', 8: 'Follows blockwork and first-fix slippage', 9: 'Aluminium window shop drawings in revise and resubmit (Code C)', 2: 'DEWA comments on the substation RMU room', 10: 'Waiting on approved equipment submittals', 11: 'Substation NOC outstanding', 12: 'Follows MEP second fix' };
  const photos = m.logs.filter((l) => { const d = cal.dayOf(parseISO(l.date)); return d <= cut && d > pmEnd; }).flatMap((l) => (l.photos || []).map((ph) => ({ ...ph, caption: `${fmtDate(parseISO(l.date))} – ${ph.caption || ''}` }))).slice(-6);
  const pctPhys = ev.pctEarned * 100; const pctPlan = ev.pctPlanned * 100;
  const summary = [
    `As of ${fmtDate(cal.date(cut))} overall progress is ${pctPhys.toFixed(1)}% against ${pctPlan.toFixed(1)}% planned (SPI ${ev.spi.toFixed(2)}). Cumulative earned value is AED ${AED(ev.ev)} out of a baseline budget of AED ${AED(m.bac)}. AED ${AED(ev.ev - evPrev)} was earned this month.`,
    `Cost performance: CPI ${ev.cpi.toFixed(2)}. The estimate at completion is AED ${AED(ev.eac)}, a variance at completion of AED ${AED(ev.vac)}. ${ev.cpi < 1 ? 'Overruns are concentrated in reinforcement and concrete because of steel price escalation.' : 'Costs are within budget.'}`,
    `Programme: the current P6 update forecasts completion on ${cal.fmt(m.forecastFinish)}, against a baseline of ${cal.fmt(m.baselineFinish)} and a contract completion date of ${cal.fmt(m.finishBy)}. That is ${m.finishVarDays} working days against baseline and ${m.contractVarDays} working days of float to the contract date. ${m.recovery.some((r) => r.level === 'critical') ? 'Recovery programme triggers are active; see the critical path section.' : 'No recovery programme is required this period.'}`,
    `Commercial: ${m.ipcs.length} IPCs raised. Approved variations total AED ${AED(m.approvedVO)}, giving a revised contract sum of AED ${AED(m.revisedSum)} excl. VAT (AED ${AED(m.revisedSum * 1.05)} incl. 5% VAT).`,
  ];
  return {
    type: 'MPR', title: 'Monthly Progress Report', subtitle: p.name, number: `MPR-${String(monthIdx + 1).padStart(2, '0')}`, period: mo.label + (mo.endDay > m.dataDay ? ` (to ${fmtDate(cal.date(cut))})` : ''),
    meta: [['Project', p.name], ['Contract No.', p.contractNo], ['Client', p.client], ['Consultant', p.consultant], ['Reporting period', `${mo.label}, cut-off ${fmtDate(cal.date(cut))}`]],
    sections: [
      { kind: 'text', title: 'Executive summary', paras: summary },
      { kind: 'kpis', title: 'Earned value metrics', items: [['BAC (AED)', AED(m.bac)], ['Planned value (PV)', AED(ev.pv)], ['Earned value (EV)', AED(ev.ev)], ['Actual cost (AC)', AED(ev.ac)], ['CPI', ev.cpi.toFixed(2)], ['SPI', ev.spi.toFixed(2)], ['EAC', AED(ev.eac)], ['VAC', AED(ev.vac)], ['TCPI', ev.tcpi.toFixed(2)]] },
      { kind: 'chart', title: 'Financial & physical S-curve (cumulative % of BAC)', months: m.months, cut, bac: m.bac },
      { kind: 'table', title: 'Division valuation & budget variance', head: ['Division', 'Budget AED', 'Weight %', 'Planned to date', 'Earned to date', 'Actual cost', 'CV', 'SV', '% complete'], rows: divRows, numeric: [1, 2, 3, 4, 5, 6, 7, 8], total: ['Total', round(m.bac), 100, round(ev.pv), round(ev.ev), round(ev.ac), round(ev.cv), round(ev.sv), round(ev.pctEarned * 100, 1)] },
      { kind: 'table', title: 'Cash flow forecast vs IPC status', head: ['Month', 'Forecast (PV)', 'Earned', 'IPC', 'Net certified', 'Payable incl. VAT', 'Status'], rows: cfRows, numeric: [1, 2, 4, 5] },
      { kind: 'table', title: 'Critical path & delays (P6 current vs baseline)', head: ['Activity ID', 'Activity', 'BL finish', 'Forecast finish', 'Var (WD)', 'Float', 'Delay driver'], rows: crit.map((a) => [a.code, a.name, cal.fmt(a.bl.ef), cal.fmt(a.cur.ef), a.finishVar, a.cur.tf ?? '', DRIVERS[a.stage] || 'Follows predecessor slippage']), wide: 1 },
      { kind: 'list', title: 'Recovery programme triggers', items: m.recovery.length ? m.recovery.map((r) => `${r.level === 'critical' ? '[CRITICAL]' : '[WATCH]'} ${r.title}: ${r.detail}`) : ['No triggers active.'] },
      { kind: 'table', title: 'Variation orders', head: ['VO', 'Description', 'Amount AED', 'Time (days)', 'Status'], rows: m.vos.map((v) => [v.no, v.title, v.amount, v.days, v.status]), numeric: [2] },
      { kind: 'table', title: 'Risk register', head: ['Risk', 'Owner', 'P', 'I', 'Score', 'Mitigation'], rows: SEED_RISKS.map((r) => [r.title, r.owner, r.p, r.i, r.p * r.i, r.mit]).sort((a, b) => b[4] - a[4]), wide: 5 },
      { kind: 'photos', title: 'Progress photo log', photos },
    ],
  };
}

const Engine = {
  STAGES, stageByNo, RULES, classify, applyStageOverride, SAMPLE_BOQ, parseRows, parsePdfLines, buildCalendar, DEFAULT_CAL, DEFAULT_NORMS, DEFAULT_FIXED, DEFAULT_SCHED,
  UAE_HOLIDAYS, RAMADAN, generateSchedule, cpm, buildModel, evmAt, lookahead, toXER, toP6XML, activitiesTable, csvOf, parseXER, dprReport, wprReport, mprReport,
  SEED_VOS, SEED_NCRS, SEED_RISKS, NOC_STATUSES, NOC_LABEL, SUB_STATUSES, SUB_LABEL, SUB_TYPES, AUTH_NAMES, AED, shortAED, fmtDate, iso, parseISO, round, sum, clamp, hash01, MONTHS, DOW, FLOORWISE,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
