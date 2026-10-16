// 0.9.11: page mirror + clip view on a Quest-like headset (WebXR layers, virtual 1920x1080 screen).
// - The flat page shows the headset view over the whole virtual screen, under the game's overlays (not a black canvas).
// - Clip frames are 16:9 and clipRect() is the virtual screen (FisterQoL maps overlays with it).
// - When copies of the game canvas come out black (what the Quest does), the clip view switches to GPU read-back.
// - Mirror refreshes slowly when not recording, and is removed when VR ends.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const SRC = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8802, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 587 } }); // the Quest Browser's wide, short window
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__xrMockLayers = true; });
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8802/game3.html?lock');
  await page.waitForFunction(() => window.game && window.game.frames > 20);
  // Like a real game: follow window resizes (three.js ignores setSize while presenting).
  await page.evaluate(() => { addEventListener('resize', () => game.renderer.setSize(innerWidth, innerHeight)); });
  // SYNC=1: an older three.js without readRenderTargetPixelsAsync (sync read-back fallback).
  if (process.env.SYNC) await page.evaluate(() => { game.renderer.readRenderTargetPixelsAsync = undefined; });
  await page.evaluate((c) => (0, eval)(c), SRC);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && fisterVR.buttonText === 'ENTER VR');
  await page.evaluate(() => fisterVR.toggle());
  await page.waitForTimeout(1500);
  // Not recording: the mirror still shows the view, at a low rate.
  const idle = await page.evaluate(async () => {
    const a = fisterVR.clipStats().frames; await new Promise(r => setTimeout(r, 2000)); const s = fisterVR.clipStats();
    const m = document.getElementById('fister-vr-mirror'), mr = m && m.getBoundingClientRect(), br = document.body.getBoundingClientRect();
    return { mirrorFramesIn2s: s.frames - a, mirror: !!(m && m.isConnected), afterGameCanvas: !!m && m.previousElementSibling === game.renderer.domElement,
      coversScreen: !!mr && Math.abs(mr.width - br.width) < 2 && Math.abs(mr.height - br.height) < 2 && Math.abs(mr.left - br.left) < 2 && Math.abs(mr.top - br.top) < 2,
      size: s.width + 'x' + s.height, method: s.method };
  });
  const shot = await page.screenshot();
  fs.writeFileSync(process.env.SHOT || path.join(__dirname, 'run30-page.png'), shot);
  // Centre of the virtual screen on the page is the headset view (sky blue / green), not black.
  const pageCentre = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const br = document.body.getBoundingClientRect(); const d = x.getImageData(Math.round(br.width / 2), Math.round(br.height / 3), 1, 1).data;
    return { rgb: [d[0], d[1], d[2]], black: Math.max(d[0], d[1], d[2]) < 20 };
  }, shot.toString('base64'));
  // Recording, with copies of the WebGL canvas forced black (the Quest's behaviour).
  await page.evaluate(() => {
    const orig = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
      if (src === game.renderer.domElement) { this.save(); this.setTransform(1, 0, 0, 1, 0, 0); this.fillStyle = '#000'; this.fillRect(0, 0, this.canvas.width, this.canvas.height); this.restore(); return; }
      return orig.call(this, src, ...rest);
    };
    window.__rec = setInterval(() => { window.__lastClip = fisterVR.clipFrame(); }, 30);
  });
  await page.waitForFunction(() => fisterVR.clipStats().method === 'readback', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(() => {
    const c = __lastClip, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let max = 0, sum = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 101) { max = Math.max(max, d[i], d[i + 1], d[i + 2]); sum += d[i] + d[i + 1] + d[i + 2]; n++; }
    const rect = fisterVR.clipRect(), br = document.body.getBoundingClientRect();
    return { stats: fisterVR.clipStats(), sameCanvasAsMirror: c === document.getElementById('fister-vr-mirror'), aspect: +(c.width / c.height).toFixed(3),
      maxChannel: max, meanBrightness: +(sum / n / 3).toFixed(1), clipRectIsScreen: !!rect && Math.abs(rect.width - br.width) < 1 && Math.abs(rect.height - br.height) < 1,
      switchLogged: fisterVR._internals.logBuffer.some(e => /reading the view back from the GPU/.test(e.msg)), dataUrl: c.toDataURL('image/png') };
  });
  fs.writeFileSync(path.join(__dirname, 'run30-clip.png'), Buffer.from(rec.dataUrl.split(',')[1], 'base64')); delete rec.dataUrl;
  const fr = await page.evaluate(async () => { const a = __xrMock.frames; await new Promise(r => setTimeout(r, 1000)); return { xrFps: __xrMock.frames - a }; });
  const reportLine = await page.evaluate(() => fisterVR._internals.liveSummary().find(l => l.startsWith('Clips:')) || null);
  await page.evaluate(() => { clearInterval(__rec); fisterVR.toggle(); });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ presenting: fisterVR.presenting, mirrorGone: !document.getElementById('fister-vr-mirror'), clipRect: fisterVR.clipRect(),
    problems: fisterVR._internals.logBuffer.filter(e => /error/.test(e.level) && !/first-person toggle/.test(e.msg)).map(e => e.msg.slice(0, 160)) }));
  const pass = idle.mirror && idle.afterGameCanvas && idle.coversScreen && idle.mirrorFramesIn2s >= 4 && idle.mirrorFramesIn2s <= 20 && idle.size.startsWith('1') && !pageCentre.black
    && rec.stats.method === 'readback' && rec.maxChannel > 40 && rec.sameCanvasAsMirror && Math.abs(rec.aspect - 16 / 9) < 0.02 && rec.clipRectIsScreen && rec.switchLogged
    && after.mirrorGone && after.clipRect === null && !after.presenting;
  console.log(JSON.stringify({ pass, idle, pageCentre, rec, fr, reportLine, after, errors }, null, 1));
  await browser.close(); server.close();
});
