// Map loading: the game stops drawing and its old scene throws when drawn (disposed). The mod must stop repeating that
// view (no uncaught errors), keep the panel showing on its own, and resume when the game draws again. Then a lost WebGL
// context ends the VR session cleanly. Uses the layers mock like the Quest.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8805, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8805' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__xrMockLayers = true; });
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8805/game3.html?lock');
  await page.waitForFunction(() => window.game && window.game.ui);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && document.getElementById('fister-vr-button').textContent === 'ENTER VR');
  await page.evaluate(() => document.getElementById('fister-vr-button').click());
  await page.waitForTimeout(500);
  const res = {};
  await page.waitForTimeout(800);
  res.start = await page.evaluate(() => ({ gameplay: fisterVR.state.gameplay, presenting: fisterVR.state.presenting }));
  // "Loading": the game stops rendering, and its scene now throws when drawn (like a disposed material).
  await page.evaluate(() => {
    window.__paused = true;
    const orig = game.frame; game.frame = () => { if (window.__paused) { requestAnimationFrame(game.frame); return; } orig(); };
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const bad = new window.THREE_REF.Mesh(new window.THREE_REF.BoxGeometry(1, 1, 1), new window.THREE_REF.MeshBasicMaterial());
    bad.onBeforeRender = () => { throw new TypeError("Cannot read properties of undefined (reading 'value')"); };
    bad.frustumCulled = false; game.scene.add(bad); window.__bad = bad;
    window.__r0 = fisterVR.state.repeats || 0;
  });
  await page.waitForTimeout(1500);
  res.loading = await page.evaluate(() => ({ repeatsDuringLoading: (fisterVR.state.repeats || 0) - window.__r0, repeatErrors: fisterVR.state.repeatErrors || 0, panelOnlyFrames: fisterVR.state.panelOnlyFrames || 0,
    stillPresenting: fisterVR.state.presenting }));
  // Loading done: the new scene draws again.
  await page.evaluate(() => { game.scene.remove(window.__bad); window.__paused = false; });
  await page.waitForTimeout(800);
  res.resumed = await page.evaluate(() => ({ frameErrors: fisterVR._internals.logBuffer.filter(e => /error/.test(e.level)).map(e => e.level + ' ' + e.msg.slice(0, 220)), gameFrames: game.frames, gameplay: fisterVR.state.gameplay, rendersAgain: performance.now() - fisterVR.state.lastRealRenderAt < 200 }));
  // The GPU gives up: WebGL context lost.
  await page.evaluate(() => { const gl = game.renderer.getContext(); window.__lose = gl.getExtension('WEBGL_lose_context'); window.__lose && window.__lose.loseContext(); });
  await page.waitForTimeout(600);
  res.contextLost = await page.evaluate(() => ({ hadExtension: !!window.__lose, presentingAfter: fisterVR.state.presenting, sessionEnded: !!__xrMock.session.__ended,
    log: fisterVR._internals.logBuffer.filter(e => /context|Repeating/.test(e.msg)).map(e => e.msg.slice(0, 140)) }));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
