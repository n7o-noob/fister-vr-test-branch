// X opens the emote wheel by holding E; the laser picks an emote; E is released; while emoting the view uses the game's
// third-person camera, then returns to first person. Also: mid-jump, a hand pointing a little down must not aim at the
// "floor" right under the hand.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8801, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8801' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8801/game3.html?lock');
  await page.waitForFunction(() => window.game && window.game.ui);
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && document.getElementById('fister-vr-button').textContent === 'ENTER VR');
  await page.evaluate(() => document.getElementById('fister-vr-button').click());
  await page.waitForTimeout(500);
  const res = {};
  await page.waitForTimeout(800);
  res.start = await page.evaluate(() => ({ gameplay: fisterVR.state.gameplay, hud: fisterVR._internals.liveSummary().find(l => l.startsWith('Menu panel')).includes('(HUD)') }));
  // Left X.
  await page.evaluate(() => __xrMock.press('left', 4, true)); await page.waitForTimeout(120);
  await page.evaluate(() => __xrMock.press('left', 4, false)); await page.waitForTimeout(400);
  res.wheelOpen = await page.evaluate(() => ({ eHeld: game.keys.has('KeyE') || fisterVR.state.keysDown.has('KeyE'), wheelShown: document.getElementById('emoteWheel').style.display === 'block',
    spaceNotSent: !fisterVR.state.keysDown.has('Space'), lockReleased: fisterVR.state.pointerLockReleased, summary: fisterVR._internals.liveSummary().find(l => l.startsWith('Aim')) }));
  // Point the laser at "Dance" and pull the trigger.
  await page.evaluate(() => {
    const b = document.querySelector('[data-emote=dance]').getBoundingClientRect(), S = fisterVR._internals.screenRect();
    const m = fisterVR.state.menu, panel = m.panel, T = fisterVR.state.classes;
    const x = (b.left + b.width / 2 - S.x) / S.w - 0.5, y = 0.5 - (b.top + b.height / 2 - S.y) / S.h;
    const world = panel.localToWorld(new T.Vector3(x, y, 0));
    const local = fisterVR.state.rig.worldToLocal(world.clone());
    const o = [0.2, 1.2, -0.3];
    __xrMock.setRay('right', o, [local.x - o[0], local.y - o[1], local.z - o[2]]);
  });
  await page.waitForTimeout(300);
  res.laserOn = await page.evaluate(() => { const h = fisterVR.state.uiHit; const b = document.querySelector('[data-emote=dance]').getBoundingClientRect(); return { hit: h ? (h.element.dataset.emote || h.element.id || h.element.tagName) : null, at: h && [Math.round(h.x), Math.round(h.y)], target: [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)], hud: fisterVR._internals.liveSummary().find(l => l.startsWith('Menu panel')) }; });
  await page.evaluate(() => __xrMock.press('right', 0, true)); await page.waitForTimeout(100);
  await page.evaluate(() => __xrMock.press('right', 0, false)); await page.waitForTimeout(400);
  res.picked = await page.evaluate(() => ({ emotes: game.ui.emotes, eReleased: !fisterVR.state.keysDown.has('KeyE'), wheelHidden: document.getElementById('emoteWheel').style.display === 'none',
    emoting: fisterVR.state.emoting, thirdPerson: fisterVR.state.ragdoll, gameplay: fisterVR.state.gameplay }));
  const fc1 = await page.evaluate(() => [fisterVR.state.frameCount, game.frames, __xrMock.frames]);
  await page.waitForTimeout(1800);
  res.fc = [fc1, await page.evaluate(() => [fisterVR.state.frameCount, game.frames, __xrMock.frames])];
  res.after = await page.evaluate(() => ({ fields: (() => { const p = game.players.get('me'), lp = fisterVR.state.lateScene && fisterVR.state.lateScene.players; const L = lp && [...lp.values()].find(x => x.isLocalPlayer && x.isLocalPlayer()); return { same: L === p, isEmoting: p.isEmoting, emoting: p.emoting, state: typeof p.state, aes: p.actionEmoteState, anchor: p.emoteCameraAnchorLocked, anim: L && L.currentAnimationState }; })(), fc: fisterVR.state.frameCount, sum: fisterVR._internals.liveSummary().filter(l => /Feature|View|Frame/.test(l)), errs: fisterVR._internals.logBuffer.filter(e => /error/.test(e.level)).map(e => e.msg.slice(0, 160)), anim: game.players.get('me').currentAnimationState, frames: fisterVR.state.emoteFrames, gameplay: fisterVR.state.gameplay, emoting: fisterVR.state.emoting, thirdPerson: fisterVR.state.ragdoll, log: fisterVR._internals.logBuffer.filter(e => /Emot|emote/.test(e.msg)).map(e => e.msg) }));
  // Jump: body 1.5 m up; hand pointing 15 degrees down must aim far out, not at a floor under the hand.
  await page.evaluate(() => { __xrMock.setRay('right', [0.2, 1.2, -0.3], [0, -Math.sin(0.26), -Math.cos(0.26)]); });
  await page.waitForTimeout(500);
  const grounded = await page.evaluate(() => fisterVR.state.aimDist);
  await page.evaluate(() => { window.__jump = setInterval(() => { game.players.get('me').mesh.position.y = 1.5; }, 5); });
  await page.waitForTimeout(600);
  res.jump = await page.evaluate((g0) => ({ aimDistGrounded: +g0.toFixed(2), aimDistMidJump: +fisterVR.state.aimDist.toFixed(2) }), grounded);
  await page.evaluate(() => { clearInterval(window.__jump); game.players.get('me').mesh.position.y = 0; });
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
