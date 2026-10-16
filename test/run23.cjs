// Setup page "Fister VR + FisterQoL" option: generate the bookmarklet and tap it LATE, on a game that is already
// running (stand-in fister.fun home page). The game must restart in a frame with FisterQoL, the old copy must stop,
// VR must work inside the frame, and a reload inside the frame must come back with FisterQoL.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const site = path.join(__dirname, 'site'), docs = path.join(__dirname, '..', 'docs');
const server = http.createServer((req, res) => { let u = req.url.split('?')[0]; let f;
  if (u === '/setup/') f = path.join(docs, 'index.html'); else { if (u === '/') u = '/game3.html'; f = path.join(site, u); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8794, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP fister.fun 127.0.0.1:8794'] });
  const out = {};
  const setup = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const perr = []; setup.on('pageerror', e => perr.push(e.message));
  await setup.goto('http://127.0.0.1:8794/setup/');
  // Test-branch: the page is behind a password gate. Unlock it, then the Copy button seals the bookmarklet.
  await setup.waitForSelector('#pw');
  await setup.fill('#pw', 'n7oiscool');
  await setup.click('button[type=submit]');
  await setup.waitForFunction(() => !!document.getElementById('copy'), null, { timeout: 15000 });
  await setup.selectOption('#bundle', 'qol');
  await setup.selectOption('#armScale', '0.75');
  // Sealing (Copy -> sealed self-decrypting bookmarklet) is covered end-to-end by seal-test over a secure origin.
  // Here the stand-in game runs over http, where crypto.subtle is absent, so test the QoL loader from the raw
  // pre-seal code the page exposes (window.__fvRawCode, set by build() when options change).
  out.page = await setup.evaluate(() => ({ size: document.getElementById('size').textContent, errors: [] }));
  out.page.errors = perr;
  const raw = await setup.evaluate(() => window.__fvRawCode);
  const bm = 'javascript:' + encodeURIComponent(raw);
  await setup.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [], alerts = [];
  // The sealed bookmarklet prompts for the password when it runs; accept it. Other dialogs are dismissed.
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { alerts.push(d.message()); if (d.type() === 'prompt') d.accept('n7oiscool'); else d.dismiss(); });
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://fister.fun/?lock'); // mapped to the local server
  // The game is already well under way (the "too late" case on 0.9.0).
  await page.waitForFunction(() => window.game && window.game.frames > 60);
  await page.evaluate(() => { window.__fisterRuntimeLoaded = true; const r = document.createElement('div'); r.id = 'runtime-ui-root'; r.dataset.loaded = '1'; document.body.append(r); });
  await page.evaluate((c) => { location.href = c; }, bm).catch(() => {});
  await page.waitForSelector('#fister-qol-frame', { timeout: 15000 });
  const frameOf = () => page.frames().filter(f => f !== page.mainFrame() && !f.isDetached()).pop();
  await page.waitForFunction(() => { const f = document.getElementById('fister-qol-frame'); try { return f.contentWindow.game && f.contentWindow.game.frames > 30; } catch { return false; } }, null, { timeout: 20000 });
  const topFramesA = await page.evaluate(() => window.game.frames);
  await page.waitForTimeout(800);
  out.top = await page.evaluate((a) => { const c = window.game.renderer.getContext(); return { oldGameFramesAfterFreeze: window.game.frames - a, oldContextLost: c.isContextLost(), bodyChildren: [...document.body.children].map(e => e.id || e.tagName), url: location.pathname }; }, topFramesA);
  let fr = frameOf();
  out.frame = await fr.evaluate(() => ({ url: location.href, qol: !!window.__fisterQolBrowserLoading, bootHook: typeof Object.getOwnPropertyDescriptor(window, '__fisterRuntimeBootPromise')?.get,
    fisterVR: window.fisterVR && fisterVR.version, armScale: window.fisterVR && fisterVR.config.armScale, gameFrames: window.game.frames, standards: document.compatMode }));
  await fr.evaluate(() => fisterVR.toggle()); await page.waitForTimeout(1500);
  out.frame.vr = await fr.evaluate(() => ({ presenting: fisterVR.presenting, gameplay: fisterVR.state.gameplay }));
  await fr.evaluate(() => fisterVR.toggle()); await page.waitForTimeout(400);
  // The game reloads itself inside the frame: FisterQoL must come back.
  await fr.evaluate(() => location.reload());
  await page.waitForFunction(() => window.__fisterQolLog.some(l => /restarting the frame/.test(l)), null, { timeout: 20000 });
  await page.waitForFunction(() => { const f = document.getElementById('fister-qol-frame'); try { return f.contentWindow.__fisterQolBrowserLoading && f.contentWindow.game && f.contentWindow.game.frames > 10; } catch { return false; } }, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  // Read the rebuilt frame from the page (its document is rewritten, which confuses frame handles).
  out.afterReload = await page.evaluate(() => { const w = document.getElementById('fister-qol-frame').contentWindow; return { qol: !!w.__fisterQolBrowserLoading, fisterVR: w.fisterVR && w.fisterVR.version, url: w.location.href, frames: [...document.querySelectorAll('iframe')].map(f => { let u = '?'; try { u = f.contentWindow.location.href + (f.contentWindow.__fisterQolBrowserLoading ? ' qol' : ''); } catch {} return (f.id || 'no-id') + ' ' + (f.parentNode && f.parentNode.tagName) + ' ' + u; }) }; });
  out.afterReload.frames = page.frames().length;
  // Tapping the bookmark again
  await page.evaluate((c) => { location.href = c; }, bm).catch(() => {}); await page.waitForTimeout(500);
  out.alerts = alerts; out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
