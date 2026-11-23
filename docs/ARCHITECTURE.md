# SiteLedger UAE — BOQ-to-Execution Platform

System architecture and technology stack for end-to-end construction project management in the UAE.
The core idea: **one uploaded Bill of Quantities drives everything** — WBS, budget, cash flow, submittal
and authority logs, and daily, weekly and monthly reporting.

---

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js 15 (App Router) + React 19 + TypeScript** | SSR for dashboards, server actions for forms, one codebase for the office web app and the field PWA |
| UI | **Tailwind CSS + shadcn/ui (Radix)**, TanStack Table, Recharts/visx | Dense, accessible data tables and charts |
| Field app | Same Next.js app as an **installable PWA** (offline via Workbox + IndexedDB with Dexie); optional Expo (React Native) shell later | Site engineers work in basements and on slab decks with no signal. Entries queue offline and sync later |
| API | **Python FastAPI** (domain and parsing services) behind the Next.js BFF | Python has the best Excel/PDF/table tooling and ML ecosystem |
| Workers | **Celery or Arq + Redis** | BOQ parsing, schedule generation and report rendering run as async jobs |
| Database | **PostgreSQL 16** (+ `pg_trgm`, `pgvector`, row-level security) | Relational core with fuzzy search and embeddings for BOQ classification |
| File storage | S3-compatible storage (AWS `me-central-1` UAE region, or Azure UAE North) | UAE data residency for government/semi-government clients |
| BOQ parser | `openpyxl`/`pandas` for xlsx/csv; `pdfplumber` + `camelot` for digital PDFs; OCR (Tesseract or AWS Textract) for scans; **LLM (Claude) for header detection, ambiguous-row classification and stage mapping**, using structured JSON output | Deterministic rules first, then an LLM for the long tail, with confidence scores and human review |
| Scheduling | In-house CPM engine (Python) with Primavera **XER/XML export and XER import** | Consultants in the UAE expect P6 programmes |
| Reports | PDF: **WeasyPrint** (HTML→PDF) or Playwright print. Excel: **openpyxl / XlsxWriter** with formulas kept live | Branded, paginated, bilingual (EN/AR) templates |
| Auth | Keycloak / Auth0 / Entra ID with SSO, MFA and project-scoped RBAC | Client, consultant, contractor and subcontractor roles |
| Infra | Docker, Kubernetes (EKS/AKS), Terraform, GitHub Actions, OpenTelemetry, Sentry | |

## 2. Logical architecture

```
                ┌───────────────────────── Clients ──────────────────────────┐
                │  Office web app (Next.js)      Field PWA (offline, camera) │
                └──────────────┬───────────────────────────┬─────────────────┘
                               │ HTTPS / tRPC              │ Background sync
                ┌──────────────▼───────────────────────────▼─────────────────┐
                │          Next.js BFF  (auth, session, RBAC, caching)        │
                └──────────────┬──────────────────────────────────────────────┘
                               │ REST/JSON (OpenAPI)
 ┌─────────────────────────────▼──────────────────────────────────────────────────┐
 │                               FastAPI domain services                           │
 │  boq-ingest │ wbs-planner │ cost-control │ docs-control │ field-log │ reporting │
 └──────┬──────────────┬───────────────┬───────────────┬───────────────┬───────────┘
        │ jobs         │               │               │               │
 ┌──────▼─────┐  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
 │ Redis queue│  │ PostgreSQL │  │ S3 storage │  │ LLM gateway│  │ Notifier   │
 │  workers   │  │ (RLS)      │  │ files/PDFs │  │ (Claude)   │  │ email/push │
 └────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘
```

### Services

| Service | Responsibility |
|---|---|
| **boq-ingest** | Upload → file sniffing → sheet/table detection → header and column mapping → row extraction (bill/section headers, items, sub-totals) → validation (`qty × rate = amount`, duplicate refs, unit normalisation) → classification into the 16 lifecycle stages, with confidence |
| **wbs-planner** | Builds the WBS (Project → Stage → Division → BOQ item), stage windows from a building-type template, item windows, the baseline S-curve (PV) and monthly cash flow |
| **cost-control** | Budgets by division, VAT (5%), provisional sums, VOs, revised contract sum, EVM (PV/EV/AC, CPI/SPI, EAC/ETC/VAC/TCPI), IPCs (advance recovery, retention and its cap, VAT) |
| **docs-control** | Auto-generated MAR, shop drawing, method statement, ITP and WIR/MIR registers; authority NOC and permit tracker (DM/DDA/Trakhees, DEWA, RTA, DCD, Etisalat/du); consultant review codes A/B/C/D; transmittals |
| **field-log** | Daily site diary: weather, HSE, manpower, equipment, BOQ quantities executed, concrete pours, WIRs/MIRs, photos (EXIF geotag and time), blockers. Offline-first sync with conflict resolution |
| **cpm-scheduler / p6-exchange** | Builds activities from the BOQ, computes durations from productivity norms, links FS/SS/FF with lags, runs CPM on UAE calendars, keeps baseline vs current versions, writes and reads XER/XML |
| **reporting** | DPR, WPR and MPR generators. One data snapshot per report run (immutable), rendered to PDF and XLSX, stored and versioned |

## 3. The BOQ-to-execution pipeline

1. **Read.** xlsx/xls/csv go through openpyxl/pandas (every sheet). PDFs go through pdfplumber table
   extraction, falling back to line regex and then OCR.
2. **Detect header.** Score each of the first 40 rows for the tokens
   `item/ref`, `description`, `unit`, `qty/quantity`, `rate`, `amount/total`. If confidence is below 0.7, ask the LLM.
3. **Extract rows.**
   - A row with a description but no qty or rate is a **bill or division heading**.
   - `Total`, `Carried to collection` and `Sub-total` rows are skipped.
   - `PS` units, or descriptions containing "provisional", become **provisional sums**.
   - "Contingency" becomes a **reserve**, which is not part of the PV baseline.
4. **Validate.** Check `|qty × rate − amount| ≤ 1%`, map units (`cum→m3`, `sqm→m2`, `no.→nr`), flag zero or negative values and duplicate refs.
5. **Classify.** Ordered keyword rules on description and division give the stage, trade, document profile and
   long-lead flag. Items the rules can't place fall back to the division mapping. Anything still below 0.7 confidence goes to the LLM, which returns
   `{stage, trade, rationale}` against the 16 stage definitions. A planner confirms the result in the UI, and
   overrides are saved as training examples (the pgvector nearest-neighbour store) so the next project maps better.
6. **Generate.**
   - Stage windows come from the building template, scaled to the contract duration. The DLP is 12 months after completion.
   - Item windows sit inside their stage (for example piling covers the first 35% of substructure).
   - PV per item follows a sine-bell distribution. Time-related preliminaries spread uniformly.
   - The cash flow forecast and S-curve are the sum of item PVs per month.
   - Submittals: one MAR and one shop drawing per item where the profile needs them, plus one method statement and one ITP per work type.
   - WIRs: `ceil(qty / inspection lot)` per item.
   - Authority NOCs come from the authority template and are triggered by BOQ content (substation → DEWA substation NOC, dewatering → dewatering permit, pool → pool permit).
   - Every submittal gets a required-approval date of item start minus its lead time.
   - Long-lead items get a procurement log with required-on-site date and float.

## 4. Earned value and payments (formulas)

```
PV(t)  = Σ amount_i · F_i(t)                 F = planned cumulative fraction of item i at time t
EV(t)  = Σ rate_i · executed_qty_i(t)        (PS/LS items: % complete × amount)
AC(t)  = Σ actual cost booked (timesheets, POs, subcontract valuations)
CPI = EV/AC   SPI = EV/PV   EAC = BAC/CPI   ETC = EAC − AC   VAC = BAC − EAC
TCPI = (BAC − EV)/(BAC − AC)

IPC n:  Gross work done (cumulative) + materials on site
        − advance recovery (advance% × gross, until fully recovered)
        − retention (retention% × gross, capped at cap% × contract sum)
        − previous certificates
        = net amount due;  + VAT 5%  = amount payable
```

## 4a. Primavera P6 planning module

### BOQ → WBS → activities
- **WBS** is Project → 16 lifecycle stages (`01.PC` … `16.PM`). These are exported as the XER `PROJWBS` table.
- **Activities** come from BOQ work packages: BOQ items that share a classification rule form one package.
  - Floor-wise packages are split per level. These are the RCC frame, blockwork, MEP first fix, plaster, finishes and MEP second fix. A G+4 building gives Ground, L1–L4 and Roof for the frame, and Ground–L4 for the fit-out trades.
  - Each floor activity carries an equal share of every BOQ item in its package, recorded in `activity_boq_items.qty_share`.
  - Long-lead items get two extra activities: *Submittal approval (MAR + SD)* followed by *Procure, manufacture & deliver*, with a duration equal to the supplier lead time.
  - Every authority NOC is an activity whose duration is the authority's SLA. Template NOCs are always generated. Triggered NOCs appear only when the BOQ needs them: substation → DEWA substation NOC, dewatering → DM dewatering permit, pool → pool permit, lifts → lift certificate.
  - Time-related preliminaries and authority fees become **Level of Effort** activities.
- **Durations.** Each item's duration is `BOQ qty ÷ output per day` from the first matching productivity norm (unit plus a description regex). The package takes the longest item duration. The frame uses the floor-cycle days. Lump-sum packages without a norm use configurable fixed durations.
- **Logic template** (excerpt):

| Predecessor | Rel | Successor |
|---|---|---|
| Building permit | FS | Mobilisation |
| Piling / shoring | FS | Bulk excavation |
| Excavation | SS + 60% | Blinding |
| RCC floor *n* | FS | RCC floor *n+1* |
| RCC floor *n+1* | FS + 7 (de-propping) | Blockwork floor *n* |
| Blockwork floor *n* | SS + 5 | MEP first fix floor *n* |
| First fix | FS | Plaster, then finishes (FS + 3) |
| Finishes | SS + 40% and FF + 5 | MEP second fix |
| Civil Defence drawing approval | FS | MEP first fix (first floor) |
| Substation + DEWA energisation | FF + 10 | Testing & commissioning |
| Civil Defence final + BCC | FS | Practical completion |

### Calendar
- Work week is configurable; Friday is off by default. Hours per day are configurable.
- UAE public holidays are non-working days. Islamic dates are estimates and must be confirmed when announced.
- Each day has a *capacity*. Ramadan days are 0.8 for every activity. Summer days (15 Jun – 15 Sep, midday break) are 0.85 for outdoor activities only.
- Durations consume capacity, so the same 20-day task takes longer in July than in November.
- Lags count whole working days.

### CPM, baseline and updates
- The forward and backward passes support FS, SS and FF relationships with lags, milestones and LOE. Late dates are computed against the contract **must-finish-by** date, so total float can go negative.
- The **longest path** is traced back from the completion milestone through driving relationships.
- **Baseline** is a frozen schedule version computed from the settings at the time of baselining. **Re-baseline** creates a new version.
- **Current update:**
  - Activity % complete is the value-weighted executed BOQ quantity from the site diaries. Floor-wise items fill floors in sequence.
  - Actual start and finish come from the first day progress appears and the day it reaches 100%.
  - Remaining duration is `OD × (1 − %) ÷ achieved production rate`, clamped to 0.5–1.25. This is the "remaining duration from actual productivity" approach.
  - Retained logic applies to activities that haven't started. In-progress activities use progress override.
- **Variances**: start and finish variance are baseline minus current, in working days.
- **Lookahead**: activities in the current update that overlap the next 14 or 21 days. Each row shows the remaining BOQ quantity inside the window and its constraints (NOCs pending, deliveries pending, submittals not approved).
- **Recovery triggers** fire on any of:
  - forecast completion later than the contract date (FIDIC 8.6)
  - finish variance worse than −10 WD
  - SPI below 0.95 (watch) or below 0.90 (recovery)
  - a critical activity finishing more than 15 WD late
  - a long-lead item with negative float
  - an authority NOC forecast after its need-by date

  Each trigger proposes a measure: extra gangs, a second shift, a second work front, changing FS to SS, expediting the PO, or an EOT claim.
- WPR and MPR pull the programme status, lookahead, critical path delays and recovery triggers from the current update.

### File exchange
- **Export .xer** with the tables ERMHDR, CURRTYPE, PROJECT, CALENDAR (work week and holiday exceptions), PROJWBS, TASK, TASKPRED and UDFTYPE/UDFVALUE.
  - TASK carries the baseline as target dates, current early/late dates, actuals, remaining duration, total float in hours and the driving-path flag.
  - TASKPRED carries PR_FS, PR_SS and PR_FF with lag hours.
  - The UDFs carry the BOQ item references and the duration basis.
- **Export P6 XML** (APIBusinessObjects), CSV and an Excel workbook (activities, relationships, norms, holidays). In the prototype these come as one .zip, because the browser sandbox only allows certain file extensions.
- **Import .xer**:
  1. Parse `%T/%F/%R`.
  2. Match TASK rows to activities on `task_code`.
  3. Take early or actual dates, `total_float_hr_cnt ÷ day_hr_cnt` and `driving_path_flag`.
  4. Store a `P6_IMPORT` schedule version and log the import in `p6_exchange_log`.

Imports and exports should be validated in a sandbox P6 database before they are used on a live project.

## 5. UAE-specific rules built in

- **VAT 5%** (Federal Decree-Law No. 8 of 2017) on every valuation and IPC. The tax invoice references the contractor's TRN.
- **Authority sequence.** The authority is chosen per plot: Dubai Municipality, DDA (free zones) or Trakhees (PCFC areas).
  - Building permit before mobilisation.
  - Shoring and dewatering permits before excavation.
  - DEWA load and substation NOCs before MEP design freeze.
  - Civil Defence drawing approval before MEP second fix.
  - DCD completion, DEWA energisation and the Building Completion Certificate before handover.
- **Summer midday break** (15 June – 15 September, 12:30–15:00). The diary flags it and the manpower-hours calculation excludes those hours.
- **Consultant review codes**: A (approved), B (approved with comments), C (revise and resubmit), D (rejected).
- **Retention** is typically 10% of each valuation, capped at 5% of the contract sum. Half is released at completion and half at the end of the 12-month DLP.
- **Calendar.** Work runs six days a week with Friday off by default (configurable per site), plus UAE public holidays.

## 6. Security and compliance

- Row-level security by `organisation_id` and `project_id`. Every write is audit-logged (who, when, before and after).
- Signed URLs for files. Photos are stripped of personal data, but GPS and time are kept as evidence.
- Data stays in a UAE region. Backups use PITR with 35-day retention.
- LLM calls send BOQ text only, never personal data, with zero-retention settings.

## 7. Delivery roadmap

| Phase | Scope |
|---|---|
| MVP (12–14 weeks) | BOQ ingest (xlsx/csv), 16-stage WBS, CPM programme from norms with UAE calendar, XER/XML export, budget and VAT, S-curve, submittal and NOC registers, field diary PWA, DPR/WPR/MPR PDF and XLSX |
| v1.1 | PDF and scanned BOQ via OCR, LLM classification with feedback loop, IPC workflow with consultant sign-off, XER import with conflict review, recovery programme versions |
| v1.2 | Subcontractor portal, procurement/PO integration, ERP connectors (SAP, Oracle, Odoo), Arabic UI |
| v2 | BIM 5D link (IFC quantity takeoff ↔ BOQ), drone/photo progress detection, predictive delay analytics |

The working prototype is in [`prototype/index.html`](../prototype/index.html). The database schema is in [`db/schema.sql`](../db/schema.sql).
