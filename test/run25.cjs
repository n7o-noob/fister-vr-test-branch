// Reload loops with the FisterQoL bookmarklet (0.9.3). The stand-in home page is given a behaviour per case:
//   redirect: adds ?x=1 to its URL once (the rebuilt frame must keep it, not redirect forever)
//   reloader: reloads itself whenever FisterQoL is in it (the loader must give up after 3 and keep the game running)
//   away:     goes to another page (/other.html): no FisterQoL there, and no rebuilding
//   sw:       registers a service-worker controllerchange reload (must be ignored in the frame)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const site = path.join(__dirname, 'site');
const bm = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr-qol.bookmarklet.txt'), 'utf8');
let mode = 'none', homeHits = 0;
const behaviour = {
  none: '',
  redirect: "if(!new URL(location.href).searchParams.has('x')&&window.__fisterQolBrowserLoading)location.replace('/?lock&x=1');",
  reloader: "if(window.__fisterQolBrowserLoading)setTimeout(function(){location.reload();},400);",
  away: "if(window.__fisterQolBrowserLoading&&!sessionStorage.getItem('went'))setTimeout(function(){sessionStorage.setItem('went','1');location.href='/other.html';},300);",
  reloadOnce: "if(window.__fisterQolBrowserLoading&&!sessionStorage.getItem('r1'))setTimeout(function(){sessionStorage.setItem('r1','1');location.reload();},300);",
  sw: "navigator.serviceWorker&&navigator.serviceWorker.addEventListener('controllerchange',function(){location.reload();});window.__swListenerAdded=true;",
};
const server = http.createServer((req, res) => { let u = req.url.split('?')[0];
  if (u === '/') { homeHits++; const html = fs.readFileSync(path.join(site, 'game3.html'), 'utf8').replace('</body>', '<script>' + behaviour[mode] + '</script></body>'); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
  if (u === '/other.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>other</title><p>another page</p>'); }
  const f = path.join(site, u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8797, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP fister.fun 127.0.0.1:8797'] });
  const run = async (m, waitMs) => {
    mode = 'none'; homeHits = 0;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [], alerts = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { alerts.push(d.message()); d.dismiss(); });
    await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
    await page.goto('http://fister.fun/?lock');
    await page.waitForFunction(() => window.game && window.game.frames > 20);
    mode = m; const hitsBefore = homeHits;
    await page.evaluate((c) => { location.href = c; }, bm).catch(() => {});
    await page.waitForTimeout(waitMs);
    const hitsMid = homeHits;
    await page.waitForTimeout(3000); // nothing more should happen
    const r = await page.evaluate(() => { const f = document.getElementById('fister-qol-frame'); let w = null; try { w = f.contentWindow; void w.location.href; } catch { w = null; }
      return { topUrl: location.pathname + location.search, frameUrl: w && (w.location.pathname + w.location.search), qolInFrame: !!(w && w.__fisterQolBrowserLoading), gameRunning: !!(w && w.game && w.game.frames > 0),
        swListener: !!(w && w.__swListenerAdded), stopped: !!window.__fisterQolStopped, banner: !!document.getElementById('fister-qol-stopped'), log: (window.__fisterQolLog || []).map(l => l.slice(9, 130)) }; });
    r.homeFetchesAfterTap = homeHits - hitsBefore; r.stillLoadingAfterSettling = homeHits !== hitsMid; r.alerts = alerts; r.errors = errors;
    if (m === 'reloader') await page.screenshot({ path: path.join(__dirname, 'reload-stopped.png') });
    await page.close(); return r;
  };
  const out = { redirect: await run('redirect', 6000), reloader: await run('reloader', 9000), away: await run('away', 6000), reloadOnce: await run('reloadOnce', 6000), sw: await run('sw', 5000) };
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
