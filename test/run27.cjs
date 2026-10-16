// Same as run19, but the fake headset offers WebXR Layers like the Quest Browser: three.js draws into a projection
// layer, and the mod's direct-drawn HUD panel and aim line must land in that layer's texture.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8799, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__xrMockLayers = true; });
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8799/game3.html?lock&third');
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
  // A wall 6 m ahead (to the left), like the arena's gray blocks.
  await page.evaluate(() => { const T = window.THREE_REF; const wall = new T.Mesh(new T.BoxGeometry(4, 3, 0.5), new T.MeshStandardMaterial({ color: 0x999999 })); wall.position.set(-2, 1.5, -6); wall.updateMatrixWorld(); game.scene.add(wall); fisterVR.state.rayCache && (fisterVR.state.rayCache.at = 0); });
  const check = () => page.evaluate(() => {
    const s = fisterVR.state, T = s.classes, cam = game.camera;
    const entry = s.controllers.find(c => c.source && c.handedness === 'right');
    const o = entry.group.getWorldPosition(new T.Vector3()), q = entry.group.getWorldQuaternion(new T.Quaternion());
    const d = new T.Vector3(0, 0, -1).applyQuaternion(q);
    const target = o.clone().addScaledVector(d, s.aimDist * (s.rig.scale.x || 1));
    const from = game.players.get('me').mesh.localToWorld(new T.Vector3(0, 1, 0));
    const want = target.clone().sub(from).normalize();
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new T.Quaternion()));
    return { crosshairOffByDeg: +(Math.acos(Math.min(1, want.dot(fwd))) * 180 / Math.PI).toFixed(2), targetDist: +s.aimDist.toFixed(2), target: [target.x, target.y, target.z].map(n => +n.toFixed(2)), camDistFromHead: +from.distanceTo(game.players.get('me').head.getWorldPosition(new T.Vector3())).toFixed(1) };
  });
  // Point at the wall.
  await page.evaluate(() => { const s = fisterVR.state; const e = s.controllers.find(c => c.handedness === 'right'); const o = e.group.getWorldPosition(new s.classes.Vector3()); const d = new s.classes.Vector3(-1.5, 1.5, -6).sub(o).normalize(); const inv = s.rig.matrixWorld.clone().invert(); const oL = o.clone().applyMatrix4(inv), dL = d.clone().transformDirection(inv); __xrMock.setRay('right', [oL.x, oL.y, oL.z], [dL.x, dL.y, dL.z]); });
  await page.waitForTimeout(2500);
  res.atWall = await check();
  // Point at open ground to the right.
  await page.evaluate(() => { const yaw = -25 * Math.PI / 180, pitch = -20 * Math.PI / 180; __xrMock.setRay('right', [0.25, 1.2, -0.3], [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]); });
  await page.waitForTimeout(2500);
  res.atGround = await check();
  // HUD: a full-screen gray container behind the canvas must not be painted in a match; the health box must be.
  res.hud = await page.evaluate(async () => {
    const bg = document.createElement('div'); bg.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:-1'; document.body.prepend(bg);
    const hp = document.createElement('div'); hp.textContent = 'HEALTH'; hp.style.cssText = 'position:fixed;left:10px;top:10px;width:160px;height:20px;background:#000080;color:#fff'; document.body.appendChild(hp);
    const bar = document.createElement('div'); bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:60px;display:flex;justify-content:space-between'; bar.innerHTML = '<span style="background:#800;color:#fff;padding:4px">AMMO 3</span><span style="background:#080;color:#fff;padding:4px">+17 STYLE</span>'; document.body.appendChild(bar);
    const m = fisterVR.state.menu; m.dirty = true; m.lastDraw = 0;
    await new Promise(r => setTimeout(r, 400));
    const ctx = m.canvas.getContext('2d'), sx = m.canvas.width / innerWidth;
    const px = (x, y) => [...ctx.getImageData(Math.round(x * sx), Math.round(y * sx), 1, 1).data];
    return { summary: fisterVR._internals.liveSummary().find(l => l.startsWith('Menu panel')), hudMode: fisterVR.state.gameplay && !fisterVR.state.pointerLockReleased, centerPixel: px(innerWidth / 2, innerHeight / 2), healthPixel: px(50, 20), laserOnHud: !!fisterVR.state.uiHit };
  });
  await page.evaluate(() => __xrMock.setRay('right', [0.25, 1.0, -0.3], [0, -0.3, -1]));
  await page.waitForTimeout(800);
  res.layer = await page.evaluate(() => ({ threeUsedProjectionLayer: !!window.__xrMock.projectionLayer, summary: fisterVR._internals.liveSummary().find(l => l.startsWith('Menu panel')) }));
  const img = await page.evaluate(() => __xrMock.layerImage());
  if (img) fs.writeFileSync(process.env.SHOT || '/tmp/layer.png', Buffer.from(img.split(',')[1], 'base64'));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
