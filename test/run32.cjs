// 0.9.13: ENTER VR on a menu with 3D previews (Quest report on 0.9.12: entered VR on the loadout screen, headset
// black, "Renders/s" all zero, 8 renderers). The page here is game2 ?norender (the main game draws nothing yet) plus a
// separate loadout-preview renderer whose canvas covers 45% of the screen and draws every frame.
// Expect: menu-only VR (not the preview renderer), the preview visible on the VR panel, and the hand-off to the game
// renderer only once a match draws the scene our player is in.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const SRC = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8804, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 587 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__xrMockLayers = true; });
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8804/game2.html?norender');
  await page.waitForFunction(() => window.game && window.THREE_REF);
  await page.evaluate((c) => (0, eval)(c), SRC);
  // Loadout preview: its own renderer and canvas (left 45% of the screen), orange background, drawn every frame.
  await page.evaluate(() => {
    const THREE = THREE_REF;
    const r = new THREE.WebGLRenderer(); r.setSize(Math.round(innerWidth * 0.45), Math.round(innerHeight * 0.9));
    Object.assign(r.domElement.style, { position: 'fixed', left: '0', top: '5%', zIndex: '5' });
    document.body.appendChild(r.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xff8800);
    const avatar = new THREE.Mesh(new THREE.BoxGeometry(.4, 1, .3), new THREE.MeshBasicMaterial({ color: 0x2244ff })); scene.add(avatar);
    const cam = new THREE.PerspectiveCamera(40, 0.6, 0.1, 20); cam.position.set(0, 0, 3);
    window.__previewFrames = 0;
    const loop = () => { avatar.rotation.y += 0.03; r.render(scene, cam); __previewFrames++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__preview = r;
  });
  await page.waitForFunction(() => __previewFrames > 20 && fisterVR.buttonText === 'ENTER VR');
  await page.evaluate(() => fisterVR.toggle());
  await page.waitForTimeout(2500);
  const menu = await page.evaluate(() => {
    const sa = fisterVR.state.standalone;
    const c = sa && sa.menu && sa.menu.canvas;
    let orange = 0, n = 0;
    if (c) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4 * 17) { n++; if (d[i] > 200 && d[i + 1] > 100 && d[i + 1] < 170 && d[i + 2] < 60) orange++; } }
    return { menuOnly: !!sa && !sa.handedOff, sessionOnPreview: fisterVR.state.renderer === __preview, panelOrangeShare: n ? +(orange / n).toFixed(3) : 0, previewFramesInVr: __previewFrames,
      notInMatchLogged: fisterVR._internals.logBuffer.some(e => /Not in a match/.test(e.msg)), dataUrl: c ? c.toDataURL('image/png') : null };
  });
  if (menu.dataUrl) fs.writeFileSync(process.env.SHOT || path.join(__dirname, 'run32-panel.png'), Buffer.from(menu.dataUrl.split(',')[1], 'base64'));
  delete menu.dataUrl;
  // A match starts: the main game draws the world with our player in it -> hand-off to the game renderer.
  await page.evaluate(() => { window.__started = true; });
  await page.waitForFunction(() => fisterVR.state.renderer === game.renderer && game.renderer.xr.isPresenting, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const match = await page.evaluate(() => ({ handedOff: fisterVR.state.renderer === game.renderer && game.renderer.xr.isPresenting, gameplay: fisterVR.state.gameplay,
    handOffLogged: fisterVR._internals.logBuffer.some(e => /Handed the headset/.test(e.msg)) }));
  await page.evaluate(() => fisterVR.toggle());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ presenting: fisterVR.presenting, problems: fisterVR._internals.logBuffer.filter(e => /error/.test(e.level)).map(e => e.msg.slice(0, 160)) }));
  const pass = menu.menuOnly && !menu.sessionOnPreview && menu.panelOrangeShare > 0.05 && menu.notInMatchLogged && match.handedOff && match.handOffLogged && !after.presenting;
  console.log(JSON.stringify({ pass, menu, match, after, errors }, null, 1));
  await browser.close(); server.close();
});
