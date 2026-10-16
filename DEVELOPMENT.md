# Development notes (handoff)

Context for anyone (human or AI) continuing work on Fister VR. Current version: see `@version` in `src/fister-vr.js`.

## This is the test branch (fister-vr-test-branch)

- Separate **public** repo from `fister-vr`. It tracks the same FisterQoL as `fister-vr` (now **2.0**, ported VR tab); newer unreleased QoL builds land here first. It also carries a **password gate + sealing** on the served artifacts. Keep the mod code in sync with `fister-vr`; this repo adds only the QoL version and the sealing.
- The setup page footer/banner says "TEST BUILD". The `site/page-template.html` here has the gate-aware copy handler (see Sealing).

## Sealing (password gate, test branch only)

- **Goal:** keep casual visitors to the public Pages site from reading the source or grabbing the bookmarklet. **Deterrent, not security** — the repo is public and the password (`n7oiscool`) is weak and shipped, so anyone with it, or willing to brute it against the blob, gets everything. The source under `src/`, `qol/`, `site/` stays readable (needed to build).
- **Scheme (key wrapping):** a random 256-bit master key encrypts the payload (AES-256-GCM); the master key is wrapped by a key derived from the password via PBKDF2-SHA256 (250k iterations). Password unwraps the master key, master key decrypts the content. The master key is random per build (not guessable, not an online-findable key). `tools/seal.cjs` (Node) produces envelopes byte-compatible with browser WebCrypto (`site/seal-open.js`'s `fvOpen`).
- **What is sealed:** `docs/index.html` becomes a password gate that decrypts the real setup page in-browser; the bookmarklet the page copies is a **self-decrypting bookmarklet** (prompts for the password, then runs — works on https fister.fun, the Steam/Electron client, any modern browser); `dist/*.sealed.bookmarklet.txt` are static self-decrypting copies.
- **Build:** `node tools/build.cjs && SEAL_PASSWORD=<pw> node tools/seal-build.cjs`. The password comes from `SEAL_PASSWORD` (or argv) and is **never written into any committed file**. CI (`.github/workflows/build.yml`) is **manual-only** and refuses to run without the `SEAL_PASSWORD` secret, so a push can't publish an unsealed page.
- **Secure context:** `crypto.subtle` needs https (or 127.0.0.1). The gate and bookmarklets work on https fister.fun and GitHub Pages; they will **not** decrypt over plain `http://` or `file://`.
- **Test:** `SEAL_PASSWORD=<pw> node test/run40-seal.cjs` (gate reject/reveal, Copy seals, sealed bookmarklet runs only with the password, static dist one too). `run23` here unlocks the gate, then tests the QoL loader from the raw pre-seal code (`window.__fvRawCode`) because the stand-in game runs over http.

## Start here (state as of v0.9.15)

- **Working with the user:**
  - They test on a real Quest 2 and send videos, screenshots and **COPY LOG** reports. COPY LOG is the button next to VR INFO; the "Menu panel" and "Aim" lines plus the log are the key diagnostics.
  - Every change is only verified against the stand-in games in `test/`. Say so when reporting.
- **Workflow:**
  1. Edit `src/fister-vr.js` (and `site/page-template.html` / `qol/FisterQoL.user.template.js` for settings UIs).
  2. Bump `@version` and `const VERSION`.
  3. Run `node tools/build.cjs`, then `SEAL_PASSWORD=<pw> node tools/seal-build.cjs` (see Sealing), then the tests.
  4. Commit as n7o-noob, push to main. CI here is manual-only; the committed sealed `docs/`+`dist/` are what Pages serves.
  5. Tell the user to re-copy the bookmarklet once the setup page footer shows the new version.
- **Tests:** `cd test; NODE_PATH=/opt/node-tools/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node runN.cjs`.
  - They need `three.module.js` and `three.core.js` in `test/site/` (gitignored; copy them from an npm `three` build).
  - The full suite is run6–20, run23–33 and run40 (sealing; needs SEAL_PASSWORD). Each prints JSON and `errors []`; run8's "simulated arm crash" is intentional.
  - Don't overwrite existing test numbers; another chat also adds tests. Use the next free number and port.
- **Reference code:** the user's `fister-community-server.zip` (server + `dist/shared/gameplay`, no client/HUD code) was used for the shoulder-aim origin and the `isEmoting` field. It isn't in the repo; ask the user to re-upload it if needed.
- **Open / unverified on the real game:**
  - Does the in-match HUD now show? (v0.9.6 projection-layer drawing plus the v0.9.9 1920x1080 virtual screen.) Does Fister's UI lay out correctly on the virtual screen (vw/vh rewrite, media rules, spoofed `innerWidth`)?
  - Is E the emote wheel key, and does clicking pick an emote? Which emote fields does the client set?
  - Aim accuracy after the v0.9.10 fixes (jumps, air kicks, held items).
  - Held items (`ITEM_KEYS`, v0.8.0+): the user reported many still missing or wrong at v0.7.9. Not re-checked since.
  - The three.js-built panel never rendered on the Quest; the cause is unknown. Direct WebGL drawing (`drawOverlay`) is used instead.
  - Clips / flat page (v0.9.11): does the page mirror show the view on the Quest, and which clip method does COPY LOG's "Clips:" line report (canvas, or readback async/sync)? If it says "game canvas BLACK" too, the scene itself renders black in the clip camera, not just the copy.
  - Main menu in VR (v0.9.13): menus now start menu-only VR (dark room, floor grid, page panel with the 3D previews) and hand off when a match draws your player's scene full-screen (run32). Unconfirmed on the Quest. If the hand-off never comes, set `fisterVR.config.handOff = 'any'` for the old behaviour and send a log. Still open: the skybox flashing while loading into a map (loading should now stay menu-only until your player exists).

## Target and constraints

- **Main target:** standalone Meta Quest 2, Quest Browser, run as a **bookmarklet** on fister.fun. No PC, no SteamVR (the owner's SteamVR doesn't connect; Virtual Desktop runs but can't enter VR mode).
- Fister is a three.js game by BOOTLOOP Studio. The browser build loads an obfuscated bundle live from fister.fun, so the mod never edits game code. It hooks three.js from outside.
- The Steam client is Electron. `steam/` holds only *diffs* of its main.js/preload.js. Never commit Fister's own launcher files. ASAR integrity means a repacked app.asar won't start without patching the exe.
- Fister's arm names are backwards. `swapArms` is always true and is not offered on the setup page.

## Repo layout

- `src/fister-vr.js`: the whole mod (single file, ~2600 lines). Don't put multi-line strings in it, because the bookmarklet build strips full-line `//` comments and joins lines.
- `site/page-template.html`: the setup page (Windows 95 style like fister.fun). `__LAYER_SOURCE__` and `__VERSION__` are filled in by the build. Settings are baked into the bookmarklet.
- `tools/build.cjs` builds:
  - `docs/index.html` (GitHub Pages: main branch, `/docs`)
  - `dist/fister-vr.user.js`
  - `dist/fisterVr.js`
  - `dist/fister-vr.bookmarklet.txt`
- `.github/workflows/build.yml`: rebuilds and commits docs/ and dist/ on pushes touching src/, site/ or tools/.
- `test/`: the testing setup.
  - Stand-in games: `test/site/game2.js` with modes norender, emptymenu, lock, layer1, rebuild, third, ragdoll, glitch, lateClear; and `game3.html`, a Win95 HUD with pause/settings, pointer-lock gating and a charge bar.
  - `xr-mock.js`: a fake WebXR headset that drives three.js's real XR path.
  - Playwright scripts `run3`–`run15.cjs`. See `test/README.md`.

## Release checklist

1. Bump `@version` in `src/fister-vr.js`.
2. Run `node tools/build.cjs` and the relevant `test/run*.cjs`.
3. Commit and push to main. CI rebuilds docs/dist, and Pages deploys in about a minute.
4. Tell the user to re-copy the bookmarklet from https://n7o-noob.github.io/fister-vr/.

## Architecture (src/fister-vr.js)

**Finding the renderer**
- Object.prototype setter traps on `isWebGLRenderer` and `renderer`.
- For late attach (bookmarklet), an `isArrayCamera` getter probe plus a temporary `Object3D.prototype.onBeforeRender` patch.
- Probing repeats until the *main* renderer is found (`isMainRenderer`: canvas covers more than 30% of the viewport).

**Finding the player list**
- A Map.prototype get/values/forEach probe finds the players Map (entries with head/leftArm/rightArm).
- It re-probes when the Map goes stale, because the game rebuilds it.

**Classes**
- Vector3, Quaternion, Euler, Object3D, Mesh, BufferAttribute, Matrix4 and Texture are harvested from live objects.
- Harvesting retries every 30 frames until Mesh and Attribute exist, then `addMissingBoxes()` runs.

**Rendering (`renderThroughVr` / `renderMain`)**
- The game's render call is wrapped. The scene is drawn through an XR rig:
  - the rig is an Object3D in the scene
  - the view is a camera clone
  - the controllers sit in the rig
- Modes:
  - Gameplay: sticky, with hysteresis of about 45 frames before leaving.
  - Theater: menus and killcam.
  - Ragdoll: follows the game's third-person camera until the player gets up.
- Other fixes in this path:
  - torso, legs and clothing hidden
  - own outline shell hidden
  - outline meshes hidden (they showed as black boxes)
  - late screen clears blocked
  - one-frame position glitches ignored
  - near clip at most 5 cm

**XR loop**
- Uses `renderer.xr.setAnimationLoop`, NOT `renderer.setAnimationLoop`.
- An `inXrFrame` re-entry guard is in place.
- Window rAF is redirected into XR frames.
- Past bug: `renderer.setAnimationLoop` restarted three's rAF loop, which recursed into the XR frame and caused a stack overflow and black frames.

**Input**
- `pollInput` and `adoptControllers` (picks up controllers that connected before the rig existed).
- Buttons map to synthetic key and mouse events: triggers = mouse0, grips = mouse2, right A = V (voice), right B = refocus, left X = Space, left Y = Escape, left stick = WASD, left stick click = recenter, right stick = snap turn.
- Focus is spoofed (hasFocus, visibilityState), and `reassertFocus` runs.

**Aim (Vivecraft-style)**
- The right controller's pointing direction becomes synthetic mousemove events, with a learned radians-per-pixel ratio.
- Pointer lock is spoofed (`Document.prototype.pointerLockElement`, requestPointerLock). Escape toggles `pointerLockReleased`.

**Menu panel**
- The game's DOM is painted to a canvas texture (`paintDom`).
  - Covers images (CORS re-fetch), CSS background images, inline SVG, borders and Win95 bevels, and clipping.
  - Redraw is adaptive: a MutationObserver dirty flag plus a 1 s heartbeat.
- The panel is body-locked in rig space.
- Laser hit testing uses `elementFromPoint`, then uiPress, uiDrag and uiScroll. Range and select inputs are handled.
- Clicks run inside WebXR selectstart/selectend so they count as user activation (`attachSelectEvents`).

**Menu-only VR**
- Used when the game hasn't drawn a scene with meshes yet, e.g. the main menu.
- The mod uses its own WebGL context and XRWebGLLayer: floor grid, laser and panel.
- `handOffStandalone` moves the session to the game renderer via `renderer.xr.setSession` once a usable scene renders.

**While presenting**
- requestFullscreen resolves.
- AudioContext.resume races a 400 ms timeout.
- setTimeout/setInterval are patched: due callbacks run every headset frame (`runDueTimers`), because the Quest throttles the hidden page.

**Debug**
- Debug console: hold both grips 1 s in VR, or press the VR INFO button on the page. **Copy all** gives a report.
- `fisterVR.config`, `fisterVR.saveConfig()` and `fisterVR.dump()` are available from the browser console.

## Config defaults (selected)

- Arms and body: armMode 'hand', swapArms true, handOffset {forward 0.15, inward 0.06, up 0}, hideBody true, eyeOffset.up 0.1.
- Menu: mode 'body', distance 1.4, width 1.6, drop 0.15, tiltDeg 8, followDeg 35, maxFps 12, resolution 1280.
- Aim and other: aimMode 'hand', armScale 1, boxScale 1, hideOutlines 'world', spoofPointerLock true.

## v0.9.15: FisterQoL 2.0

- The FisterQoL bundled in the "Fister VR + FisterQoL" bookmark (and `dist/FisterQoL.user.js`) is now **2.0**, up from 1.6.5.
- FisterQoL releases no longer contain VR. The VR integration is ported onto each plain release with **`tools/port-qol.cjs`** (anchors must match exactly once, or it stops):
  - runtime: the `fisterVrQol` module and `FisterVrPanel` (QoL > VR), the `['vr','VR']` category, `fisterVrQol.uncapped()` in the frame pacer's `shouldRender` / `getUncappedIntervalMs`, and clips (`recordingCanvas(..., recorder)`, `vrImage = fisterVrQol.clipFrame()`, `capture()` draws `vrImage` and maps overlays with `fisterVrQol.clipRect()`);
  - loader: the document-start `injectVr` block with the `__FISTER_VR_SOURCE__` slot, the recorder argument at both clip patch sites, and `fisterVrQol.start()` in boot.
  - Next release: `node tools/port-qol.cjs qol/FisterQoL.user.template.js <new FisterQoL.user.js> qol/FisterQoL.user.template.js`. Running it on the same release reproduces the template byte for byte.
- Changes since 1.6.5 that matter here:
  - From 1.7.5, game hooks are optional: if an update breaks one, only that feature turns off. The clip hooks are optional too, so VR clips can switch off on their own after a game update.
  - 1.7.5 no longer exposes the game's key bindings (`__fisterNative.BR`/`CE`), so the automatic Save clip key search finds nothing; a key chosen in QoL > VR still works (all reads are in try/catch).
  - Vertical clips follow the game's `verticalFill` setting.
- 2.0's browser userscript is 1.7.5's with only the version changed; 2.0 adds Steam (Windows) and native Linux installers, which this repo does not use.
- Not verified in the real game: QoL 2.0 hooking the live client, and the VR tab inside it.

## v0.9.14: freeze / "Restoring Graphics" when loading into a match

- **Quest report** (0.9.13, FisterQoL build, quick play/main server): stuck at 95%, browser frozen, half-black frozen view, then the game's "Restoring Graphics" (WebGL context lost and restored). The COPY LOG had 71 "repeated frames" and 69+2 uncaught `TypeError: Cannot read properties of undefined (reading 'value')` in the game bundle right after the hand-off. 23 fps.
- **Likely cause.** The repeat-last-view fallback in `xrFrameBody` re-drew `state.threeScene` whenever the game skipped a frame, with no limit and no try/catch. During map loading the game tears scenes down, so the mod kept re-drawing a disposed scene. It threw inside three.js (uncaught, from the XR callback) and made three re-upload that scene's textures and geometry, piling GPU memory on top of the loading map.
- **Fixes.**
  - A repeat only happens if the game drew a real view under 300 ms ago, and at most 20 in a row (`lastRealRenderAt`, `repeatRun`).
  - Repeats are wrapped in try/catch. On failure: drop `state.threeScene`, block repeats for 2 s, call `renderer.resetState()`, log once.
  - Otherwise the frame is panel-only (`drawOverlay` alone), so loading UI stays visible.
  - `webglcontextlost` on any captured renderer's canvas: `state.contextLost`, all extra drawing stops, and if it's the presenting renderer the XR session is ended with a toast ("Press Enter VR again..."). `webglcontextrestored` clears the flag and resets the overlay and clip GL resources.
  - Frame line in COPY LOG: "repeated frames N (M failed) · panel-only frames K · CONTEXT LOST".
- Not verified on the Quest. If it still freezes, check the Clips line (clip/page mirror renders) and FisterQoL's uncapped FPS / clip recording as other GPU loads during loading.

## v0.9.13: menus start menu-only VR; hand-off only into a match

- Quest COPY LOG on 0.9.12 (ENTER VR on the loadout screen): headset black, "Renders/s" all 0, "Menu panel: not built yet", **8 renderers**, "main game view" captured only 75 s after VR started. The flat page showed the loadout's 3D preview (its own renderer) still drawing.
  - The session went to a renderer that didn't draw while presenting. On menus, Fister's 3D views are cosmetic/loadout previews with their own renderers.
  - With the virtual screen on, `isMainRenderer` compared canvas CSS size with the real (smaller) window, so a preview looked "main".
  - Capturing such a "main" renderer also removed the late camera probe for good, so the match's renderer (created before attach, or not drawing yet) was never found. Reproduced in run32.
- **Session start** (`onSessionStarted`): straight to the game renderer only if `readyForGameView` holds for the picked camera's renderer/scene, or for any camera whose scene is the local player's (`localPlayerScene`: root of `localPlayer().head`). Otherwise menu-only VR, logged as "Not in a match (...)".
- **Hand-off** (`renderThroughVr`, first branch): `readyForGameView(renderer, scene)`: the scene is the local player's and the canvas covers > 60% (`canvasCoverage`: of 1920x1080 with the virtual screen, or of the real window for a canvas that kept its pre-VR size). `config.handOff: 'any'` restores the old rule (big canvas + `sceneHasBuildingBlocks`).
- **Renderer search**: the `isArrayCamera` probe stays installed. `wantRendererProbe()` (cached 500 ms, since it is read many times per frame) arms it during menu-only VR, and otherwise until some renderer covers > 60%.
- **Previews on the panel** (menu-only VR): after each render by a non-presenting renderer, `snapshotCanvas` copies its canvas (at most the panel's fps, max 1024 px) into `state.canvasSnaps`, and `paintDom` draws the snapshot where the canvas sits. Renderer canvases used to be skipped entirely.
- run31 now sets `handOff: 'any'` (it tests the game-renderer theater path, as after a match ends).
- Not verified on the Quest.

## v0.9.12: main menu black in VR (preview inset, offscreen menu view)

- Quest COPY LOG on 0.9.11, main menu: View menu/theater, 249 repeated frames out of ~300, clip picture and game canvas both BLACK, only renderer "small, not the game view" at capture.
- Reproduced in `game2.html?composite` (run31): the menu scene goes into a 960x540 render target, an orthographic copy goes to the screen, and a dark avatar preview (more objects, drawn on some frames, scissored 20%x30% inset) goes straight to the screen.
  - `pickMain` scores cameras by renders × canvas area × scene size, so the preview camera became `state.gameCamera`.
  - `renderThroughVr` then took the preview inset as the headset view ("camera === gameplayCamera() || toScreen") and dropped the offscreen menu and its flat copy. The headset showed the preview's dark background; frames without a preview draw repeated it.
- Fixes in `renderThroughVr`:
  - **Insets are never the headset view** (`isInsetRender`): a screen render whose viewport, or scissor when on, is under 30% of the biggest unscissored screen area seen (at least 40% of `renderer.getSize()`). Viewport/scissor/size are read through three's own objects (`getViewport({copy})`, `getSize({set})`), no Vector4 needed.
  - Offscreen renders count as the gameplay view only for a **confirmed** gameplay camera (`confirmedGameplayCamera`: the game scene's camera or `state.gameplayCamera`), not the busiest camera at session start.
  - **Offscreen views** (`noteOffscreenView`): perspective renders into a full-screen-shaped target (2D, at least 256x144, aspect 1.1–2.8) are remembered per XR frame (biggest wins). If nothing reached the screen by the end of the frame, that scene/camera is drawn as the headset view (`state.offscreenViews`), before the repeat fallback.
- COPY LOG: new **"Renders/s:"** line (per second, while in VR): perspective renders to the screen, insets skipped (size), offscreen views (target size, how many shown), flat passes dropped (camera type). This is what to read on the real menu and while loading a map.
- Not verified on the Quest.

## v0.9.11: clips and the flat page in VR (page mirror, read-back)

- User report (Quest COPY LOG + screenshot of the flat page behind the headset): the page was black except the HTML overlays. Reproduced with the layers mock (`run30`):
  - While presenting with a projection layer, three.js draws only into the layer, so the game canvas never updates.
  - Three.js also ignores `setSize` while presenting, so with the virtual screen on, the canvas keeps its pre-VR CSS size (the real window) in the top-left of the 1920x1080 body, with black around it.
  - The clip view rendered into a corner of that canvas. On the Quest the result was black (either the render or the `drawImage` copy; unknown, see the "Clips:" line).
- **Page mirror** (`config.pageMirror`, default on; `pageMirrorFps` 5): the clip view's own 2D canvas (`#fister-vr-mirror`) is placed right after the game canvas (so the game's overlays stay above), `position:fixed` over the whole virtual screen (or the window), `object-fit: cover`, `pointer-events: none`, the canvas's numeric z-index. It is in `isOurs`, so the panel painter skips it. Removed at session end.
  - `clipWanted()`: while recording, a new view for each frame the recorder asked for (`clipCaptureAt >= frameAt`); otherwise the mirror rate. `clipView: 'off'` turns both off.
- **Clip frames are 16:9** with the virtual screen on (`clipSize`), and `fisterVR.clipRect()` returns the virtual screen's page rect. FisterQoL's `capture()` maps overlays into clips with it (`fisterVrQol.clipRect()`), not with the game canvas's (wrong, top-left) rect.
- **Black-frame check** (`checkClipFrame`, once a second): the clip canvas is sampled at 16x9, and in canvas mode 9 pixels of the default framebuffer are read right after the render (`sampleFramebuffer`). After 3 black checks in a row (`clipMethod: 'auto'`) it switches to **read-back** (`clipReadback`): render into our own render target (the XR target's constructor, `isXRRenderTarget = true` + `texture.colorSpace = outputColorSpace` so the bytes are display-encoded), read it back, flip into the clip canvas.
  - `readRenderTargetPixelsAsync` (pixel buffer + fence, no stall) when the game's three.js has it; one read in flight, frames skipped meanwhile. Otherwise `readRenderTargetPixels` (stalls; in swiftshader 9 fps vs 52 async).
  - Size: `clipReadbackHeight` (480). `clipMethod: 'canvas' | 'readback'` forces a method.
- COPY LOG: new **"Clips:"** line: size, method (and async/sync), frames, ms each, recording, picture (brightest channel of the clip canvas, BLACK under 6), game canvas (same, from the framebuffer), page mirror on/off. `clipStats()` has the same fields.
- Not verified on the Quest: all of it. Also noted in the user's report: the panel paint costs 25.9 ms per draw (178 draws) at 21 fps.

## v0.9.10: emotes, X = emote wheel, aim fixes

- **Emotes use the game's third-person camera**, like ragdolls.
  - `isEmoting(player)` checks: `isEmoting`/`emoting` (the server networks `isEmoting`); the same on `state`/`serverState`/`snapshot`; `actionEmoteState`; `emoteCameraAnchorLocked`; `wormEmotePose`/`twerkEmotePose.active`; or `currentAnimationState` matching emote/dance/twerk/worm/taunt.
  - It must be seen for 3 frames to enter, and drops 300 ms after the last sighting.
  - `state.ragdoll` (third-person view) = ragdolled or emoting.
- **Left X = `'emote'`** (was Space).
  - It holds `config.emoteKey` (default `KeyE`) until a menu click (`uiPress` release + 60 ms), X again, or 15 s.
  - While the wheel is open, `hudMode()` is false, so the laser can click anything on it.
  - Saved configs whose `left.x` is Space are migrated, unless the bookmarklet bakes `left.x`.
- **`Document.prototype.exitPointerLock`** while presenting sets `pointerLockReleased` and fires `pointerlockchange`, as the browser would. Games free the mouse this way for wheels and menus.
- **Aim fixes** (straight down / way off with items and air kicks):
  - The floor for the hand ray is the lowest body height over the last 2.5 s, not the current height. Mid-jump, the "floor" used to sit right under the hand.
  - Ray hits within 0.8 m of the hand are ignored. Boxes containing the hand are ignored.
  - All players' held items (`ITEM_KEYS`) are skipped by the raycast. Huge but flat boxes (floor slabs) are now included.
  - The shoulder origin is the mesh's world position + world up, not the rotated mesh's local up, which flipped during air kicks.
  - Steering and learning pause while `airKickPoseActive`, `acrobaticFlipVisualRemaining > 0`, `finisherRenderActive`, `emoteCameraAnchorLocked` or `replayFacingActive`. The status line says "(paused: air kick/flip)".
  - The learned mouse ratio flips sign only after 12 contrary samples (was 4).
- Not verified on the real game: the emote key (E), how Fister's wheel picks (click vs. mouse direction), and which emote fields it sets.

## v0.9.9: 1920x1080 virtual screen, transparency; size options removed

- User: still crowded. They asked to remove the width/height/size options, make the UI elements smaller and correctly placed on a 1920x1080 "fake screen", and add a transparency setting (setup page and FisterQoL).
- **`applyVirtualScreen(on)`**, on while presenting (game session and menu-only VR), off at session end. While on:
  - `<body>` gets `position:fixed; 1920x1080; transform: scale(k)` (k fits the real window). A transformed body is the containing block for `position:fixed`, so the game's overlays lay out as on a 1080p monitor, and `elementFromPoint` still works on the scaled-down page.
  - `rewritePageForVirtualScreen()` runs every 2 s. It rewrites `vw/vh/vmin/vmax` (also `d`/`s`/`l` variants) in readable stylesheets and inline styles to 1080p px, and sets width/height/aspect/orientation media rules to `all` / `not all` as evaluated for 1920x1080 (`mediaMatchesVirtual`). Undo closures restore everything.
  - `spoofWindowSize(true)` makes `innerWidth/innerHeight/outerWidth/outerHeight` report 1920x1080. These are own accessors on `window` in Chrome, so the original descriptors are saved and put back; deleting them removes the properties.
  - The mod's own code uses `winSize()` (the real window).
- **Painter.** It maps `screenRect()` (the body's visual rect) to the canvas. CSS sizes (fonts, borders, radii, padding, bevels, image natural sizes) are multiplied by `k` (visual px per CSS px). Big canvases (any renderer canvas, or one over 30% of the window) are not painted.
  - Canvas default 1600x900 (`menu.resolution` 1600). The panel and menu-only VR panel are 16:9.
- **Floating screen.**
  - `config.screen = { distance: 2.0, width: 2.5 }` for both menus and HUD. Menus are body-locked with a 0.15 m drop; the HUD is head-following at eye level.
  - The v0.8.2 HUD widget relayout (pull/grow, `hudMap`) is removed: elements stay where the game puts them.
  - `uiWidth`/`uiHeight`/`uiScale`, the in-VR resize controls and the setup page "Menu distance" option are removed.
- **`uiOpacity`** (0.2–1, default 0.9) is the panel alpha in direct drawing, menu-only VR and the three.js fallback.
  - Setup page: "VR screen transparency" (Solid / 0.9 / 0.75 / 0.6 / 0.4).
  - QoL > VR: "VR screen transparency" slider (20–100%), live via `V.setVr({ uiOpacity })`.
- Not verified on the real game: how much of Fister's UI uses `vw`/`vh` or JavaScript window sizes, and whether React re-lays out on the synthetic `resize` event.

## v0.9.8: separate VR menu width and height

- User clarification on 0.9.7: "I meant the height and width, not actual size". The Quest Browser lays the page out in a wide, short window (1280x587), so menus look squashed.
- `uiWidth` (default 1.4) and `uiHeight` (default 1.8) replace `uiScale`, which is still read as a fallback.
  - The panel is `base * uiWidth` wide and `base * aspect * uiHeight` tall, for the game-renderer panel, menu-only VR and the HUD.
  - HUD `pull` is divided by the larger of the two.
- Setup page: "VR menu width" (1 / 1.4 / 1.8 / 2.3) and "VR menu height" (1 / 1.4 / 1.8 / 2.3 / 2.8).
- In VR, pointing at a menu:
  - right stick left/right changes the width;
  - right grip held + stick up/down changes the height (no scrolling while the grip is held).
  - The aim-hand grip pressed on a menu is not sent to the game as a right click (`gripToUi`).

## v0.9.7: VR UI size

- User: "all UIs are condensed, way too small".
- `config.uiScale` (default 1.4; 1 = the old size) multiplies the menu panel width (game renderer and menu-only VR) and the HUD panel width.
  - In the HUD, `hud.pull` is divided by `uiScale`, so widgets get bigger but stay at the same angles in view.
- Setup page: "VR menu and HUD size": Small 1 / Medium 1.4 / Large 1.8 / Extra large 2.3.
- In VR: while the laser is on a menu, the right stick's left/right resizes the panels instead of turning (about 0.5% per frame), between 0.5 and 3. The size is saved after 0.4 s, with a toast.
  - A bookmarklet that bakes `uiScale` re-applies its value on the next tap, unless the page's own options say otherwise.
- run13/run15 laser targets now use `1.6 * uiScale` for the panel width.

## v0.9.6: in-round HUD on Quest (projection layers), shoulder aim

- **Why 0.8.3's direct drawing couldn't work on the Quest.** three.js uses an `XRProjectionLayer` (WebXR Layers) whenever `XRWebGLBinding.prototype.createProjectionLayer` exists, which it does in the Quest Browser. `drawOverlay` only knew `session.renderState.baseLayer` (an XRWebGLLayer), so it returned early and the mod fell back to the three.js panel mesh, which never shows on the Quest.
  - Now it takes `renderer.xr.getBaseLayer()`. For a projection layer it attaches each view's `binding.getViewSubImage(layer, view).colorTexture` (or a texture-array slice) to its own framebuffer and draws into `sub.viewport`.
  - The status line shows "drawn directly (N frames, projection layer | WebGL layer)", or "three.js mesh (direct: reason)".
- **Mock.** `xr-mock.js` can offer layers (`window.__xrMockLayers = true`): a side-by-side projection layer texture, plus `__xrMock.layerImage()` to read it back. Test: `run27.cjs`.
  - In the mock, the three.js panel mesh also shows inside the projection layer, so why it doesn't show on the Quest is still unknown. The direct drawing avoids the question.
- **Aim origin is the shoulder**, from the uploaded `fister-community-server` (`dist/shared/gameplay/GameWorld.js` `getChunkThrowVelocity`, `laserbeamGeometry.js`).
  - The server aims from `body + (0, PLAYER_MESH_ROOT_Y_OFFSET 0.2 + LASERBEAM_LOCAL_SHOULDER_HEIGHT 1, 0)` + 0.2 forward, along `getLaserbeamAimBasis(lookYaw, lookPitch)`, with ray convergence at 24 m (36 m in tank mode).
  - The mod uses `player.mesh.localToWorld(0, 1, 0)`. `aimOrigin: 'camera'` keeps the 0.8.1 behaviour.
- **What the community-server zip is.** It's the server plus the shared gameplay code: player sim, items, maps. It has no client rendering, DOM or HUD code, so it can't show how the HUD is built.

## v0.9.5: Save clip key setting

- Quest report on 0.9.4: the clip view worked ("recording the headset view at 1376x720", clip recording on), but
  "Clip button: no Save clip key found in the game controls": no control in `__fisterNative.BR` has "clip" in its name.
- QoL > VR > **Save clip key**: Automatic (search the game's controls for clip/replay/highlight), a list of common keys,
  or **Set by pressing the key** (captures `KeyboardEvent.code`, or mouse buttons 4/5). Saved as `clipKey` in
  `fister-qol-vr-v1`; `clipInput()` uses it first.
- The clip hook now also receives the game's recorder object (`recordingCanvas(canvas, mode, profile, recorder)`, both
  patch sites in the template). `clipInfo()` reports the control names, the recorder's functions and fields, and the
  native Clips settings text; `fisterVR.dump()` (VR info > Copy all, DETAILS) includes it as `clip`. Next step: if the
  key stays unknown, call the recorder's save function directly once its name is known from a report.

## v0.9.4: FisterQoL bookmarklet under fister.fun's script policy

- Quest log on 0.9.3: "frame loaded WITHOUT FisterQoL" three times and never "FisterQoL started in the frame", so the
  frame's first inline script never ran. fister.fun's Content-Security-Policy blocks inline scripts. Bookmarks are
  exempt (that's why the VR-only bookmarklet works), but an about:blank frame inherits the page's policy, so the
  `<script>parent.__fisterQolBoot(window)</script>` tag (and in 0.9.0, the in-place `<script>` injection) was blocked.
  The game never reloaded; the loader did. Reproduced exactly in `test/run26.cjs`.
- Fix: `findHost()` fetches same-origin candidates (`/robots.txt`, favicon, manifests, the page's own script and icon
  URLs, a non-existent path) and picks the first served without a `content-security-policy` or `x-frame-options`
  header. The frame navigates there first; the home page is then written into that document, which keeps the host
  file's (empty) policy. `<meta http-equiv=Content-Security-Policy>` tags are removed from the written copy. If no host is
  found it falls back to about:blank and logs it.
- Reload detection also treats the host file's URL as "the game reloaded itself" (a reload of a written document goes
  back to the document the frame navigated to).
- Log: the home page's policy header, the chosen host (or why each candidate was skipped), every
  `securitypolicyviolation` in the page or frame (directive, blocked URL, policy), and "FisterQoL did not start in the
  frame" if the boot script didn't run.

## v0.9.3: no more reload loops with the FisterQoL bookmarklet

- User report: with the FisterQoL bookmarklet the page reloaded forever.
- Cause found in testing: `location.reload()` inside the script-written frame reloads it as **about:blank** (the frame
  never had a real URL). The loader saw "no FisterQoL" and rebuilt at `/`, so any game that reloads itself once
  while starting (e.g. waiting for a service worker) looped forever. Other loop paths: the game navigating to a URL with
  an extra query parameter (the rebuild used the old URL, so the game redirected again), or to another page (FisterQoL
  never starts there, so the loader rebuilt forever).
- Loader now:
  - treats an about:blank frame load as "reload the last URL" (`lastUrl`, taken on the frame's `pagehide`);
  - rebuilds at the URL the game went to and keeps the top URL in sync;
  - only rebuilds the home page; other pages load normally without FisterQoL;
  - stops after 3 rebuilds in 30 s, loads the game without FisterQoL, and shows a banner with **Copy log**
    (`window.__fisterQolLog`: frame loads/unloads, errors, unhandled rejections, console errors/warnings, Fister info);
  - in the frame, ignores service-worker `controllerchange` listeners and reports the page's own SW controller;
  - freezes the old copy harder: any message event or localStorage change event reaching it closes the channel (or
    terminates the worker) and throws, so it can't react to the new copy.
- Not verified on the real site: the exact reason Fister reloaded is unknown. If the banner appears, the copied log
  shows it.

## v0.9.2: save-clip button feedback

- User report: pressing the save-clip button did nothing. There was no feedback, and older saved settings could
  hold `right.thumbstick: null`, overriding the new default. Their 0.7.9 debug dump also showed
  `fister-clip-recording: "false"` (the game's clip recording off, so its Save clip key has nothing to save).
- Config load gives `right.thumbstick` the `'clip'` action when it is null, unless `clipButtonChosen` is saved
  (QoL > VR sets it) or another button already has `'clip'`.
- `toast()`: a short message at the top of the page (also painted onto the HUD panel): "Saving clip (key)",
  "Clip recording is off ...", "No Save clip key found ...", or "Saving clips needs FisterQoL ...".
- QoL > VR shows "Game clip recording: on/OFF" next to the found key.

## v0.9.0 – v0.9.1: FisterQoL option and VR clips

- **Setup page option "What the bookmark loads":** Fister VR only, or Fister VR + FisterQoL.
  - `qol/FisterQoL.user.template.js` is the FisterQoL Tampermonkey userscript with `const VR_SOURCE=__FISTER_VR_SOURCE__;`
    where `tools/build.cjs` puts this layer. Change QoL there; never hand-edit `dist/`.
  - `qolForBookmarklet()` in the build reformats it for a bookmarklet: no metadata block, `window` = `globalThis`
    (no `unsafeWindow`), plain `<script>` elements instead of `GM_addElement` (VR layer and the patched game module),
    no Steam staging path, bookmark wording in the "started too late" message. The build fails if any
    Tampermonkey-only code is left or a swap anchor stops matching.
  - The result is gzipped and base64'd (~950 KB -> ~335 KB bookmarklet). `site/qol-loader.js` builds the loader:
    turns on QoL VR mode, writes the page's VR settings to `fister-vr-config` (every tap, or only when none are saved),
    unpacks with `DecompressionStream`.
  - **Restart in a frame (v0.9.1).** QoL must run before the game's bootstrap reads `__fisterRuntimeBootPromise`,
    and in the headset nobody can tap a bookmark that fast (the user's report on 0.9.0). So the loader always:
    1. fetches `/` (the home page HTML);
    2. freezes the running page: `window.stop()`, clears timers, no-op rAF/timers, pauses media, loses its WebGL
       contexts, closes AudioContexts on next use, closes WebSockets on their next send/receive, ends stream readers
       (WebTransport), and stubs `WebSocket` so it can't reconnect;
    3. replaces `<body>` with a full-window same-origin `<iframe id="fister-qol-frame">` (allow: fullscreen,
       xr-spatial-tracking, autoplay, microphone, ...), and `document.open/write`s the fetched HTML into it with
       `<script>parent.__fisterQolBoot(window)</script>` first in `<head>`, which appends the QoL code as a script in
       the frame. The frame's URL is the top page's (`/`), so QoL's path check and relative module URLs work, and the
       game boots fresh in its own realm with QoL hooked from the start;
    4. if the frame later loads without QoL (the game reloaded itself), it is replaced by a freshly booted frame.
  - Known limits: the game runs framed (`window.top !== window`); a cross-origin navigation inside the frame
    (e.g. an OAuth login that isn't a popup) can't be followed. Not verified on the real site yet.
- **Clip view** (`renderClipView`, `clipFrame`): in VR the canvas doesn't update. While FisterQoL's clip hook asks for
  frames (`fisterVR.clipFrame()` from `fisterClipOverlays.recordingCanvas`, i.e. while the game records), a
  first-person view from `state.view`'s world pose (lerp/slerp smoothing) is rendered with XR off into the bottom-left
  of the canvas and copied to a 2D canvas in the same task. `state.clipRendering` exempts that clear from the
  black-flash clear blocker. Config: `clipView`, `clipHeight`, `clipFov`, `clipSmoothing`. Nothing renders when not
  recording.
- **`'clip'` button action** (default on right stick click): asks `__fisterQolVrBridge.clipInput()` (FisterQoL looks up
  the game's clip binding in its input bindings) and presses it, with a haptic pulse. Without FisterQoL it only
  shows a status message.
- API: `fisterVR.toggle()`, `presenting`, `buttonText`, `copyLog()`, `clipFrame()`, `clipStats()`,
  `applyButtonVisibility()`; config `showButton`.
- Tests: `test/run20.cjs` (clip view + clip button), `test/run23.cjs` (setup page QoL option end to end on a
  stand-in home page, too-late and already-running checks).

## v0.8.3

- **The in-match panel was never visible on the Quest** (pause menu included). Menu-only VR, which draws with its own WebGL, always worked; the three.js-built panel in the game's scene didn't. The cause is unknown (texture class, the game's render passes, ...). The gray window in earlier videos was the Quest browser's 2D page, not the panel.
- **`drawOverlay(renderer)`**, called after the main headset render:
  - It draws the panel texture, the menu laser and dot, and the aim line with `overlayProgram(gl)` on the game's GL context, into `session.renderState.baseLayer.framebuffer`. Positions are in the XR reference space, which is the rig's local space times `rig.scale`.
  - Afterwards it calls `renderer.resetState()`.
  - While it works (`state.overlayOk`), the three.js panel, laser, dot and aim-laser meshes are hidden.
  - If it throws, the mod falls back to the three.js meshes. `config.overlayGl = false` turns it off.
- The status line shows "drawn directly (N frames)" or "three.js mesh".

## v0.8.2

- **In-match HUD layout.** Mapping the whole page onto one panel put Fister's HUD (health, style and souls at the top left, scoreboard at the top right) about 30° out, where the Quest's lenses blur. It looked like there was no HUD.
  - In HUD mode, `paintDom` now paints into a scratch canvas (`menu.full`) and collects "widgets": the first non-container box or text on each branch.
  - Boxes that are more than half the screen, more than 45% wide or more than 60% tall count as layout containers. Their backgrounds are skipped and the walk looks inside them.
  - Each widget is copied into the panel pulled toward the centre (`hud.pull`) and enlarged (`hud.grow`).
  - `menu.hudMap` maps laser hits back to the real page position.
- The status line shows "as HUD (N widgets)". If N is 0 on the real game, the widget detection is the problem.

## v0.8.1

- **Aim origin is the game camera** (`aimOrigin: 'camera'`). Fister's aim follows its third-person camera's crosshair, about 5.5 m behind the head; the green aim line runs from the body to where that crosshair hits.
  - The hand's target comes from a ground-plane test plus `raycastWorld`. That function ray-tests world-space boxes around scene meshes (refreshed every 1.5 s) and a rough box around each other player.
- **HUD mode** (`hudMode()`: in gameplay, not ragdolled, no menu open):
  - The painter skips backgrounds of boxes covering more than half the screen (the gray slab).
  - The panel follows the head closely at eye level (`config.hud`).
  - The laser only counts real controls as hits. Before, pointing ahead "hit" the gray container, which paused the hand aim: a big part of the "aim is off" report.

## v0.8.0

- **Real item names**, from the user's 0.7.9 debug report (`dump()` lists the local player's fields):
  - `javelinMesh`, `bananarangMesh`, `singularityGrenadeMesh`, `stickyBombMesh`, `spellbookMesh`, `dodgeballMesh`
  - `pistonMesh`, `scytheMesh`, `physicsCannonMesh`, `bearTrapHeldMesh`, `sniperRifleMesh`, `harpoonVisual`, `laserbeamOrb`
  - Items under an arm, or under another item, are skipped (they already follow). Items are also kept visible by `hideBody`.
- **Hand aim converges.** The game's aim starts at the body, so the mod steers it through the point where the hand's ray meets the ground, or `aimDistance` (10 m) out.
  - `aimLaser` draws a thin red line from the aim hand.
  - Setup page "Aim with" has three options: right hand, left hand (`aimHand: 'left'`), or mouse.
- **Skinned-mesh render crash** (`applyBoneTransform` / `getX` in `computeBoundingSphere`): on that error, culling is turned off for the offending skinned meshes and the frame is retried.
- **Text-box release** no longer touches `<select>`s, or anything within 8 s of using the menu panel. It used to fight the sandbox cheat menu.
- **The game also has its own first-person mode**, which the mod doesn't use yet:
  - fields `firstPerson*`, `firstPersonHeldMesh*`, `scytheHandLocalPosition`, `spellbookHandLocalPosition`, `scytheGripOffset`
  - account setting `fister-camera-perspective`
  - These may give a better grip for items later.

## v0.7.8 – v0.7.9

- Hands are always mirrored side to side so the claws face outward (the game's model was showing them inside). There's no option for this.
- Held items: `holdItems()` follows the player fields FisterQoL also uses (`scytheMesh`, `pistonMesh`, `carMesh`, `tankMesh`, `laserbeamOrb`, `firstPersonWeaponRoot`).
  - Each item keeps its offset from the arm *as the game saw it* that frame, applied to your VR arm. It inherits the arm's size and mirroring.
  - `armSizeSeen` corrects the item size when the game doesn't reset the arm's scale.
  - Items more than 0.6 m from the game's hand, and the first-person weapon, are put directly at the hand, facing where the controller points.
  - Objects outside the scene (e.g. on the game camera) are moved into the scene while in VR and put back afterwards.
- `gamePose()` / `notePoseWritten()`: if the game didn't set an object's pose again since we wrote it, its last pose is restored before we work from it. This is checked per part (position, rotation, scale).
- Item names and how the game attaches items are unverified on the real game.

## Status / open items (as of v0.7.7)

- v0.7.7 fixes, found from a Quest video:
  - **Hands and aim dead after starting from the main menu.** three.js only tracks controllers it saw arrive through `inputsourceschange`, and after the menu-only hand-off they had already arrived. `adoptControllers` now replays that event once per session.
  - **Pointer lock.** The spoofed lock reports the element the game actually asked to lock (`state.lockTarget`), not always the canvas. It is also active in menu-only VR.
  - **Focused text boxes.** A text box left focused after a menu click (name, lobby code, chat) would swallow W/A/S/D. It is released on entering gameplay.
  - **Clicks.** The trigger now ends with a `click` event.
- Debug console:
  - It is anchored to the top of the page; on the Quest its buttons were off-screen.
  - There are Copy all buttons at the top and bottom, plus COPY LOG next to VR INFO.
  - If the clipboard is blocked, the report appears in a selected text box.
  - A new "Input:" line shows where keys go, the focused element, the lock target and the keys held.
- HUD repaint in a match is rarer (the Quest measured about 67 ms per paint).
- The Quest ran at about 13 fps (77 ms frames, only 8 ms of it the mod's own work). If that persists, try a lower framebufferScale.
- Not yet verified on a real Quest. The next report should include COPY LOG output.
