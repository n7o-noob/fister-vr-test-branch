const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8776, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8776/game3.html?lock&layer1');
  await page.waitForFunction(() => window.game && window.game.frames > 10 && window.game.ui);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => window.fisterVR && fisterVR.state.renderers.size > 0);
  const out = await page.evaluate(async () => {
    const vr = fisterVR, s = vr.state, I = vr._internals, g = window.game, T = window.THREE_REF;
    const r = g.renderer;
    r.setRenderTarget(new T.WebGLRenderTarget(64, 64));
    s.renderer = r; s.gameCamera = g.camera; s.presenting = true; r.xr.isPresenting = true; s.redirectRaf = true;
    s.pendingRecenter = false; I.spoofFocus(true); I.spoofPointerLock(true);
    const pad = (hand, buttons = [], axes = [0, 0, 0, 0]) => ({ handedness: hand, gamepad: { buttons: [0, 1, 2, 3, 4, 5].map(i => ({ pressed: !!buttons[i] })), axes } });
    let right = pad('right'), left = pad('left');
    const frame = () => ({ session: { inputSources: [right, left] } });
    let t = performance.now();
    const step = async (n = 1, wait = 0) => { for (let i = 0; i < n; i++) { I.xrFrame(r, (t += 16), frame()); await new Promise(res => setTimeout(res, wait)); } };
    await new Promise(res2 => setTimeout(res2, 150)); await step(5);
    const [c0, c1] = s.controllers;
    c0.source = { handedness: 'right' }; c0.handedness = 'right'; c1.source = { handedness: 'left' }; c1.handedness = 'left';
    c0.group.position.set(0.2, -0.2, -0.3); c1.group.position.set(-0.2, -0.2, -0.3); c1.group.updateMatrix();
    const aimAngles = (yawDeg, pitchDeg) => { c0.group.rotation.set(pitchDeg * Math.PI / 180, yawDeg * Math.PI / 180, 0, 'YXZ'); c0.group.updateMatrix(); };
    aimAngles(45, 10);
    await step(30, 2);
    const res = {};
    const m = s.menu;
    res.panel = { built: !!m, problem: s.menuProblem || null, draws: m && m.draws, elements: m && m.nodes, msPerDraw: m && +m.drawMs.toFixed(2) };
    const S0 = I.screenRect(); const px = (x, y) => Array.from(m.ctx.getImageData(Math.round(x * S0.k * m.canvas.width / S0.w), Math.round(y * S0.k * m.canvas.height / S0.h), 1, 1).data);
    res.painted = { healthTitleBlue: px(40, 22), stylePanelGrey: px(60, 58), emptyMiddle: px(640, 360) };
    // Is the panel drawn by a camera that only sees layer 1 (the layer-mismatch theory)?
    const shot = (visible) => { m.panel.visible = visible; const cam = s.view.clone(); s.view.getWorldPosition(cam.position); s.view.getWorldQuaternion(cam.quaternion); cam.layers.mask = g.camera.layers.mask; cam.aspect = 16 / 9; cam.updateProjectionMatrix();
      const rt = new T.WebGLRenderTarget(160, 90); const prev = r.getRenderTarget(); const xrOn = r.xr.enabled; r.xr.enabled = false; r.setRenderTarget(rt); r.__fisterVrOriginalRender.call(r, g.scene, cam); r.setRenderTarget(prev); r.xr.enabled = xrOn;
      const buf = new Uint8Array(160 * 90 * 4); r.readRenderTargetPixels(rt, 0, 0, 160, 90, buf); m.panel.visible = true; return buf; };
    const a = shot(false), b = shot(true); let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
    res.panelVisibleToLayer1Camera = diff > 50;
    res.controllerBoxOnCameraLayer = (c0.group.children.find(o => o.isMesh && /box/.test(o.name)).layers.mask & g.camera.layers.mask) !== 0;
    // Aim reaches a game that only accepts mouse look while the pointer is captured.
    res.aim = { gameYawDeg: +(g.yaw * 180 / Math.PI).toFixed(1), gamePitchDeg: +(g.pitch * 180 / Math.PI).toFixed(1), pointerLooksLocked: document.pointerLockElement === r.domElement };
    // Left Y = Escape -> pointer "released" -> the game's pause menu opens.
    left = pad('left', [0, 0, 0, 0, 0, true]); await step(2); left = pad('left'); await step(4, 30);
    res.pauseOpened = document.getElementById('pause').classList.contains('visible');
    const pointAt = async (el, fx = 0.5) => {
      const b2 = el.getBoundingClientRect();
      const S = I.screenRect(); const x = (b2.left + b2.width * fx - S.x) / S.w - 0.5, y = 0.5 - (b2.top + b2.height / 2 - S.y) / S.h;
      const world = m.panel.localToWorld(new T.Vector3(x, y, 0));
      const local = s.rig.worldToLocal(world.clone());
      const dir = local.sub(c0.group.position).normalize();
      c0.group.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), dir); c0.group.updateMatrix();
      await step(3, 5);
      return s.uiHit && s.uiHit.element;
    };
    const click = async () => { right = pad('right', [true]); await step(2); right = pad('right'); await step(2, 20); };
    const yawBefore = g.yaw;
    const hitSettings = await pointAt(document.getElementById('openSettings'));
    await click();
    res.menuClicks = { laserOnSettings: hitSettings && hitSettings.id, settingsOpened: g.ui.settingsOpened, aimFrozenOnMenu: g.yaw === yawBefore };
    await step(4, 30);
    // Slider: grab at 50%, drag to 90%.
    await pointAt(document.getElementById('vol'), 0.5); right = pad('right', [true]); await step(2);
    await pointAt(document.getElementById('vol'), 0.9); await step(2); right = pad('right'); await step(2);
    res.slider = g.ui.volume;
    await pointAt(document.getElementById('fpsbox')); await click();
    res.checkbox = g.ui.fps;
    await pointAt(document.getElementById('quality')); await click();
    res.dropdown = g.ui.quality;
    await pointAt(document.querySelector('#list div:nth-child(2)'));
    right = pad('right', [], [0, 0, 0, 1]); await step(10); right = pad('right'); await step(1);
    res.scrolled = document.getElementById('list').scrollTop;
    await pointAt(document.getElementById('closeSettings')); await click();
    await pointAt(document.getElementById('resume')); await click(); await step(3, 20);
    res.resume = { resumed: g.ui.resumed, pauseClosed: !document.getElementById('pause').classList.contains('visible') };
    // Aim works again after resuming.
    aimAngles(-20, 0); await step(60, 1);
    res.aimAfterResume = +(g.yaw * 180 / Math.PI).toFixed(1);
    res.summary = I.liveSummary().find(l => l.startsWith('Menu panel'));
    return res;
  });
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
