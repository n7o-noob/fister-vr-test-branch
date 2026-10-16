const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8775, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8775/game2.html');
  await page.waitForFunction(() => window.game && window.game.frames > 10);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => window.fisterVR && fisterVR.state.renderers.size > 0);
  const out = await page.evaluate(async () => {
    const vr = fisterVR, s = vr.state, I = vr._internals, g = window.game, T = window.THREE_REF;
    const r = g.renderer;
    const xrRT = new T.WebGLRenderTarget(64, 64); r.setRenderTarget(xrRT);
    s.renderer = r; s.gameCamera = g.camera; s.presenting = true; r.xr.isPresenting = true; s.redirectRaf = true;
    s.pendingRecenter = false; I.spoofFocus(true);
    const pad = (hand) => ({ handedness: hand, gamepad: { buttons: [0, 1, 2, 3, 4, 5].map(() => ({ pressed: false })), axes: [0, 0, 0, 0] } });
    const frame = () => ({ session: { inputSources: [pad('right'), pad('left')] } });
    let t = performance.now();
    const step = async (n = 1) => { for (let i = 0; i < n; i++) { I.xrFrame(r, (t += 16), frame()); await new Promise(res => setTimeout(res, 0)); } };
    await new Promise(res2 => setTimeout(res2, 150)); await step(40);
    const me = g.players.get('me'), bot = g.players.get('bot');
    const head = me.head.getWorldPosition(new T.Vector3());
    const rigPos = s.rig.getWorldPosition(new T.Vector3());
    const res = {
      noUiPanel: !('hud' in s) && !s.hud,
      eyesAboveHeadBy: +(rigPos.y - head.y).toFixed(3),
      ownOutlineHidden: me.outline.visible === false,
      otherPlayerOutlineKept: bot.outline.visible === true,
    };
    // Late clear: the game clears the screen after drawing. The headset view must survive.
    const readPixel = () => { const px = new Uint8Array(4); r.readRenderTargetPixels(xrRT, 32, 32, 1, 1, px); return Array.from(px); };
    g.lateClear = true; await step(3);
    res.lateClear = { blocked: s.blockedClears > 0, centerPixelNotCleared: readPixel().join(',') !== '0,0,0,0' };
    g.lateClear = false;
    // A one-frame NaN head position must not move the view.
    const before = s.rig.position.clone();
    g.glitchNext = true; await step(1);
    res.glitch = { viewHeldStill: s.rig.position.distanceTo(before) < 1e-6 && Number.isFinite(s.rig.position.x), glitchesCounted: s.glitches };
    await step(3);
    res.recovered = Number.isFinite(s.rig.position.x) && +s.rig.getWorldPosition(new T.Vector3()).distanceTo(me.head.getWorldPosition(new T.Vector3())).toFixed(3);
    res.summary = vr._internals.liveSummary();
    return res;
  });
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
