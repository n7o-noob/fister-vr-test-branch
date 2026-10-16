// Save-clip button feedback (0.9.2): an old saved `right.thumbstick: null` becomes the clip button; the on-screen
// message says what happened (saving, clip recording off, no Save clip key, FisterQoL not loaded).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const SRC = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8796, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const run = async (setup) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
    await page.goto('http://127.0.0.1:8796/game3.html?lock');
    await page.waitForFunction(() => window.game && window.game.frames > 20);
    await page.evaluate(setup);
    await page.evaluate(() => { window.__keys = []; for (const t of ['keydown', 'keyup']) document.addEventListener(t, e => { if (e.code === 'KeyC') __keys.push(t); }, true); });
    await page.evaluate((c) => (0, eval)(c), SRC);
    await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && fisterVR.buttonText === 'ENTER VR');
    await page.evaluate(() => fisterVR.toggle()); await page.waitForTimeout(1200);
    await page.evaluate(() => __xrMock.press('right', 3, true)); await page.waitForTimeout(150);
    await page.evaluate(() => __xrMock.press('right', 3, false)); await page.waitForTimeout(150);
    const r = await page.evaluate(() => { const t = document.getElementById('fister-vr-toast'); return { button: fisterVR.config.buttons['right.thumbstick'], toast: t && t.style.display !== 'none' ? t.textContent : null, keys: __keys.slice() }; });
    r.errors = errors; await page.close(); return r;
  };
  const bridge = (key) => `window.__fisterQolVrBridge = { clipInput: () => (${JSON.stringify(key)}), sessionChanged() {} };`;
  const out = {
    oldSavedNullAndRecordingOn: await run(new Function(`localStorage.setItem('fister-vr-config', JSON.stringify({ buttons: { 'right.thumbstick': null } })); localStorage.setItem('fister-clip-recording', 'true'); ${bridge({ key: 'KeyC' })}`)),
    recordingOff: await run(new Function(`localStorage.removeItem('fister-vr-config'); localStorage.setItem('fister-clip-recording', 'false'); ${bridge({ key: 'KeyC' })}`)),
    noClipKey: await run(new Function(`localStorage.removeItem('fister-vr-config'); ${bridge(null)}`)),
    noQol: await run(new Function(`localStorage.removeItem('fister-vr-config'); delete window.__fisterQolVrBridge;`)),
    chosenNone: await run(new Function(`localStorage.setItem('fister-vr-config', JSON.stringify({ clipButtonChosen: true, buttons: { 'right.thumbstick': null, 'right.b': 'refocus' } })); ${bridge({ key: 'KeyC' })}`)),
  };
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
