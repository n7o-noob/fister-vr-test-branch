const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const query = process.argv[2] || '?rebuild&third';
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8772, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8772/game2.html' + query);
  await page.waitForFunction(() => window.game && window.game.frames > 10);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => window.fisterVR && fisterVR.state.renderers.size > 0);
  const out = await page.evaluate(async () => {
    const vr = fisterVR, s = vr.state, I = vr._internals, g = window.game, T = window.THREE_REF;
    const r = g.renderer;
    r.setRenderTarget(new T.WebGLRenderTarget(64, 64));
    s.renderer = r; s.gameCamera = g.camera; s.presenting = true; r.xr.isPresenting = true; s.redirectRaf = true;
    s.pendingRecenter = false; I.spoofFocus(true);
    const pad = (hand, buttons = [], axes = [0, 0, 0, 0]) => ({ handedness: hand, gamepad: { buttons: [0, 1, 2, 3, 4, 5].map(i => ({ pressed: !!buttons[i] })), axes } });
    let right = pad('right'), left = pad('left');
    const frame = () => ({ session: { inputSources: [right, left] } });
    let t = performance.now();
    const step = async (n = 1, wait = 0) => { for (let i = 0; i < n; i++) { I.xrFrame(r, (t += 16), frame()); await new Promise(res => setTimeout(res, wait)); } };
    await new Promise(res2 => setTimeout(res2, 150)); await step(5);
    const [c0, c1] = s.controllers;
    c0.source = { handedness: 'right' }; c0.handedness = 'right'; c1.source = { handedness: 'left' }; c1.handedness = 'left';
    c0.group.position.set(0.2, -0.2, -0.3); c0.group.updateMatrix(); c1.group.position.set(-0.2, -0.2, -0.3); c1.group.updateMatrix();
    await step(10);
    const res = { start: { gameplay: s.gameplay, reason: s.gameplayReason } };
    // Walk forward; halfway the game rebuilds its player list.
    g.rebuildAt = g.frames + 60;
    left = pad('left', [], [0, 0, 0, -1]);
    await step(200);
    left = pad('left');
    const me = g.players.get('me');
    const head = me.head.getWorldPosition(new T.Vector3());
    res.afterWalkAndRebuild = { walkedUnits: +me.mesh.position.length().toFixed(1), gameplay: s.gameplay, reason: s.gameplayReason,
      eyesOnCurrentHead: +s.rig.getWorldPosition(new T.Vector3()).distanceTo(head).toFixed(3), usingFreshPlayer: vr._internals.localPlayer() === me,
      armsOnFreshPlayer: !!me.rightArm.__fisterVrArm };
    // A feature that throws must not stop the headset view.
    try {
      delete me.rightArm.__fisterVrArm; me.rightArm.traverse = () => { throw new Error('simulated arm crash'); };
      s.mainRendered = false; await step(5);
      res.isolation = { stillRendering: s.mainRendered, summary: vr._internals.liveSummary ? vr._internals.liveSummary().pop() : 'n/a' };
      delete me.rightArm.traverse;
    } catch (e) { res.isolation = { threw: String(e.message) }; delete me.rightArm.traverse; }
    // Open the console in VR: hold both grips ~1.2 s.
    vr._internals.toggleInfoPanel(); await step(3);
    const panel = document.getElementById('fister-vr-info');
    res.console = { opened: !!panel, summary: panel && panel.children[1].textContent.split('\n').slice(0, 7), lastLines: panel && [...panel.children[2].children].slice(-6).map(d => d.textContent.trim()) };
    // and it shows on the headset UI panel
    return res;
    await step(10, 20);
    const hud = s.hud, rect = panel.getBoundingClientRect();
    const px = hud.ctx.getImageData(Math.round((rect.left + 30) * hud.canvas.width / innerWidth), Math.round((rect.top + 30) * hud.canvas.height / innerHeight), 1, 1).data;
    res.console.visibleInHeadset = px[3] > 200;
    return res;
  });
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors);
  await page.screenshot({ path: path.join(__dirname, 'console.png') });
  await browser.close(); server.close();
});
