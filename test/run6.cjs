const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8770, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const logs = []; page.on('console', m => { if (/Fister VR/.test(m.text())) logs.push(m.text()); });
  await page.goto('http://127.0.0.1:8770/game2.html?textured');
  await page.waitForFunction(() => window.game && window.game.frames > 10);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => window.fisterVR && fisterVR.state.renderers.size > 0);
  const out = await page.evaluate(async () => {
    const vr = fisterVR, s = vr.state, I = vr._internals, g = window.game, T = window.THREE_REF;
    const r = g.renderer;
    s.renderer = r; s.gameCamera = g.camera; s.presenting = true; r.xr.isPresenting = true; s.redirectRaf = true;
    s.pendingRecenter = false; I.spoofFocus(true);
    const pad = (hand, buttons = [], axes = [0, 0, 0, 0]) => ({ handedness: hand, gamepad: { buttons: [0, 1, 2, 3, 4, 5].map(i => ({ pressed: !!buttons[i] })), axes } });
    let right = pad('right'), left = pad('left');
    const frame = () => ({ session: { inputSources: [right, left] } });
    let t = performance.now();
    const step = async (n = 1) => { for (let i = 0; i < n; i++) { I.xrFrame(r, (t += 16), frame()); await new Promise(res => setTimeout(res, 0)); } };
    await new Promise(res2 => setTimeout(res2, 150)); await step(4);
    const [c0, c1] = s.controllers;
    c0.source = { handedness: 'right' }; c0.handedness = 'right';
    c1.source = { handedness: 'left' }; c1.handedness = 'left';
    c0.group.position.set(0.2, -0.2, -0.3); c1.group.position.set(-0.2, -0.2, -0.3);
    const res = {};
    // A. Vivecraft-style aim: right hand points 60 deg left, 10 deg up -> game's own yaw/pitch follow.
    c0.group.rotation.set(10 * Math.PI / 180, 60 * Math.PI / 180, 0, 'YXZ'); c0.group.updateMatrix(); c1.group.updateMatrix();
    s.rig.updateMatrixWorld(true);
    const rigYawBefore = s.rig.rotation.y;
    window.__mm = 0; document.addEventListener('mousemove', () => window.__mm++);
    await step(90);
    const qq = c0.group.getWorldQuaternion(new T.Quaternion()); const fw = new T.Vector3(0,0,-1).applyQuaternion(qq);
    res.debug2 = { fw: fw.toArray().map(v=>+v.toFixed(3)), groupRot: c0.group.rotation.toArray().slice(0,3).map(v=>+(+v).toFixed(3)), parentIsRig: c0.group.parent === s.rig, cfg: { aimDeadzoneDeg: vr.config.aimDeadzoneDeg, aimGain: vr.config.aimGain, aimPitch: vr.config.aimPitch, aimHand: vr.config.aimHand } };
    res.debug = { mousemoves: window.__mm, aimState: JSON.parse(JSON.stringify(s.aim)), uiHit: !!s.uiHit, hasEntry: !!s.controllers.find(c => c.source && c.handedness === 'right'), aimMode: vr.config.aimMode, paused: g.paused };
    res.aim = { gameYawDeg: +(g.yaw * 180 / Math.PI).toFixed(2), gamePitchDeg: +(g.pitch * 180 / Math.PI).toFixed(2),
      learnedRadPerPx: +s.aim.ratioX.toFixed(5), actualRadPerPx: -g.sens, viewYawUnchanged: Math.abs(s.rig.rotation.y - rigYawBefore) < 1e-9 };
    // B. Arms: shoulder stays put, arm points at controller.
    const me = g.players.get('me');
    const angle = (arm, ctrl) => { const sh = arm.localToWorld(new T.Vector3(0, 0, 0)), hd = arm.localToWorld(new T.Vector3(0, -0.6, 0)), cw = ctrl.getWorldPosition(new T.Vector3());
      return +(hd.sub(sh).angleTo(cw.sub(sh)) * 180 / Math.PI).toFixed(3); };
    res.arms = { gameRightArmFollowsLeftController: angle(me.rightArm, c1.group), gameLeftArmFollowsRightController: angle(me.leftArm, c0.group),
      rightShoulderLocal: me.rightArm.position.toArray().map(v => +v.toFixed(3)) };
    // D. Focus: hold W, then the page loses focus (what happens on Quest); input should come back by itself.
    left = pad('left', [], [0, 0, 0, -1]); await step(2);
    const before = g.keys.has('KeyW');
    window.dispatchEvent(new FocusEvent('blur'));
    const pausedAfterBlur = g.paused;
    await new Promise(r2 => setTimeout(r2, 120)); await step(2);
    res.focus = { wHeldBefore: before, pausedAfterBlur, pausedNow: g.paused, wHeldNow: g.keys.has('KeyW'), hasFocusSpoofed: document.hasFocus() };
    left = pad('left'); await step(2);
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  console.log(logs.join('\n')); console.log('errors', errors);
  await page.screenshot({ path: path.join(__dirname, 'game2.png') });
  await browser.close(); server.close();
});
