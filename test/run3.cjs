const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); });
}).listen(8767, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const logs = []; page.on('console', m => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  const late = process.argv[3] === 'late';
  if (!late) await page.addInitScript({ path: path.join(__dirname, '..', 'src', 'fister-vr.js') });
  await page.goto('http://127.0.0.1:8767/' + (process.argv[2] || ''));
  await page.waitForFunction(() => window.game && window.game.frames > 20, null, { timeout: 20000 });
  if (late) {
    const bm = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8');
    await page.evaluate((code) => { (0, eval)(code); }, decodeURIComponent(bm.slice('javascript:'.length)));
    await page.waitForFunction(() => window.fisterVR && window.fisterVR.state.renderers.size > 0, null, { timeout: 5000 });
  }
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const vr = window.fisterVR, s = vr.state, g = window.game;
    const out = {};
    out.renderersCaptured = s.renderers.size;
    out.xrEnabledOnGameRenderer = g.renderer.xr.enabled;
    out.refSpace = 'local';
    out.button = document.getElementById('fister-vr-button')?.textContent;
    const main = vr._internals.pickMain();
    out.pickedGameRenderer = main.renderer === g.renderer;
    out.pickedGameCamera = main.camera === g.camera;
    out.gameSceneIsGame = vr._internals.gameScene() === g; out.lateStandIn = !!vr.state.lateScene && vr.state.lateScene !== g; out.mapProbeRemoved = Map.prototype.get.toString().includes('native code'); out.cameraProbeRemoved = !Object.getOwnPropertyDescriptor(Object.prototype,'isArrayCamera');
    // Simulate an immersive session on the main renderer (no headset available here)
    s.renderer = g.renderer; s.gameCamera = g.camera; s.presenting = true; g.renderer.xr.isPresenting = true; (function tick(){ s.mainRendered = false; requestAnimationFrame(tick); })();
    return out;
  });
  await page.waitForTimeout(400);
  const dbg = await page.evaluate(() => { const g = window.game, s = window.fisterVR.state, T = window.THREE_REF; return { cam: g.camera.position.toArray(), head: g.players.get("me").head.getWorldPosition(new T.Vector3()).toArray(), rig: s.rig.position.toArray(), fp: g.cameraController.firstPersonEnabled, anchorIsCam: true }; }); console.log("DBG", JSON.stringify(dbg));
  const r2 = await page.evaluate(() => {
    const vr = window.fisterVR, s = vr.state, g = window.game, T = window.THREE_REF;
    const me = g.players.get('me');
    const head = me.head.getWorldPosition(new T.Vector3());
    const rig = s.rig.getWorldPosition(new T.Vector3());
    const camYaw = new T.Euler().setFromQuaternion(g.camera.quaternion, 'YXZ').y;
    return {
      firstPersonLockedOn: g.cameraController.firstPersonEnabled,
      fpLabel: s.fp && s.fp.label,
      rigInScene: s.rig.parent === g.scene,
      rigAtHeadDistance: +head.distanceTo(rig).toFixed(4),
      rigYawMatchesCamera: Math.abs(s.rig.rotation.y - camYaw) < 1e-6,
      headHidden: me.head.visible === false,
      shakeSuppressed: g.screenShakeIntensity === 0,
      controllers: s.controllers.length,
      boxes: s.controllers.map(c => !!c.box && c.box.geometry.attributes.position.count),
      classes: Object.fromEntries(Object.entries(s.classes).map(([k, v]) => [k, !!v])),
      framesStillRunning: g.frames,
    };
  });
  // End the fake session and check restore
  const r3 = await page.evaluate(() => {
    const s = window.fisterVR.state, g = window.game;
    g.renderer.xr.isPresenting = false;
    // call the same path as the real sessionend event
    g.renderer.xr.dispatchEvent({ type: 'sessionend' });
    return { presenting: s.presenting, fpRestored: g.cameraController.firstPersonEnabled === false, headRestored: g.players.get('me').head.visible, shakeRestored: g.screenShakeIntensity, rigRemoved: !s.rig.parent };
  });
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => window.game.frames);
  console.log(JSON.stringify({ r, r2, r3, framesAfterEnd: frames }, null, 1));
  console.log(logs.filter(l => /Fister VR|PAGEERROR|error/i.test(l)).join('\n'));
  await page.screenshot({ path: path.join(__dirname, 'shot.png') });
  await browser.close(); server.close();
});
