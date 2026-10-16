// Held power-up items follow the VR hand: a scythe placed from the game's arm animation, and a first-person
// weapon parented to the game camera (outside the scene). Both must sit at your right hand.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8785, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8785/game2.html?items' + (process.env.ANIMALL ? '&animall' : ''));
  await page.waitForFunction(() => window.game && window.game.frames > 10);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)('globalThis.__fisterVrConfigOverrides={"armMode":"hand","armScale":0.5,"boxScale":0.5};\n' + c), bm);
  await page.waitForFunction(() => window.fisterVR && fisterVR.state.renderers.size > 0);
  const out = await page.evaluate(async () => {
    const vr = fisterVR, s = vr.state, I = vr._internals, g = window.game, T = window.THREE_REF;
    const r = g.renderer;
    r.setRenderTarget(new T.WebGLRenderTarget(64, 64));
    s.renderer = r; s.gameCamera = g.camera; s.presenting = true; r.xr.isPresenting = true; s.redirectRaf = true;
    s.pendingRecenter = false; I.spoofFocus(true);
    const pad = (hand) => ({ handedness: hand, gamepad: { buttons: [0, 1, 2, 3, 4, 5].map(() => ({ pressed: false })), axes: [0, 0, 0, 0] } });
    const frame = () => ({ session: { inputSources: [pad('right'), pad('left')] } });
    let t = performance.now();
    const step = async (n = 1) => { for (let i = 0; i < n; i++) { I.xrFrame(r, (t += 16), frame()); await new Promise(res => setTimeout(res, 0)); } };
    await new Promise(res2 => setTimeout(res2, 150)); await step(5);
    const [c0, c1] = s.controllers;
    c0.source = { handedness: 'right' }; c0.handedness = 'right'; c1.source = { handedness: 'left' }; c1.handedness = 'left';
    c0.group.position.set(0.2, -0.2, -0.3); c0.group.updateMatrix(); c1.group.position.set(-0.2, -0.2, -0.3); c1.group.updateMatrix();
    await step(35);
    const me = g.players.get('me');
    const handEnd = (arm) => arm.localToWorld(arm.__fisterVrArm.hand.clone());
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await step(7);
      me.scytheMesh.updateMatrixWorld(true);
      const sp = me.scytheMesh.getWorldPosition(new T.Vector3());
      samples.push(+sp.distanceTo(handEnd(me.leftArm)).toFixed(4));
    }
    const fp = me.firstPersonWeaponRoot; fp.updateMatrixWorld(true);
    let top = fp; while (top.parent) top = top.parent;
    const res = { scytheToYourRightHand: samples,
      scytheScale: +me.scytheMesh.getWorldScale(new T.Vector3()).length().toFixed(3),
      fpWeaponInScene: top === g.scene, fpToRightHand: +fp.getWorldPosition(new T.Vector3()).distanceTo(handEnd(me.leftArm)).toFixed(4),
      log: I.logBuffer.filter(e => /Holding|error/.test(e.msg + e.level)).map(e => e.msg.slice(0, 100)) };
    // Leaving the body puts items back (fp weapon back on the camera).
    s.presenting = false; r.xr.isPresenting = false; I.xrFrame && null;
    return res;
  });
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
