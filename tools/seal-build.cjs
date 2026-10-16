#!/usr/bin/env node
'use strict';
// Test-branch only. Run AFTER tools/build.cjs. Seals the served artifacts with the gate password:
//   docs/index.html  -> a password gate that decrypts the real setup page in the browser.
//   dist/*.sealed.bookmarklet.txt -> self-decrypting bookmarklets (ask for the password, then run).
// Password comes from the SEAL_PASSWORD env var (or argv[2]); it is never written into any committed file.
// Deterrent only on a public repo — see DEVELOPMENT.md "Sealing". Usage: SEAL_PASSWORD=... node tools/seal-build.cjs
const fs = require('fs');
const path = require('path');
const { seal } = require('./seal.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, text) => { fs.writeFileSync(path.join(root, p), text); console.log('sealed', p, '(' + Buffer.byteLength(text) + ' bytes)'); };

const password = process.env.SEAL_PASSWORD || process.argv[2];
if (!password) { console.error('seal-build: set SEAL_PASSWORD (the gate password). Nothing written.'); process.exit(1); }

const openSrc = read('site/seal-open.js'); // defines `async function fvOpen(E, pw)`

// A self-decrypting bookmarklet: inline the decrypter + the sealed blob, prompt, decrypt, eval.
function sealedBookmarklet(code) {
  const env = seal(code, password);
  const inner = '(async function(){var E=' + JSON.stringify(env) + ';' + openSrc
    + 'try{var p=prompt("Fister VR test \\u2014 enter password to run");if(p===null)return;var c=await fvOpen(E,p);(0,eval)(c);}catch(e){alert("Could not run (wrong password or blocked): "+(e&&e.message||e));}})();void 0;';
  return 'javascript:' + encodeURIComponent(inner);
}

// 1) Gate page over the real setup page.
const realPage = read('docs/index.html');
const env = seal(realPage, password);
const gate = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Fister VR test — locked</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#008080; font:16px/1.5 Tahoma, Arial, sans-serif; }
  @media (prefers-color-scheme: dark) { body { background:#004f4f; } }
  .win { width:min(92vw,420px); background:#c0c0c0; color:#000; border:2px solid #000; box-shadow:4px 4px 0 rgba(0,0,0,.5); }
  .bar { display:flex; align-items:center; justify-content:space-between; padding:4px 8px; background:linear-gradient(90deg,#000080,#1084d0); color:#fff; font-weight:bold; }
  .body { padding:16px; }
  h1 { font-size:18px; margin:0 0 8px; }
  p { margin:0 0 12px; }
  .note { font-size:12px; color:#333; background:#ffffe1; border:1px solid #808080; padding:8px; }
  input { width:100%; box-sizing:border-box; padding:7px 8px; border:2px inset #fff; font-size:16px; }
  button { margin-top:12px; padding:7px 16px; border:2px outset #fff; background:#c0c0c0; font-size:15px; cursor:pointer; }
  button:active { border-style:inset; }
  .err { color:#a00; font-size:14px; min-height:1.2em; margin-top:8px; }
</style>
</head>
<body>
<form class="win" id="gate" autocomplete="off">
  <div class="bar"><span>Fister VR — test build</span><span aria-hidden="true">×</span></div>
  <div class="body">
    <h1>Password</h1>
    <p>This is a locked test build. Enter the password to open the setup page.</p>
    <input id="pw" type="password" inputmode="text" autocomplete="off" aria-label="Password" autofocus>
    <button type="submit">Open</button>
    <div class="err" id="err" role="alert"></div>
    <p class="note">Test build, not the live page. The lock is a deterrent, not real security: this is a public repo, so anyone with the password can open it.</p>
  </div>
</form>
<script>
const ENV = ${JSON.stringify(env)};
${openSrc}
const err = document.getElementById('err');
async function reveal(pw){
  const html = await fvOpen(ENV, pw); // throws on a wrong password (GCM auth)
  try { sessionStorage.setItem('fvtb_pw', pw); } catch (e) {}
  document.open(); document.write(html); document.close();
}
document.getElementById('gate').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = 'Checking…';
  try { await reveal(document.getElementById('pw').value); }
  catch (x) { err.textContent = 'Wrong password.'; }
});
// Skip the prompt within a session once unlocked.
(async () => { let pw = null; try { pw = sessionStorage.getItem('fvtb_pw'); } catch (e) {} if (pw) { try { await reveal(pw); } catch (e) {} } })();
</script>
</body>
</html>
`;
write('docs/index.html', gate);

// 2) Static sealed bookmarklets (downloadable, self-decrypting) for the two default builds.
for (const [src, out] of [
  ['dist/fister-vr.bookmarklet.txt', 'dist/fister-vr.sealed.bookmarklet.txt'],
  ['dist/fister-vr-qol.bookmarklet.txt', 'dist/fister-vr-qol.sealed.bookmarklet.txt'],
]) {
  const txt = read(src);
  const code = decodeURIComponent(txt.replace(/^javascript:/, ''));
  write(out, sealedBookmarklet(code));
}
console.log('Sealed with the supplied password (not stored). Open docs/index.html and enter it to proceed.');
