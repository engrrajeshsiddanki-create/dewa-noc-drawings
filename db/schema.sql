-- SiteLedger UAE: core PostgreSQL 16 schema
-- Money is stored as NUMERIC(16,2) AED. Quantities are NUMERIC(16,3).
-- Multi-tenant: every project-scoped table carries project_id and row-level security policies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector, for BOQ classification memory

-- ───────────────────────── Organisations, users, projects ─────────────────────────
CREATE TABLE organisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  trn           VARCHAR(15),                  -- UAE VAT Tax Registration Number
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  full_name       TEXT NOT NULL,
  email           CITEXT UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE authority_body AS ENUM ('DM','DDA','TRAKHEES','ADM','SHARJAH_MUN','OTHER');

CREATE TABLE projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES organisations(id),
  code               VARCHAR(30) NOT NULL,
  name               TEXT NOT NULL,
  plot_no            VARCHAR(40),
  community          TEXT,
  emirate            TEXT NOT NULL DEFAULT 'Dubai',
  building_type      TEXT NOT NULL DEFAULT 'G+4 Residential',
  permitting_authority authority_body NOT NULL DEFAULT 'DM',
  client_name        TEXT,
  consultant_name    TEXT,
  contract_no        TEXT,
  contract_type      TEXT DEFAULT 'FIDIC Red Book 1999 (re-measured)',
  start_date         DATE NOT NULL,
  duration_months    SMALLINT NOT NULL,
  dlp_months         SMALLINT NOT NULL DEFAULT 12,
  vat_rate           NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  retention_pct      NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  retention_cap_pct  NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  advance_pct        NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  work_week          TEXT NOT NULL DEFAULT 'MON-SAT',   -- Friday off by default is configurable
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code)
);

CREATE TABLE project_members (
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('ADMIN','PM','PLANNER','QS','SITE_ENGINEER','QAQC','HSE','DOC_CONTROLLER','CONSULTANT','CLIENT','VIEWER')),
  PRIMARY KEY (project_id, user_id)
);

-- ───────────────────────── Lifecycle stages (WBS level 1) ─────────────────────────
CREATE TABLE lifecycle_stages (               -- reference data: the 16 UAE stages
  stage_no     SMALLINT PRIMARY KEY CHECK (stage_no BETWEEN 1 AND 16),
  name         TEXT NOT NULL,
  template_start NUMERIC(5,3) NOT NULL,       -- fraction of contract duration
  template_end   NUMERIC(5,3) NOT NULL
);

CREATE TABLE wbs_nodes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES wbs_nodes(id),
  stage_no     SMALLINT NOT NULL REFERENCES lifecycle_stages(stage_no),
  level        SMALLINT NOT NULL,             -- 1 stage, 2 division, 3 work package
  code         VARCHAR(40) NOT NULL,          -- e.g. 05.STR.PT
  name         TEXT NOT NULL,
  planned_start DATE,
  planned_finish DATE,
  baseline_start DATE,
  baseline_finish DATE,
  forecast_start DATE,
  forecast_finish DATE,
  is_critical  BOOLEAN DEFAULT false,
  UNIQUE (project_id, code)
);

-- ───────────────────────── BOQ ─────────────────────────
CREATE TABLE boq_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_key      TEXT NOT NULL,                -- S3 object key
  mime_type     TEXT NOT NULL,
  revision      SMALLINT NOT NULL DEFAULT 0,
  parse_status  TEXT NOT NULL DEFAULT 'QUEUED' CHECK (parse_status IN ('QUEUED','PARSING','REVIEW','APPROVED','FAILED')),
  column_map    JSONB,                        -- detected header → field mapping
  parse_log     JSONB,                        -- warnings, skipped rows, LLM calls
  uploaded_by   UUID REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ
);

CREATE TABLE boq_divisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upload_id   UUID NOT NULL REFERENCES boq_uploads(id),
  bill_no     VARCHAR(20),
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL
);

CREATE TYPE boq_item_kind AS ENUM ('MEASURED','LUMP_SUM','PROVISIONAL_SUM','PRIME_COST','DAYWORK','RESERVE');

CREATE TABLE boq_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  division_id     UUID NOT NULL REFERENCES boq_divisions(id),
  wbs_node_id     UUID REFERENCES wbs_nodes(id),
  item_ref        VARCHAR(30) NOT NULL,
  description     TEXT NOT NULL,
  unit            VARCHAR(12) NOT NULL,       -- normalised: m3, m2, m, nr, ton, LS, PS, month
  quantity        NUMERIC(16,3) NOT NULL,
  rate            NUMERIC(16,2) NOT NULL,
  amount          NUMERIC(16,2) GENERATED ALWAYS AS (round(quantity * rate, 2)) STORED,
  amount_as_read  NUMERIC(16,2),              -- value printed in the source BOQ (for validation)
  kind            boq_item_kind NOT NULL DEFAULT 'MEASURED',
  stage_no        SMALLINT NOT NULL REFERENCES lifecycle_stages(stage_no),
  trade           VARCHAR(10),                -- STR, ARC, MEP, FAC, CIV, GEN
  map_confidence  NUMERIC(3,2),
  map_source      TEXT CHECK (map_source IN ('RULE','DIVISION','LLM','USER')),
  planned_start   DATE,
  planned_finish  DATE,
  is_long_lead    BOOLEAN NOT NULL DEFAULT false,
  embedding       vector(1024),                -- description embedding for future auto-mapping
  source_row      INT,
  UNIQUE (project_id, item_ref)
);
CREATE INDEX boq_items_desc_trgm ON boq_items USING gin (description gin_trgm_ops);
CREATE INDEX boq_items_stage ON boq_items (project_id, stage_no);

-- ───────────────────────── Budget, cash flow, EVM ─────────────────────────
CREATE TABLE budget_lines (                    -- control budget (may differ from BOQ selling rates)
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id   UUID REFERENCES boq_items(id),
  cost_code     VARCHAR(30) NOT NULL,
  budget_qty    NUMERIC(16,3),
  budget_rate   NUMERIC(16,2),
  budget_amount NUMERIC(16,2) NOT NULL,
  revision      SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE cashflow_periods (                -- baseline + forecast per month (S-curve source)
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_month     DATE NOT NULL,              -- first day of month
  baseline_pv      NUMERIC(16,2) NOT NULL,     -- planned value this month (excl. VAT)
  forecast_value   NUMERIC(16,2),
  earned_value     NUMERIC(16,2),
  actual_cost      NUMERIC(16,2),
  certified_value  NUMERIC(16,2),
  cash_received    NUMERIC(16,2),
  PRIMARY KEY (project_id, period_month)
);

CREATE TABLE item_progress_snapshots (         -- cumulative per item at each cut-off (immutable)
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id   UUID NOT NULL REFERENCES boq_items(id),
  cutoff_date   DATE NOT NULL,
  executed_qty  NUMERIC(16,3) NOT NULL,
  earned_value  NUMERIC(16,2) NOT NULL,
  actual_cost   NUMERIC(16,2) NOT NULL,
  planned_value NUMERIC(16,2) NOT NULL,
  PRIMARY KEY (boq_item_id, cutoff_date)
);

CREATE TABLE variation_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vo_no          VARCHAR(20) NOT NULL,
  title          TEXT NOT NULL,
  instruction_ref TEXT,                      -- Engineer's instruction / SI number
  submitted_amount NUMERIC(16,2) NOT NULL,
  approved_amount  NUMERIC(16,2),
  time_impact_days INT DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
  submitted_on   DATE,
  approved_on    DATE,
  UNIQUE (project_id, vo_no)
);
CREATE TABLE vo_items (                       -- links VO to new/omitted BOQ items
  vo_id        UUID REFERENCES variation_orders(id) ON DELETE CASCADE,
  boq_item_id  UUID REFERENCES boq_items(id),
  qty_change   NUMERIC(16,3),
  rate         NUMERIC(16,2),
  PRIMARY KEY (vo_id, boq_item_id)
);

CREATE TABLE payment_certificates (            -- IPCs
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ipc_no             SMALLINT NOT NULL,
  period_end         DATE NOT NULL,
  gross_cumulative   NUMERIC(16,2) NOT NULL,
  materials_on_site  NUMERIC(16,2) DEFAULT 0,
  advance_recovery_cum NUMERIC(16,2) DEFAULT 0,
  retention_cum      NUMERIC(16,2) DEFAULT 0,
  previous_certified NUMERIC(16,2) DEFAULT 0,
  net_this_period    NUMERIC(16,2) NOT NULL,
  vat_amount         NUMERIC(16,2) NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','CERTIFIED','PAID')),
  submitted_on       DATE, certified_on DATE, paid_on DATE,
  UNIQUE (project_id, ipc_no)
);

-- ───────────────────────── Engineering & authority documents ─────────────────────────
CREATE TYPE submittal_type AS ENUM ('MAR','SHOP_DRAWING','METHOD_STATEMENT','ITP','PROGRAMME','PLAN','SAMPLE','AS_BUILT','O_AND_M');
CREATE TYPE review_code AS ENUM ('NOT_SUBMITTED','SUBMITTED','UNDER_REVIEW','A','B','C','D');

CREATE TABLE submittals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_no           VARCHAR(40) NOT NULL,      -- e.g. MAR-STR-004 Rev 1
  type             submittal_type NOT NULL,
  title            TEXT NOT NULL,
  discipline       VARCHAR(10) NOT NULL,
  stage_no         SMALLINT REFERENCES lifecycle_stages(stage_no),
  revision         SMALLINT NOT NULL DEFAULT 0,
  required_by      DATE,                      -- item start minus lead time
  submitted_on     DATE,
  returned_on      DATE,
  status           review_code NOT NULL DEFAULT 'NOT_SUBMITTED',
  consultant_comments TEXT,
  file_key         TEXT,
  UNIQUE (project_id, doc_no, revision)
);
CREATE TABLE submittal_boq_items (
  submittal_id UUID REFERENCES submittals(id) ON DELETE CASCADE,
  boq_item_id  UUID REFERENCES boq_items(id) ON DELETE CASCADE,
  PRIMARY KEY (submittal_id, boq_item_id)
);

CREATE TABLE inspection_requests (             -- WIR (work) and MIR (material)
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          CHAR(3) NOT NULL CHECK (kind IN ('WIR','MIR')),
  ref_no        VARCHAR(30) NOT NULL,
  boq_item_id   UUID REFERENCES boq_items(id),
  itp_id        UUID REFERENCES submittals(id),
  location      TEXT,                         -- e.g. "Level 3 slab, Zone B"
  requested_for TIMESTAMPTZ,
  result        TEXT CHECK (result IN ('PENDING','APPROVED','APPROVED_AS_NOTED','REJECTED')),
  UNIQUE (project_id, ref_no)
);

CREATE TABLE authority_permits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  authority       TEXT NOT NULL,              -- DM, DDA, Trakhees, DEWA, RTA, DCD, Etisalat/du
  permit_name     TEXT NOT NULL,
  needed_before_stage SMALLINT REFERENCES lifecycle_stages(stage_no),
  trigger_boq_item_id UUID REFERENCES boq_items(id), -- why it was generated (substation, dewatering ...)
  sla_days        SMALLINT,
  required_by     DATE,
  submitted_on    DATE,
  approved_on     DATE,
  expiry_date     DATE,
  reference_no    TEXT,
  status          TEXT NOT NULL CHECK (status IN ('NOT_STARTED','PREPARING','SUBMITTED','COMMENTS','APPROVED','REJECTED','EXPIRED'))
);

CREATE TABLE procurement_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id     UUID REFERENCES boq_items(id),
  supplier        TEXT,
  po_no           TEXT,
  po_date         DATE,
  lead_time_weeks SMALLINT,
  required_on_site DATE,
  expected_delivery DATE,
  status          TEXT CHECK (status IN ('RFQ','MAR_PENDING','PO_ISSUED','MANUFACTURING','SHIPPED','DELIVERED'))
);

-- ───────────────────────── Field logs ─────────────────────────
CREATE TABLE daily_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL,
  weather        TEXT, temp_max_c NUMERIC(4,1), humidity_pct SMALLINT, wind_kmh SMALLINT,
  midday_break_applies BOOLEAN NOT NULL DEFAULT false,  -- 15 Jun–15 Sep
  hse_incidents  SMALLINT DEFAULT 0, near_misses SMALLINT DEFAULT 0, toolbox_talks SMALLINT DEFAULT 0,
  blockers       TEXT,
  submitted_by   UUID REFERENCES users(id),
  submitted_at   TIMESTAMPTZ,
  client_uuid    UUID UNIQUE,                 -- offline-sync idempotency key
  UNIQUE (project_id, log_date)
);
CREATE TABLE log_manpower  (log_id UUID REFERENCES daily_logs(id) ON DELETE CASCADE, trade TEXT, headcount SMALLINT, hours NUMERIC(5,1), PRIMARY KEY (log_id, trade));
CREATE TABLE log_equipment (log_id UUID REFERENCES daily_logs(id) ON DELETE CASCADE, equipment TEXT, units SMALLINT, hours NUMERIC(5,1), PRIMARY KEY (log_id, equipment));
CREATE TABLE log_quantities (
  log_id       UUID REFERENCES daily_logs(id) ON DELETE CASCADE,
  boq_item_id  UUID REFERENCES boq_items(id),
  location     TEXT,
  qty          NUMERIC(16,3) NOT NULL,
  actual_cost  NUMERIC(16,2),
  PRIMARY KEY (log_id, boq_item_id, location)
);
CREATE TABLE log_concrete_pours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID REFERENCES daily_logs(id) ON DELETE CASCADE,
  element TEXT, grade TEXT, volume_m3 NUMERIC(8,2), supplier TEXT, cubes_taken SMALLINT
);
CREATE TABLE site_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_id UUID REFERENCES daily_logs(id) ON DELETE SET NULL,
  boq_item_id UUID REFERENCES boq_items(id),
  file_key TEXT NOT NULL, caption TEXT, taken_at TIMESTAMPTZ, gps POINT
);

CREATE TABLE ncrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ncr_no VARCHAR(20) NOT NULL, title TEXT NOT NULL, boq_item_id UUID REFERENCES boq_items(id),
  raised_on DATE NOT NULL, closed_on DATE, severity TEXT, status TEXT NOT NULL
);
CREATE TABLE risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, owner TEXT, probability SMALLINT CHECK (probability BETWEEN 1 AND 5),
  impact SMALLINT CHECK (impact BETWEEN 1 AND 5), mitigation TEXT, status TEXT
);

-- ───────────────────────── Primavera P6 planning module ─────────────────────────
CREATE TABLE calendars (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = global template
  name             TEXT NOT NULL,                  -- e.g. "UAE 6-day week + public holidays"
  off_days         SMALLINT[] NOT NULL DEFAULT '{5}', -- 0=Sun … 6=Sat; Friday off by default
  hours_per_day    NUMERIC(4,1) NOT NULL DEFAULT 9,
  apply_public_holidays BOOLEAN NOT NULL DEFAULT true,
  summer_midday_break   BOOLEAN NOT NULL DEFAULT true,  -- 15 Jun–15 Sep, 12:30–15:00
  summer_factor    NUMERIC(4,3) NOT NULL DEFAULT 0.85,   -- outdoor capacity per day in summer
  ramadan_reduced_hours BOOLEAN NOT NULL DEFAULT true,
  ramadan_factor   NUMERIC(4,3) NOT NULL DEFAULT 0.80,
  p6_clndr_id      INT                              -- id used in XER CALENDAR table
);
CREATE TABLE calendar_exceptions (
  calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
  exc_date    DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('PUBLIC_HOLIDAY','RAMADAN','SUMMER','SITE_SHUTDOWN','EXTRA_WORKDAY')),
  label       TEXT,                                -- "Eid al-Fitr (estimated)"
  capacity    NUMERIC(4,3) NOT NULL DEFAULT 0,     -- 0 = non-working; 0.8 = reduced hours
  PRIMARY KEY (calendar_id, exc_date, kind)
);

CREATE TABLE productivity_norms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = company library
  code         VARCHAR(30) NOT NULL,               -- e.g. BLOCK, TILE, PILE
  label        TEXT NOT NULL,
  match_regex  TEXT NOT NULL,                      -- matched against BOQ description
  unit         VARCHAR(12) NOT NULL,
  output_per_day NUMERIC(12,4) NOT NULL,           -- unit/day for one crew set
  crews        SMALLINT NOT NULL DEFAULT 1,
  is_outdoor   BOOLEAN NOT NULL DEFAULT false,     -- applies summer factor
  UNIQUE (project_id, code)
);
CREATE TABLE schedule_parameters (
  project_id      UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  typical_floors  SMALLINT NOT NULL DEFAULT 4,
  floor_cycle_days SMALLINT NOT NULL DEFAULT 15,
  roof_cycle_days  SMALLINT NOT NULL DEFAULT 12,
  fixed_durations JSONB NOT NULL DEFAULT '{}',     -- lump-sum packages without a norm
  logic_template  JSONB                            -- FS/SS/FF rules + lags per work-type pair
);

CREATE TYPE schedule_kind AS ENUM ('BASELINE','CURRENT','RECOVERY','WHAT_IF','P6_IMPORT');
CREATE TABLE schedule_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           schedule_kind NOT NULL,
  name           TEXT NOT NULL,                    -- "Baseline Rev 0", "Update Nov-26", "Recovery Rev A"
  data_date      DATE NOT NULL,
  calendar_id    UUID REFERENCES calendars(id),
  must_finish_by DATE,                             -- contract completion
  forecast_finish DATE,
  min_total_float_days INT,
  spi            NUMERIC(6,3),
  is_active_baseline BOOLEAN NOT NULL DEFAULT false,
  source_file_key TEXT,                            -- .xer/.xml for P6 imports
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_baseline ON schedule_versions (project_id) WHERE is_active_baseline;

CREATE TYPE activity_type AS ENUM ('TT_Task','TT_Mile','TT_FinMile','TT_LOE','TT_WBS');
CREATE TYPE activity_status AS ENUM ('TK_NotStart','TK_Active','TK_Complete');
CREATE TABLE activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      UUID NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wbs_node_id     UUID REFERENCES wbs_nodes(id),
  activity_code   VARCHAR(30) NOT NULL,            -- P6 Activity ID, e.g. SS1030
  name            TEXT NOT NULL,
  type            activity_type NOT NULL DEFAULT 'TT_Task',
  stage_no        SMALLINT REFERENCES lifecycle_stages(stage_no),
  location        TEXT,                            -- floor / zone for floor-wise activities
  calendar_class  TEXT NOT NULL DEFAULT 'INDOOR' CHECK (calendar_class IN ('INDOOR','OUTDOOR')),
  original_duration  NUMERIC(8,2) NOT NULL,        -- working days
  remaining_duration NUMERIC(8,2) NOT NULL,
  duration_basis  TEXT,                            -- "11,200 m2 ÷ 95 m2/day → 5 floors"
  norm_id         UUID REFERENCES productivity_norms(id),
  physical_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  status          activity_status NOT NULL DEFAULT 'TK_NotStart',
  early_start DATE, early_finish DATE, late_start DATE, late_finish DATE,
  actual_start DATE, actual_finish DATE,
  baseline_start DATE, baseline_finish DATE,       -- copied from the active baseline for variance
  total_float_days  INT,
  free_float_days   INT,
  start_variance_days  INT,
  finish_variance_days INT,
  is_critical     BOOLEAN NOT NULL DEFAULT false,
  on_longest_path BOOLEAN NOT NULL DEFAULT false,
  constraint_type TEXT,                            -- CS_MSO, CS_MEO, CS_SNET…
  constraint_date DATE,
  p6_task_id      BIGINT,                          -- task_id from XER for round-trip
  UNIQUE (version_id, activity_code)
);
CREATE INDEX activities_critical ON activities (version_id) WHERE is_critical;

CREATE TABLE activity_relationships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    UUID NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
  pred_activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  succ_activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  rel_type      CHAR(2) NOT NULL CHECK (rel_type IN ('FS','SS','FF','SF')),
  lag_days      NUMERIC(6,2) NOT NULL DEFAULT 0,
  is_driving    BOOLEAN,
  UNIQUE (version_id, pred_activity_id, succ_activity_id, rel_type)
);

CREATE TABLE activity_boq_items (               -- which BOQ quantity each activity installs
  activity_id  UUID REFERENCES activities(id) ON DELETE CASCADE,
  boq_item_id  UUID REFERENCES boq_items(id) ON DELETE CASCADE,
  qty_share    NUMERIC(6,5) NOT NULL,           -- e.g. 0.2 of the item per floor
  PRIMARY KEY (activity_id, boq_item_id)
);

CREATE TABLE recovery_triggers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    UUID NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
  activity_id   UUID REFERENCES activities(id),
  rule          TEXT NOT NULL,                  -- CONTRACT_DATE_EXCEEDED, SPI_BELOW_0_90, CRITICAL_FV_GT_15 …
  severity      TEXT NOT NULL CHECK (severity IN ('WATCH','CRITICAL')),
  detail        TEXT,
  raised_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);

CREATE TABLE p6_exchange_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('EXPORT','IMPORT')),
  format        TEXT NOT NULL CHECK (format IN ('XER','XML','CSV','XLSX')),
  version_id    UUID REFERENCES schedule_versions(id),
  file_key      TEXT NOT NULL,
  p6_version    TEXT,                           -- ERMHDR version, e.g. 19.12
  activities_matched INT, activities_unmatched INT, dates_changed INT,
  performed_by  UUID REFERENCES users(id),
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Generated reports ─────────────────────────
CREATE TABLE generated_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_type   TEXT NOT NULL CHECK (report_type IN ('DPR','WPR','MPR')),
  schedule_version_id UUID REFERENCES schedule_versions(id),   -- P6 update the report used
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  data_snapshot JSONB NOT NULL,               -- frozen figures used to render
  pdf_key       TEXT, xlsx_key TEXT,
  revision      SMALLINT NOT NULL DEFAULT 0,
  generated_by  UUID REFERENCES users(id),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, report_type, period_end, revision)
);

-- Audit log for every write
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY, project_id UUID, table_name TEXT, row_id UUID,
  action TEXT, before JSONB, after JSONB, actor UUID, at TIMESTAMPTZ DEFAULT now()
);

-- Convenience view: quantity & cost tracker per item
CREATE VIEW v_item_tracker AS
SELECT b.project_id, b.id AS boq_item_id, b.item_ref, b.description, b.unit, b.stage_no,
       b.quantity AS budget_qty,
       COALESCE(SUM(q.qty),0) AS executed_qty,
       b.quantity - COALESCE(SUM(q.qty),0) AS remaining_qty,
       b.amount AS budget_amount,
       round(COALESCE(SUM(q.qty),0) * b.rate, 2) AS earned_value,
       COALESCE(SUM(q.actual_cost),0) AS actual_cost
FROM boq_items b
LEFT JOIN log_quantities q ON q.boq_item_id = b.id
GROUP BY b.id;

-- RLS example
ALTER TABLE boq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY boq_items_member ON boq_items
  USING (project_id IN (SELECT project_id FROM project_members WHERE user_id = current_setting('app.user_id')::uuid));
