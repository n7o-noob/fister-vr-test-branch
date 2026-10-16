// The game captures the mouse on document.body (not the canvas) and ignores input while a text box is focused.
// Enter VR from the main menu, leave a text box focused (as a menu click would), start the match: movement and
// hand aim must still reach the game. Also checks the debug console's Copy all report.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8784, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8784' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8784/game3.html?emptymenu&lock&lockbody');
  await page.waitForFunction(() => window.game && window.game.ui);
  // Before VR the player had captured the mouse on <body> (flat play).
  await page.evaluate(() => document.body.requestPointerLock && document.body.requestPointerLock().catch(() => {}));
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && document.getElementById('fister-vr-button').textContent === 'ENTER VR');
  await page.evaluate(() => document.getElementById('fister-vr-button').click());
  await page.waitForTimeout(500);
  const res = {};
  res.menuOnly = await page.evaluate(() => !!fisterVR.state.standalone && !fisterVR.state.standalone.handedOff);
  // A menu click leaves the name box focused; the game asks to capture the mouse on <body> when Play is pressed.
  await page.evaluate(() => { document.getElementById('pause').classList.add('visible'); document.getElementById('settings').classList.add('visible'); document.getElementById('name').focus(); window.__focusedBefore = document.activeElement.id; document.getElementById('settings').classList.remove('visible'); document.getElementById('pause').classList.remove('visible'); const chat = document.createElement('input'); chat.type = 'text'; chat.id = 'chat'; chat.style.cssText = 'position:fixed;bottom:4px;right:4px;'; document.body.appendChild(chat); chat.focus(); window.__focusedBefore = document.activeElement.id; document.body.requestPointerLock(); });
  await page.evaluate(() => { window.__started = true; });
  await page.waitForTimeout(1200);
  res.inMatch = await page.evaluate(() => ({ handedOff: !fisterVR.state.standalone || fisterVR.state.standalone.handedOff, gameplay: !!fisterVR.state.gameplay,
    lockReportedOnBody: document.pointerLockElement === document.body, focus: document.activeElement && document.activeElement.id }));
  // Left stick forward -> W reaches the game.
  await page.evaluate(() => __xrMock.setAxes('left', [0, 0, 0, -1]));
  await page.waitForTimeout(300);
  res.move = await page.evaluate(() => ({ gameHasW: game.keys.has('KeyW') }));
  await page.evaluate(() => __xrMock.setAxes('left', [0, 0, 0, 0]));
  // Point the right hand 60 degrees left: hand aim turns the game's yaw.
  const yaw0 = await page.evaluate(() => game.yaw);
  await page.evaluate(() => __xrMock.setRay('right', [0.2, 1.2, -0.3], [-Math.sin(1.05), -0.1, -Math.cos(1.05)]));
  await page.waitForTimeout(1500);
  res.aim = await page.evaluate((y0) => ({ yawChangedDeg: +((game.yaw - y0) * 180 / Math.PI).toFixed(1), notStuck: fisterVR.state.aim.stuck < 30, focusedBefore: window.__focusedBefore, paused: game.paused, uiHit: !!fisterVR.state.uiHit, lastDx: fisterVR.state.aim.lastDx, ctrls: fisterVR.state.controllers.map(c => ({ i: c.index, hand: c.handedness, src: !!c.source, inRig: !!(c.group && c.group.parent) })), lastYaw: fisterVR.state.aim.lastYaw, feat: fisterVR._internals.liveSummary().find(l => /Feature/.test(l)), summary: fisterVR._internals.liveSummary().filter(l => /^(Aim|Input|View)/.test(l)) }), yaw0);
  // Copy all from the console.
  res.copy = await page.evaluate(async () => {
    fisterVR.console();
    const btn = [...document.querySelectorAll('#fister-vr-info button')].find(b => b.textContent === 'Copy all');
    const top = document.getElementById('fister-vr-info').getBoundingClientRect().top;
    btn.click(); await new Promise(r => setTimeout(r, 200));
    const text = await navigator.clipboard.readText();
    return { consoleTopOnScreen: top >= 0, label: btn.textContent, hasInputLine: /Input: keys to/.test(text), realNewlines: !text.includes('\\n'), lines: text.split('\n').length,
      barButton: !!document.getElementById('fister-vr-copy-button') };
  });
  res.problems = await page.evaluate(() => fisterVR._internals.logBuffer.filter(e => /error/.test(e.level)).map(e => e.msg.slice(0, 140)));
  res.log = await page.evaluate(() => fisterVR._internals.logBuffer.filter(e => /text box|Handed/.test(e.msg)).map(e => e.msg.slice(0, 120)));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
