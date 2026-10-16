// Normal path through a real three.js XR session (fake device): bookmark tapped mid-match, then Enter VR.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8782, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8782/game3.html?lock');
  await page.waitForFunction(() => window.game && window.game.frames > 20);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && document.getElementById('fister-vr-button').textContent === 'ENTER VR');
  await page.evaluate(() => document.getElementById('fister-vr-button').click());
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => ({ frames: window.game.frames, xr: __xrMock.frames }));
  await page.waitForTimeout(1000);
  const res = await page.evaluate((a) => {
    const s = fisterVR.state, r = window.game.renderer;
    return { menuOnlyUsed: !!s.standalone, threeIsPresenting: r.xr.isPresenting, gameFramesPerSecond: window.game.frames - a.frames, xrFramesPerSecond: __xrMock.frames - a.xr,
      inGameplay: s.gameplay, menuPanel: !!s.menu, controllersConnected: s.controllers.filter(c => c.source).length,
      problems: fisterVR._internals.logBuffer.filter(e => /error|warn/.test(e.level) && !/first-person toggle/.test(e.msg)).map(e => e.msg.slice(0, 120)) };
  }, a);
  // Point the right controller 40 degrees left and 10 up: the game's own aim should follow.
  await page.evaluate(() => { const yaw = 40 * Math.PI / 180, pitch = 10 * Math.PI / 180; __xrMock.setRay('right', [0.2, 1.2, -0.3], [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]); });
  await page.waitForTimeout(1500);
  res.aim = await page.evaluate(() => ({ gameYawDeg: +(game.yaw * 180 / Math.PI).toFixed(1), gamePitchDeg: +(game.pitch * 180 / Math.PI).toFixed(1), summary: fisterVR._internals.liveSummary().find(l => l.startsWith('Aim')) }));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
