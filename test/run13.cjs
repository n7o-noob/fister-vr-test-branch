// Menu-only VR before the game renders, clicking a menu item, then hand-off to the game renderer — all through a
// fake WebXR device so three.js's real XR code path runs.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8781, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8781/game3.html?norender&lock');
  await page.waitForFunction(() => window.game && window.game.ui);
  await page.evaluate(() => document.getElementById('pause').classList.add('visible')); // main menu showing, no 3D yet
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => document.getElementById('fister-vr-button') && document.getElementById('fister-vr-button').textContent === 'ENTER VR', null, { timeout: 5000 });
  const res = { buttonBeforeAnyRender: await page.textContent('#fister-vr-button'), renderersBefore: await page.evaluate(() => fisterVR.state.renderers.size) };
  await page.click('#fister-vr-button');
  await page.waitForTimeout(600);
  console.log('LOG', JSON.stringify(await page.evaluate(() => fisterVR._internals.logBuffer.map(e => e.level + ' ' + e.msg).slice(-12)), null, 1), 'sessions', await page.evaluate(() => __xrMock.sessions));
  res.menuOnly = await page.evaluate(() => {
    const sa = fisterVR.state.standalone;
    const gl = sa.g.gl; const px = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth / 4), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { active: !!sa && !sa.handedOff, frames: sa.frames, menuDraws: sa.menu.draws, button: document.getElementById('fister-vr-button').textContent, centerPixel: Array.from(px) };
  });
  // Aim the right controller at the Settings button on the panel and pull the trigger.
  await page.evaluate(() => {
    const b = document.getElementById('openSettings').getBoundingClientRect(), S = fisterVR._internals.screenRect(), w = fisterVR.config.screen.width, h = w * 1080 / 1920;
    const x = ((b.left + b.width / 2 - S.x) / S.w - 0.5) * w, y = (0.5 - (b.top + b.height / 2 - S.y) / S.h) * h;
    const target = [x, 1.6 - 0.15 + y, -fisterVR.config.screen.distance], o = [0.2, 1.2, -0.3];
    __xrMock.setRay('right', o, target.map((v, i) => v - o[i]));
  });
  await page.waitForTimeout(150);
  res.laser = await page.evaluate(() => fisterVR.state.uiHit && fisterVR.state.uiHit.element.id);
  await page.evaluate(() => __xrMock.press('right', 0, true)); await page.waitForTimeout(80);
  await page.evaluate(() => __xrMock.press('right', 0, false)); await page.waitForTimeout(150);
  res.settingsOpened = await page.evaluate(() => game.ui.settingsOpened);
  // Press Play: the game starts rendering -> the session moves to the game's renderer.
  await page.evaluate(() => { Error.stackTraceLimit = 80; const orig = window.game.renderer.__fisterVrOriginalRender || null; window.__overflow = null;
    const rr = window.game.renderer; const wrapped = rr.render; rr.render = function (s, c) { try { return wrapped.call(this, s, c); } catch (e) { if (!window.__overflow) window.__overflow = e.stack; throw e; } };
    const oe = window.onerror; window.addEventListener('error', (ev) => { if (!window.__overflow && ev.error) window.__overflow = ev.error.stack; }); });
  await page.evaluate(() => { document.getElementById('pause').classList.remove('visible'); document.getElementById('settings').classList.remove('visible'); window.__started = true; });
  await page.waitForTimeout(1500);
  res.afterGameStarts = await page.evaluate(() => {
    const s = fisterVR.state, r = window.game.renderer;
    return { handedOff: !s.standalone || s.standalone.handedOff, threeIsPresenting: r.xr.isPresenting, modPresenting: s.presenting, sameSession: r.xr.getSession() === __xrMock.session,
      gameFrames: window.game.frames, inGameplay: s.gameplay, menuPanel: !!s.menu, sessionsRequested: __xrMock.sessions, summary: fisterVR._internals.liveSummary().slice(0, 2) };
  });
  const f1 = await page.evaluate(() => window.game.frames); await page.waitForTimeout(500);
  res.overflow = await page.evaluate(() => window.__overflow && window.__overflow.split('\n').map(l => l.trim().replace(/\(http:\/\/127.0.0.1:8781\//, '(').replace(/eval at .*?<anonymous>\)?, /, '')).slice(-45));
  res.cycle = await page.evaluate(() => { const s = fisterVR.state; const named = (o) => (o === s.rig ? 'RIG' : o === s.view ? 'VIEW' : o === window.game.camera ? 'GAMECAM' : o === window.game.scene ? 'SCENE' : (o.name || o.type)); const out = []; const objs = [s.rig, s.view, window.game.camera, ...s.controllers.map(c => c.group)]; for (const o of objs) { if (!o) continue; const chain = []; let n = o, i = 0; while (n && i++ < 12) { chain.push(named(n)); n = n.parent; } out.push(chain.join(' > ')); } out.push('view children: ' + s.view.children.map(named).join(',')); out.push('cam children: ' + window.game.camera.children.map(named).join(',')); return out; });
  res.log = await page.evaluate(() => fisterVR._internals.logBuffer.filter(e => e.level !== 'info').map(e => e.level + ' ' + e.count + 'x ' + e.msg.slice(0, 120)));
  const m1 = await page.evaluate(() => __xrMock.frames);
  res.afterGameStarts.gameKeepsRunning = (await page.evaluate(() => window.game.frames)) > f1;
  res.afterGameStarts.xrFramesAdvancing = (await page.evaluate(() => __xrMock.frames)) > m1;
  res.afterGameStarts.queued = await page.evaluate(() => fisterVR.state.rafQueue.size);
  res.afterGameStarts.redirect = await page.evaluate(() => fisterVR.state.redirectRaf);
  await page.evaluate(() => document.getElementById('fister-vr-button').click()); await page.waitForTimeout(300);
  res.afterExit = await page.evaluate(() => ({ presenting: fisterVR.state.presenting, button: document.getElementById('fister-vr-button').textContent, threeIsPresenting: window.game.renderer.xr.isPresenting }));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
