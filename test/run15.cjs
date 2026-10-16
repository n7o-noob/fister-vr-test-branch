// Main menu that draws only a sky colour (no meshes) -> menu-only VR; clicks via WebXR select events; the panel and
// controller boxes appear once the game draws a real scene; timers keep working.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8783, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8783/game3.html?emptymenu&lock');
  await page.waitForFunction(() => window.game && window.game.ui);
  await page.evaluate(() => document.getElementById('pause').classList.add('visible'));
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && document.getElementById('fister-vr-button').textContent === 'ENTER VR');
  await page.evaluate(() => document.getElementById('fister-vr-button').click());
  await page.waitForTimeout(600);
  const res = {};
  res.onEmptyMenu = await page.evaluate(() => ({ menuOnly: !!fisterVR.state.standalone && !fisterVR.state.standalone.handedOff, panelDraws: fisterVR.state.standalone && fisterVR.state.standalone.menu.draws }));
  // Click Settings with the laser: the press arrives as a WebXR select event.
  await page.evaluate(() => {
    const b = document.getElementById('openSettings').getBoundingClientRect(), S = fisterVR._internals.screenRect(), w = fisterVR.config.screen.width, h = w * 1080 / 1920;
    const x = ((b.left + b.width / 2 - S.x) / S.w - 0.5) * w, y = (0.5 - (b.top + b.height / 2 - S.y) / S.h) * h;
    const target = [x, 1.6 - 0.15 + y, -fisterVR.config.screen.distance], o = [0.2, 1.2, -0.3];
    __xrMock.setRay('right', o, target.map((v, i) => v - o[i]));
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.__activationSeen = null; document.getElementById('openSettings').addEventListener('click', () => { window.__clickedInsideSelect = !!window.__inSelect; }, { once: true });
    __xrMock.session.addEventListener('selectstart', () => { window.__inSelect = true; queueMicrotask(() => { window.__inSelect = false; }); }, { capture: true }); });
  await page.evaluate(() => __xrMock.press('right', 0, true)); await page.waitForTimeout(80);
  await page.evaluate(() => __xrMock.press('right', 0, false)); await page.waitForTimeout(150);
  res.click = await page.evaluate(() => ({ settingsOpenedExactlyOnce: game.ui.settingsOpened === 1, count: game.ui.settingsOpened }));
  // Timers during VR.
  res.timers = await page.evaluate(() => new Promise((resolve) => {
    let once = 0, ticks = 0, cleared = 0;
    setTimeout(() => once++, 50);
    const keep = setTimeout(() => cleared++, 60); clearTimeout(keep);
    const iv = setInterval(() => ticks++, 100);
    setTimeout(() => { clearInterval(iv); resolve({ timeoutRanOnce: once === 1, clearedDidNotRun: cleared === 0, intervalTicksIn1s: ticks }); }, 1050);
  }));
  // The game starts drawing a real scene: hand-off, panel and controller boxes appear.
  await page.evaluate(() => { document.getElementById('pause').classList.remove('visible'); document.getElementById('settings').classList.remove('visible'); window.__started = true; });
  await page.waitForTimeout(1200);
  res.inMatch = await page.evaluate(() => { const s = fisterVR.state; return { handedOff: !s.standalone || s.standalone.handedOff, threeIsPresenting: game.renderer.xr.isPresenting,
    menuPanelBuilt: !!s.menu, controllerBoxes: s.controllers.filter(c => c.box).length, classes: { Mesh: !!(s.classes && s.classes.Mesh), Attribute: !!(s.classes && s.classes.Attribute) } }; });
  res.problems = await page.evaluate(() => fisterVR._internals.logBuffer.filter(e => /error/.test(e.level)).map(e => e.msg.slice(0, 140)));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
