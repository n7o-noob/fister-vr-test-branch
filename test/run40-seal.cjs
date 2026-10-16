// Test-branch sealing, end to end. Needs the built + sealed artifacts (node tools/build.cjs && SEAL_PASSWORD=... node
// tools/seal-build.cjs) and the same password: SEAL_PASSWORD=... node test/run40-seal.cjs. Skips if unset.
// Checks: the gate rejects a wrong password and reveals the real page on the right one; Copy emits a sealed
// bookmarklet with no raw code in it; that bookmarklet runs fisterVR only with the password; a static dist sealed
// bookmarklet runs too. The runnable bookmarklets are evaluated over http://127.0.0.1 (a secure context, like the
// real https site) because crypto.subtle needs one.
const PW = process.env.SEAL_PASSWORD || process.argv[2];
if (!PW) { console.log(JSON.stringify({ skipped: 'set SEAL_PASSWORD to run' })); process.exit(0); }
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  if (req.url === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<body>blank</body>'); }
  const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); });
}).listen(8899, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const out = {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const perr = []; page.on('pageerror', e => perr.push(e.message));
  await page.goto('http://127.0.0.1:8899/docs/index.html');
  await page.waitForSelector('#pw');
  await page.fill('#pw', 'wrongpass'); await page.click('button[type=submit]'); await page.waitForTimeout(400);
  out.wrongPwError = await page.textContent('#err');
  out.stillGatedAfterWrong = await page.$('#pw') !== null;
  await page.fill('#pw', PW); await page.click('button[type=submit]');
  await page.waitForFunction(() => !!document.getElementById('copy'), null, { timeout: 15000 });
  out.revealedRealPage = await page.$('#copy') !== null;
  out.hasTestBanner = (await page.content()).includes('TEST BUILD');
  await page.selectOption('#bundle', 'vr');
  await page.click('#copy');
  await page.waitForFunction(() => { const v = document.getElementById('code').value; return v && v.startsWith('javascript:'); }, null, { timeout: 15000 });
  const sealedUrl = await page.$eval('#code', el => el.value);
  out.copiedLooksSealed = sealedUrl.includes('fvOpen') && sealedUrl.includes('prompt');
  out.copiedNotRawVr = !sealedUrl.includes('__fisterVrConfigOverrides');
  const inner = decodeURIComponent(sealedUrl.slice('javascript:'.length));

  const run = await browser.newPage();
  await run.addInitScript((pw) => { window.prompt = () => pw; window.alert = (m) => { window.__alert = m; }; }, PW);
  await run.goto('http://127.0.0.1:8899/__blank');
  await run.evaluate(inner);
  await run.waitForFunction(() => !!window.fisterVR || window.__alert, null, { timeout: 15000 }).catch(() => {});
  out.runWithRightPw = await run.evaluate(() => !!(window.fisterVR && window.fisterVR.version));

  const bad = await browser.newPage();
  await bad.addInitScript(() => { window.prompt = () => 'nope'; window.alert = (m) => { window.__alert = m; }; });
  await bad.goto('http://127.0.0.1:8899/__blank');
  await bad.evaluate(inner); await bad.waitForTimeout(1500);
  out.wrongPwDoesNotRun = await bad.evaluate(() => typeof window.fisterVR === 'undefined' && !!window.__alert);

  const distTxt = fs.readFileSync(path.join(root, 'dist/fister-vr.sealed.bookmarklet.txt'), 'utf8');
  const dist = await browser.newPage();
  await dist.addInitScript((pw) => { window.prompt = () => pw; }, PW);
  await dist.goto('http://127.0.0.1:8899/__blank');
  await dist.evaluate(decodeURIComponent(distTxt.slice('javascript:'.length)));
  await dist.waitForFunction(() => !!window.fisterVR, null, { timeout: 15000 }).catch(() => {});
  out.distSealedRuns = await dist.evaluate(() => !!window.fisterVR);

  out.pageErrors = perr.slice(0, 5);
  out.pass = out.wrongPwError === 'Wrong password.' && out.stillGatedAfterWrong && out.revealedRealPage && out.hasTestBanner
    && out.copiedLooksSealed && out.copiedNotRawVr && out.runWithRightPw && out.wrongPwDoesNotRun && out.distSealedRuns;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
