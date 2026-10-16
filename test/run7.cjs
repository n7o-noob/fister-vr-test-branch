const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8771, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8771/game2.html');
  await page.waitForFunction(() => window.game && window.game.frames > 10);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => window.fisterVR && fisterVR.state.renderers.size > 0);
  const out = await page.evaluate(async () => {
    const vr = fisterVR, s = vr.state, I = vr._internals, g = window.game, T = window.THREE_REF;
    const r = g.renderer;
    // Stand-in for the headset's framebuffer: three renders into the XR render target during a session.
    r.setRenderTarget(new T.WebGLRenderTarget(64, 64));
    s.renderer = r; s.gameCamera = g.camera; s.presenting = true; r.xr.isPresenting = true; s.redirectRaf = true;
    s.pendingRecenter = false; I.spoofFocus(true);
    const pad = (hand, buttons = [], axes = [0, 0, 0, 0]) => ({ handedness: hand, gamepad: { buttons: [0, 1, 2, 3, 4, 5].map(i => ({ pressed: !!buttons[i] })), axes } });
    let right = pad('right'), left = pad('left');
    const frame = () => ({ session: { inputSources: [right, left] } });
    let t = performance.now();
    const step = async (n = 1) => { for (let i = 0; i < n; i++) { I.xrFrame(r, (t += 16), frame()); await new Promise(res => setTimeout(res, 0)); } };
    await new Promise(res2 => setTimeout(res2, 150)); await step(40);
    const res = {};
    res.flatColouredGame = { hasSceneTexture: !!(g.scene.background && g.scene.background.isTexture), uiPanel: 'removed' };
    res.outlines = { outlineHidden: g.powerupOutline.visible === false, powerupStillVisible: g.powerup.visible, avatarArmVisible: g.players.get('me').rightArm.visible, report: vr.dump().outlinesHidden };
    res.gameplay = { inGameplay: s.gameplay };
    // Between rounds / main menu: game switches scene and camera.
    g.mode = 'menu'; await step(10);
    const rigPos = s.rig.getWorldPosition(new T.Vector3()), menuPos = g.menuCamera.getWorldPosition(new T.Vector3());
    res.menu = { inGameplay: s.gameplay, sceneIsMenu: s.threeScene === g.menuScene, rigAtMenuCamera: +rigPos.distanceTo(menuPos).toFixed(4), rigInMenuScene: s.rig.parent === g.menuScene };
    g.mode = 'play'; await step(5);
    res.backToPlay = { inGameplay: s.gameplay, rigInGameScene: s.rig.parent === g.scene };
    // A button = V (voice chat), held.
    right = pad('right', [0, 0, 0, 0, true]); await step(2);
    const vHeld = g.keys.has('KeyV');
    right = pad('right'); await step(2);
    res.voiceKey = { heldWhilePressed: vHeld, releasedAfter: !g.keys.has('KeyV') };
    return res;
  });
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
