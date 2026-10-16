const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8773, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8773/game2.html');
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
    const HIDDEN = 1 << 31;
    const layer = (o) => o.layers.mask === HIDDEN ? 'hidden' : 'shown';
    const res = { body: { torso: layer(me.torso), shirt: layer(me.shirt), leftLeg: layer(me.leftLeg), rightLeg: layer(me.rightLeg), shoe: layer(me.shoe),
      leftArm: layer(me.leftArm), rightArm: layer(me.rightArm), head: layer(me.head), armsVisibleFlag: me.leftArm.visible && me.rightArm.visible } };
    // Hand mode offset: right controller's hand should sit 0.15 forward and 0.06 inward of the controller.
    const expectRight = s.rig.localToWorld(new T.Vector3(0.2 - 0.06, -0.2, -0.3 - 0.15));
    const handEnd = (arm) => arm.localToWorld(arm.__fisterVrArm.hand.clone());
    res.hands = { rightHandError: +handEnd(me.leftArm).distanceTo(expectRight).toFixed(4),   // swapped: game leftArm = your right
      leftHandError: +handEnd(me.rightArm).distanceTo(s.rig.localToWorld(new T.Vector3(-0.2 + 0.06, -0.2, -0.45))).toFixed(4) };
    const mir = (arm) => { const i = arm.__fisterVrArm; const e = arm.matrixWorld.elements; const col = new T.Vector3(e[i.sideIndex * 4], e[i.sideIndex * 4 + 1], e[i.sideIndex * 4 + 2]).normalize();
      return { det: +arm.matrixWorld.determinant().toFixed(4), long: i.label, side: 'xyz'[i.sideIndex], sideUpDot: +Math.abs(col.y).toFixed(2) }; };
    res.mirror = { right: mir(me.leftArm), left: mir(me.rightArm) };
    res.size = { armLength: +handEnd(me.leftArm).distanceTo(me.leftArm.localToWorld(me.leftArm.__fisterVrArm.shoulder.clone())).toFixed(3), boxScale: c0.group.children.find(o => /box/.test(o.name)).scale.x };
    // Leaving VR puts everything back.
    r.xr.dispatchEvent({ type: 'sessionend' });
    res.afterExit = { armScaleRestored: me.leftArm.scale.x, torso: layer(me.torso), shirt: layer(me.shirt), leftLeg: layer(me.leftLeg) };
    return res;
  });
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
