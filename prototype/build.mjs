// Inline src/ into a single self-contained index.html (no bundler needed).
import { readFileSync, writeFileSync } from 'node:fs';
const r = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const html = `<title>SiteLedger UAE</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="BOQ-to-execution construction project controls for UAE projects: BOQ parsing, 16-stage lifecycle, Primavera P6 CPM programme, EVM, submittals and NOCs, and DPR/WPR/MPR reports.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
${r('./src/styles.css')}
</style>
<div id="root"><div style="padding:40px;font-family:sans-serif;color:#6f7d88">Loading SiteLedger UAE…</div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/htm@3.1.1/dist/htm.umd.js"></script>
<script>
${safe(r('./src/engine.js'))}
</script>
<script>
${safe(r('./src/app.js'))}
</script>
`;
writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('index.html', (html.length / 1024).toFixed(1) + ' KB');
