// fister.fun-like Content-Security-Policy that blocks inline scripts (the Quest log on 0.9.3: FisterQoL never started
// in the frame). The home page allows only its own files and its own inline script (by hash); static files have no
// policy. Variants: policy as an HTTP header, or as a <meta> tag in the page. The bookmarklet code is run the way a
// bookmark runs it (not subject to the page's policy).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const site = path.join(__dirname, 'site');
const code = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr-qol.bookmarklet.txt'), 'utf8').slice(11));
const page3 = fs.readFileSync(path.join(site, 'game3.html'), 'utf8');
const inline = page3.slice(page3.indexOf('<script type="module">') + '<script type="module">'.length, page3.indexOf('</script>', page3.indexOf('<script type="module">')));
const policy = "script-src 'self' 'sha256-" + crypto.createHash('sha256').update(inline).digest('base64') + "'; object-src 'none'";
let variant = 'header';
const server = http.createServer((req, res) => { let u = req.url.split('?')[0];
  if (u === '/') {
    const headers = { 'Content-Type': 'text/html' };
    let html = page3;
    if (variant === 'header') headers['Content-Security-Policy'] = policy;
    else html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '">');
    res.writeHead(200, headers); return res.end(html);
  }
  if (u === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\n'); }
  const f = path.join(site, u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8798, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP fister.fun 127.0.0.1:8798'] });
  const out = {};
  for (const v of ['header', 'meta']) {
    variant = v;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [], alerts = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { alerts.push(d.message()); d.dismiss(); });
    await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
    await page.goto('http://fister.fun/');
    await page.waitForFunction(() => window.game && window.game.frames > 20);
    const inlineBlockedOnPage = await page.evaluate(() => { window.__probe = 0; const s = document.createElement('script'); s.textContent = 'window.__probe=1'; document.head.appendChild(s); return window.__probe === 0; });
    await page.evaluate(code); // like a bookmark: runs regardless of the page's policy
    await page.waitForTimeout(7000);
    out[v] = await page.evaluate(() => { const f = document.getElementById('fister-qol-frame'); let w = null; try { w = f && f.contentWindow; void w.location.href; } catch { w = null; }
      return { qolInFrame: !!(w && w.__fisterQolBrowserLoading), fisterVR: !!(w && w.fisterVR), gameRunning: !!(w && w.game && w.game.frames > 0), frameUrl: w && w.location.href, stopped: !!window.__fisterQolStopped, log: (window.__fisterQolLog || []).map(l => l.slice(9, 200)) }; });
    out[v].inlineBlockedOnPage = inlineBlockedOnPage; out[v].alerts = alerts; out[v].errors = errors;
    if (out[v].qolInFrame) { const fr = page.frames().find(f => f !== page.mainFrame()); await fr.evaluate(() => fisterVR.toggle()); await page.waitForTimeout(1200); out[v].vr = await fr.evaluate(() => fisterVR.presenting); }
    await page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
