// Hand aim converges: the game's aim (from the head) passes through the spot the hand's ray points at, a line is drawn
// from the hand, and aiming can be switched to the left hand.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8786, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8786/game3.html?lock');
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
  // Where does the game's aim (camera forward from the head) pass relative to the hand's target point?
  const check = (hand) => page.evaluate((hand) => {
    const s = fisterVR.state, T = s.classes, cam = game.camera;
    const entry = s.controllers.find(c => c.source && c.handedness === hand);
    const o = entry.group.getWorldPosition(new T.Vector3()), q = entry.group.getWorldQuaternion(new T.Quaternion());
    const d = new T.Vector3(0, 0, -1).applyQuaternion(q);
    const target = o.clone().addScaledVector(d, s.aimDist * (s.rig.scale.x || 1));
    const head = game.players.get('me').mesh.localToWorld(new T.Vector3(0, 1, 0));
    const want = target.clone().sub(head).normalize();
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new T.Quaternion()));
    const laser = s.aimLaser;
    return { aimOffByDeg: +(Math.acos(Math.min(1, want.dot(fwd))) * 180 / Math.PI).toFixed(2), targetDist: +s.aimDist.toFixed(2), groundY: +target.y.toFixed(2),
      laserOnHand: (!!laser && laser.visible && laser.parent === entry.group) || (!!s.overlayOk && !!s.aimLineShown), laserLength: laser && +laser.scale.z.toFixed(2) };
  }, hand);
  // Right hand pointing 30 degrees left and down at the floor: the aim goes to where the ray meets the ground.
  await page.evaluate(() => { const yaw = 30 * Math.PI / 180, pitch = -25 * Math.PI / 180; __xrMock.setRay('right', [0.25, 1.2, -0.3], [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]); });
  await page.waitForTimeout(2000);
  res.rightAtFloor = await check('right');
  // Pointing level: the aim goes to the point 10 m out along the ray.
  await page.evaluate(() => { const yaw = -20 * Math.PI / 180; __xrMock.setRay('right', [0.25, 1.2, -0.3], [-Math.sin(yaw), 0.05, -Math.cos(yaw)]); });
  await page.waitForTimeout(2000);
  res.rightLevel = await check('right');
  // Left hand aim.
  await page.evaluate(() => { fisterVR.config.aimHand = 'left'; const yaw = 50 * Math.PI / 180; __xrMock.setRay('left', [-0.25, 1.2, -0.3], [-Math.sin(yaw), 0.05, -Math.cos(yaw)]); });
  await page.waitForTimeout(2000);
  res.left = await check('left');
  res.left.gameYawDeg = await page.evaluate(() => +(game.yaw * 180 / Math.PI).toFixed(1));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
