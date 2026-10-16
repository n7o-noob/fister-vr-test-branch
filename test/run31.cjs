// 0.9.12: main menu drawn through an offscreen target (Quest report on 0.9.11: black menu, 249 repeated frames).
// game2 ?composite: the menu's 3D scene goes into a render target, a flat orthographic copy goes to the screen, and a
// small dark avatar preview is drawn straight to the screen with the scissor on. The headset must show the menu scene
// (dark blue background, magenta cube), not black and not the dark preview.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const SRC = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8803, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 587 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__xrMockLayers = true; });
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8803/game2.html?composite');
  await page.waitForFunction(() => window.game && window.game.frames > 20);
  await page.evaluate(() => { addEventListener('resize', () => game.renderer.setSize(innerWidth, innerHeight)); });
  await page.evaluate((c) => (0, eval)(c), SRC);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && fisterVR.buttonText === 'ENTER VR');
  // The game renderer has the session (as after a match ends); since 0.9.13 menus alone start menu-only VR (run32).
  await page.evaluate(() => { fisterVR.config.handOff = 'any'; fisterVR.toggle(); });
  await page.waitForTimeout(2500);
  const img = await page.evaluate(() => __xrMock.layerImage());
  fs.writeFileSync(process.env.SHOT || path.join(__dirname, 'run31-layer.png'), Buffer.from(img.split(',')[1], 'base64'));
  // Colours in the left eye: count menu-background, magenta and near-black pixels.
  const colours = await page.evaluate(async (src) => {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width / 2, im.height).data;
    let bg = 0, magenta = 0, black = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 13) {
      const r = d[i], g = d[i + 1], b = d[i + 2]; n++;
      if (Math.abs(r - 34) < 12 && Math.abs(g - 34) < 12 && Math.abs(b - 68) < 14) bg++;
      else if (r > 180 && b > 180 && g < 80) magenta++;
      else if (r < 12 && g < 12 && b < 12) black++;
    }
    return { bgShare: +(bg / n).toFixed(3), magentaShare: +(magenta / n).toFixed(3), blackShare: +(black / n).toFixed(3) };
  }, img);
  const summary = await page.evaluate(() => fisterVR._internals.liveSummary().filter(l => /^(VR|View|Frame|Renders\/s|Clips):/.test(l)));
  const st = await page.evaluate(() => ({ repeats: fisterVR.state.repeats || 0, xrFrames: __xrMock.frames, offscreenViews: fisterVR.state.offscreenViews || 0 }));
  await page.evaluate(() => fisterVR.toggle());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ presenting: fisterVR.presenting, gameFrames: game.frames }));
  const pass = colours.bgShare > 0.4 && colours.blackShare < 0.3 && st.offscreenViews > 10 && st.repeats < st.xrFrames / 2 && !after.presenting;
  console.log(JSON.stringify({ pass, colours, st, summary, after, errors }, null, 1));
  await browser.close(); server.close();
});
