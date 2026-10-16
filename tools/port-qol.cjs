// Port the Fister VR integration (QoL > VR tab, VR clips, FPS uncap, recorder hooks, document-start injection) from the
// current template onto a plain FisterQoL release. Used for 1.7.4, 1.7.5 and 2.0.
// Usage: node tools/port-qol.cjs qol/FisterQoL.user.template.js <plain FisterQoL.user.js> <out template>
'use strict';
const fs = require('fs');
const [,, oldTemplatePath, plainPath, outPath] = process.argv;
const oldText = fs.readFileSync(oldTemplatePath, 'utf8');
const newText = fs.readFileSync(plainPath, 'utf8');

function splitRuntime(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith('const RUNTIME="'));
  if (i < 0) throw new Error('RUNTIME line not found');
  const literal = lines[i].slice('const RUNTIME='.length).replace(/;\s*$/, '');
  return { lines, index: i, runtime: JSON.parse(literal) };
}
const once = (label, text, from, to) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(label + ': expected 1 match, found ' + n + ' for ' + JSON.stringify(from.slice(0, 80)));
  return text.replace(from, () => to);
};

const oldParts = splitRuntime(oldText);
const parts = splitRuntime(newText);

// ---- Runtime (QoL app source) ----------------------------------------------------------------------------------
let rt = parts.runtime;
// 1. The VR module (fisterVrQol) and the QoL > VR panel (FisterVrPanel), copied verbatim from the 1.6.5 template.
const oldRt = oldParts.runtime;
const blockStart = oldRt.indexOf('var fisterVrQol=(()=>{');
const blockEnd = oldRt.indexOf('var fisterQolCategories=');
if (blockStart < 0 || blockEnd < blockStart) throw new Error('VR block not found in the old template');
const vrBlock = oldRt.slice(blockStart, blockEnd);
rt = once('VR block', rt, 'var fisterQolCategories=', vrBlock + 'var fisterQolCategories=');
// 2. QoL > VR category and its panel.
rt = once('category', rt, "['fun','Fun'],['profiles','Profiles']]", "['fun','Fun'],['vr','VR'],['profiles','Profiles']]");
const nestedStart = rt.indexOf(' const nested=[[');
const nestedEnd = rt.indexOf(']];', nestedStart);
if (nestedStart < 0 || nestedEnd < 0) throw new Error('nested panel list not found');
rt = rt.slice(0, nestedEnd) + "],['vr',FisterVrPanel" + rt.slice(nestedEnd);
// 3. "Ignore the FPS limit while in VR": the headset needs a frame every XR frame.
rt = once('fps cap', rt, "'shouldRender',original=>function(...args){if(!settings.fpsCounter)return original.apply(this,args);",
  "'shouldRender',original=>function(...args){if(!settings.fpsCounter&&!fisterVrQol.uncapped())return original.apply(this,args);");
rt = once('fps interval', rt, "'getUncappedIntervalMs',original=>function(...args){return settings.fpsCounter?0:original.apply(this,args);",
  "'getUncappedIntervalMs',original=>function(...args){return settings.fpsCounter||fisterVrQol.uncapped()?0:original.apply(this,args);");
// 4. Clips: the recorder gets the headset view (fisterVR.clipFrame) and overlays are mapped over the VR screen (clipRect).
rt = once('clip vars', rt, " let source=null,canvas=null,ctx=null,mode='horizontal',profile=null;",
  " let source=null,canvas=null,ctx=null,mode='horizontal',profile=null,vrImage=null;");
rt = once('recordingCanvas', rt,
  "function recordingCanvas(game,captureMode='horizontal',captureProfile=null){source=game;mode=captureMode;profile=captureProfile;if(!fisterQol.settings.overlaysInClips)return game;",
  "function recordingCanvas(game,captureMode='horizontal',captureProfile=null,recorder=null){if(recorder)fisterVrQol.noteRecorder(recorder);source=game;mode=captureMode;profile=captureProfile;vrImage=fisterVrQol.clipFrame();if(!fisterQol.settings.overlaysInClips&&!vrImage)return game;");
rt = once('capture image', rt,
  "function capture(){if(!source||!ctx)return;const w=source.width,h=source.height;",
  "function capture(){if(!source||!ctx)return;const image=vrImage||source,w=image.width,h=image.height;");
rt = once('capture draw', rt,
  "ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(source,0,0,w,h);if(!fisterQol.settings.overlaysInClips)return;\n  const rect=source.getBoundingClientRect();",
  "ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(image,0,0,w,h);if(!fisterQol.settings.overlaysInClips)return;\n  const rect=(vrImage&&fisterVrQol.clipRect())||source.getBoundingClientRect();");

// ---- Outer userscript (loader) ------------------------------------------------------------------------------
const lines = parts.lines.slice();
lines[parts.index] = 'const RUNTIME=' + JSON.stringify(rt) + ';';
let outer = lines.join('\n');
// 5. VR injection at document-start (with the build's __FISTER_VR_SOURCE__ slot), from the 1.6.5 template.
const injStart = oldText.indexOf('// VR mode (QoL > VR).');
const injEndMarker = 'watch.observe(document,{childList:true,subtree:true});})();\n';
const injEnd = oldText.indexOf(injEndMarker, injStart);
if (injStart < 0 || injEnd < 0) throw new Error('VR injection block not found in the old template');
const injection = oldText.slice(injStart, injEnd + injEndMarker.length);
if (!injection.includes('const VR_SOURCE=__FISTER_VR_SOURCE__;')) throw new Error('VR_SOURCE slot missing from the injection block');
outer = once('injection', outer, 'window.__fisterQolBrowserLoading=true;\n', 'window.__fisterQolBrowserLoading=true;\n' + injection);
// 6. The game's recorder is passed to the clip hook (QoL > VR reports and the save-clip key use it).
outer = once('recorder start', outer, "'let a=e.start(fisterClipOverlays.recordingCanvas(n,'+mode+'),i);'", "'let a=e.start(fisterClipOverlays.recordingCanvas(n,'+mode+',null,e),i);'");
outer = once('recorder frame', outer, "'e?.recording&&(e.canvas=fisterClipOverlays.recordingCanvas('+clip+','+mode+',e.activeProfile),e.captureRenderedFrame())'",
  "'e?.recording&&(e.canvas=fisterClipOverlays.recordingCanvas('+clip+','+mode+',e.activeProfile,e),e.captureRenderedFrame())'");
// 7. Start the VR module with the rest of QoL.
outer = once('boot', outer, 'fisterOverlays.start();fisterQol.boot(', 'fisterOverlays.start();fisterVrQol.start();fisterQol.boot(');
// 8. Header: say what this is.
outer = once('description', outer, /\/\/ @description .*\n/.exec(outer)[0],
  '// @description  Quality-of-life mod for Fister: HUD, crosshair, camera, audio, performance, clips, music, outfits, pets, custom themes and optional WebXR VR mode, all in the game\'s Settings.\n');

fs.writeFileSync(outPath, outer);
// Sanity: parses once the slot is filled, and every VR touch point from 1.6.5 is present.
new Function(outer.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n/, '').replace('const VR_SOURCE=__FISTER_VR_SOURCE__;', 'const VR_SOURCE="";'));
const count = (s, t) => s.split(t).length - 1;
const touch = ['fisterVrQol.uncapped', 'fisterVrQol.noteRecorder', 'fisterVrQol.clipFrame', 'fisterVrQol.clipRect', 'vrImage', 'FisterVrPanel', "['vr','VR']", 'fisterVrQol.start()', '__FISTER_VR_SOURCE__', ',null,e),i)', "e.activeProfile,e)"];
const report = Object.fromEntries(touch.map((t) => [t, [count(oldText.includes('const RUNTIME') ? oldText.replace(/const RUNTIME=.*\n/, JSON.stringify(oldRt) + '\n') : oldText, t), count(outer.replace(/const RUNTIME=.*\n/, JSON.stringify(rt) + '\n'), t)]]));
console.log(JSON.stringify({ wrote: outPath, bytes: outer.length, version: (/@version\s+(\S+)/.exec(outer) || [])[1], vrBlockChars: vrBlock.length, touchPoints_old_new: report }, null, 1));
