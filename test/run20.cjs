// FisterQoL build: clip view while recording in VR, clip button -> game's clip key, no clip work when not recording.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const SRC = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8790, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8790/game3.html?lock');
  await page.waitForFunction(() => window.game && window.game.frames > 20);
  await page.evaluate(() => {
    window.__keys = [];
    document.addEventListener('keydown', e => { if (e.code === 'KeyC') __keys.push('down'); }, true);
    document.addEventListener('keyup', e => { if (e.code === 'KeyC') __keys.push('up'); }, true);
    window.__sess = [];
    window.__fisterQolVrBridge = { clipInput: () => ({ key: 'KeyC' }), sessionChanged: (on) => __sess.push(on) };
  });
  await page.evaluate((c) => (0, eval)(c), SRC);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && fisterVR.buttonText === 'ENTER VR');
  const outside = await page.evaluate(() => ({ clipFrameOutsideVr: fisterVR.clipFrame() }));
  await page.evaluate(() => fisterVR.toggle());
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ presenting: fisterVR.presenting, gameplay: fisterVR.state.gameplay, clipStats: fisterVR.clipStats(), sessionEvents: __sess.slice() }));
  // Simulate the game's recorder taking frames (FisterQoL calls fisterVR.clipFrame() for every captured frame).
  await page.evaluate(() => { window.__grabs = 0; window.__rec = setInterval(() => { const c = fisterVR.clipFrame(); if (c) __grabs++; window.__lastClip = c; }, 30); });
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(() => {
    const c = __lastClip; const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set(); let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { colors.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); sum += d[i] + d[i + 1] + d[i + 2]; n++; }
    return { size: c.width + 'x' + c.height, distinctColors: colors.size, meanBrightness: +(sum / n / 3).toFixed(1), stats: fisterVR.clipStats(), grabs: __grabs, dataUrl: c.toDataURL('image/png') };
  });
  fs.writeFileSync(path.join(__dirname, 'clip-frame.png'), Buffer.from(rec.dataUrl.split(',')[1], 'base64')); delete rec.dataUrl;
  // Headset view still drawn every frame while the clip view renders.
  const fr = await page.evaluate(async () => { const a = __xrMock.frames, g = game.frames; await new Promise(r => setTimeout(r, 1000)); return { xrFps: __xrMock.frames - a, gameFps: game.frames - g, repeats: fisterVR.state.repeats || 0 }; });
  // Clip button: right thumbstick click.
  await page.evaluate(() => __xrMock.press('right', 3, true)); await page.waitForTimeout(200);
  await page.evaluate(() => __xrMock.press('right', 3, false)); await page.waitForTimeout(200);
  const keys = await page.evaluate(() => __keys.slice());
  // Stop recording: the clip view stops rendering within ~1.5 s.
  await page.evaluate(() => clearInterval(__rec));
  await page.waitForTimeout(2000);
  const idle = await page.evaluate(async () => { const a = fisterVR.clipStats().frames; await new Promise(r => setTimeout(r, 800)); return { framesWhileIdle: fisterVR.clipStats().frames - a }; });
  await page.evaluate(() => fisterVR.toggle());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ presenting: fisterVR.presenting, clipFrameAfterExit: fisterVR.clipFrame(), sessionEvents: __sess.slice(), problems: fisterVR._internals.logBuffer.filter(e => /error|warn/.test(e.level) && !/first-person toggle/.test(e.msg)).map(e => e.msg.slice(0, 160)) }));
  console.log(JSON.stringify({ outside, before, rec, fr, keys, idle, after, errors }, null, 1));
  await browser.close(); server.close();
});
