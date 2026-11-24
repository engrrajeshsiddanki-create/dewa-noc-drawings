// Inline src/ and the core UI libraries into one index.html. Export libraries in lib/ are
// published beside the page and loaded on demand (with a CDN fallback).
import { readFileSync, writeFileSync } from 'node:fs';
const r = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SiteLedger UAE</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
${r('./src/styles.css')}
#boot{padding:32px 20px;font-family:system-ui,sans-serif;color:#6f7d88;max-width:60ch}
#boot b{color:#c0392b;display:block;margin-bottom:6px}
</style>
<div id="root"><div id="boot">Loading SiteLedger UAE…</div></div>
<script>
(function(){
  function show(msg){ if (window.__slBooted) return; var el=document.getElementById('boot'); if(el){ el.innerHTML=''; var b=document.createElement('b'); b.textContent='SiteLedger UAE could not start.'; var s=document.createElement('span'); s.textContent=msg; el.appendChild(b); el.appendChild(s);} }
  window.addEventListener('error', function(e){ show((e && e.message ? e.message : 'A script error occurred') + '. Close and reopen the page; if it persists, send this message to Claude.'); });
  setTimeout(function(){ show('The page took too long to start. Check your connection, then close and reopen it.'); }, 15000);
})();
</script>
<script>
${safe(r('./lib/react.production.min.js'))}
</script>
<script>
${safe(r('./lib/react-dom.production.min.js'))}
</script>
<script>
${safe(r('./lib/htm.umd.js'))}
</script>
<script>
${safe(r('./src/engine.js'))}
</script>
<script>
${safe(r('./src/app.js'))}
</script>
`;
writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('index.html', (html.length / 1024).toFixed(1) + ' KB');
