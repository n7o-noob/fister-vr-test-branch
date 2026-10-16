// Virtual 1920x1080 screen: while in VR the page lays out at 1920x1080 (fixed elements anchor to that box), the floating
// screen is 16:9 and shows it, transparency applies, and leaving VR restores the page.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'site');
const server = http.createServer((req, res) => { const f = path.join(root, req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); }); }).listen(8800, async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'xr-mock.js') });
  await page.goto('http://127.0.0.1:8800/game3.html?emptymenu&lock');
  await page.waitForFunction(() => window.game && window.game.ui);
  await page.evaluate(() => document.getElementById('pause').classList.add('visible'));
  const bm = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'dist', 'fister-vr.bookmarklet.txt'), 'utf8').slice(11));
  await page.evaluate((c) => (0, eval)(c), bm);
  await page.waitForFunction(() => fisterVR.state.renderers.size > 0 && document.getElementById('fister-vr-button').textContent === 'ENTER VR');
  await page.evaluate(() => document.getElementById('fister-vr-button').click());
  await page.waitForTimeout(600);
  const res = {};
  res.onEmptyMenu = await page.evaluate(() => ({ menuOnly: !!fisterVR.state.standalone && !fisterVR.state.standalone.handedOff, panelDraws: fisterVR.state.standalone && fisterVR.state.standalone.menu.draws }));
  res.inVr = await page.evaluate(() => {
    const S = fisterVR._internals.screenRect(), sb = document.getElementById('scoreboard') || document.querySelector('[id*=score]');
    const right = document.createElement('div'); right.id = 'rightEdge'; right.style.cssText = 'position:fixed;right:0;top:0;width:10px;height:10px;background:red'; document.body.appendChild(right);
    const rr = right.getBoundingClientRect();
    const m = fisterVR.state.standalone ? fisterVR.state.standalone.menu : fisterVR.state.menu;
    const vb = document.getElementById('vwbox'), vr = vb.getBoundingClientRect();
    window.__dbg = fisterVR._internals.logBuffer.filter(e => /virtual|failed|error/i.test(e.msg)).map(e => e.msg.slice(0, 200));
    return { dbg: window.__dbg, vwBoxCss: [vr.left, vr.top, vr.width, vr.height].map(n => Math.round((n - (n === vr.left ? S.x : n === vr.top ? S.y : 0)) / S.k)), compactMediaRuleOff: getComputedStyle(vb).borderTopWidth, gameSeesWindow: [innerWidth, innerHeight], screen: [S.w, S.h].map(n => Math.round(n)), cssScale: +S.k.toFixed(3), rightEdgeCssX: Math.round((rr.right - S.x) / S.k), canvas: [m.canvas.width, m.canvas.height], bodyTransform: getComputedStyle(document.body).transform };
  });
  await page.evaluate(() => { fisterVR.config.uiOpacity = 0.5; });
  await page.waitForTimeout(300);
  const shot = await page.evaluate(() => { const m = fisterVR.state.standalone ? fisterVR.state.standalone.menu : fisterVR.state.menu; m.dirty = true; return new Promise(r => setTimeout(() => r(m.canvas.toDataURL('image/png')), 1200)); });
  fs.writeFileSync(process.env.SHOT || '/tmp/vscreen.png', Buffer.from(shot.split(',')[1], 'base64'));
  await page.evaluate(() => __xrMock.session.end());
  await page.waitForTimeout(400);
  res.afterVr = await page.evaluate(() => ({ vwBox: Math.round(document.getElementById('vwbox').getBoundingClientRect().width), compactRuleBack: getComputedStyle(document.getElementById('vwbox')).borderTopWidth, window: [innerWidth, innerHeight], bodyStyle: document.body.getAttribute('style'), width: Math.round(document.body.getBoundingClientRect().width), vscreen: !!fisterVR.state.vscreen }));
  console.log(JSON.stringify(res, null, 1)); console.log('errors', errors);
  await browser.close(); server.close();
});
