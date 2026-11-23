# SiteLedger UAE: BOQ-to-Execution construction controls

You upload a Bill of Quantities and the platform builds the rest of the project from it: the 16-stage UAE lifecycle WBS, a Primavera P6-style CPM programme, the budget with 5% VAT, the S-curve and cash flow, the submittal, WIR, NOC and procurement logs, and daily, weekly and monthly progress reports.

| Path | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | Tech stack, services, pipeline, EVM and IPC formulas, the P6 planning module, UAE rules, roadmap |
| `db/schema.sql` | PostgreSQL 16 schema covering projects, BOQ, WBS, budgets, cash flow, logs, submittals, NOCs, P6 calendars, norms, schedule versions, activities, relationships, exchange log and reports |
| `prototype/index.html` | A single-file interactive prototype (React 18 + htm, with libraries loaded from CDNs) |
| `prototype/src/engine.js` | Domain engine: BOQ parser, classifier, CPM, EVM, documents, XER/XML, report builders (pure JS, runs in Node) |
| `prototype/src/app.js`, `styles.css` | The prototype UI |
| `prototype/build.mjs` | Inlines `src/` into `index.html` (`node prototype/build.mjs`) |

The sample BOQ is illustrative (a G+4 residential building in Al Furjan, Dubai, roughly AED 46.7M). The demo progress history up to the data date is simulated.
