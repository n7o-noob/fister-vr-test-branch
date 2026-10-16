# Tests

Stand-in "games" built on three.js that mimic Fister's structure (player map
with head/arms, Win95-style HUD, pause menu, pointer-lock mouse look,
ragdolls, player-list rebuilds), plus Playwright scripts that drive the VR
layer through simulated XR frames.

They are for development only. To run them:

1. `npm i playwright three`, then copy `node_modules/three/build/three.module.js`
   and `three.core.js` into `test/site/`.
2. `node tools/build.cjs` (the tests load `dist/fister-vr.bookmarklet.txt`).
3. `node test/run12.cjs` (menus, aim, layers), `node test/run11.cjs` (black-flash
   fixes), `node test/run8.cjs` (walking / player rebuild), and so on.

- `node test/run13.cjs`: menu-only VR before the game renders, then hand-off to the game (uses `xr-mock.js`, a fake WebXR headset).
- `node test/run14.cjs`: normal VR session through three.js's real XR code, including hand aim.
- `node test/run15.cjs`: main menu with no 3D objects (menu-only VR), clicks through WebXR select events, timers, then the panel and controller boxes appearing in the match.
- `node test/run16.cjs`: enter VR from the main menu, game captures the mouse on `<body>`, a text box left focused: movement and hand aim must still reach the game after the hand-off; console Copy all.
- `node test/run17.cjs` (and `ANIMALL=1 node test/run17.cjs`): power-up items follow the VR hand and scale with it, both when the game re-poses the arm every frame and when it doesn't; a first-person weapon on the game camera is moved into the scene at your hand.
- `node test/run18.cjs`: hand aim converges on the spot the hand points at (floor hit or 10 m out), the aim line sits on the hand, and left-hand aim works.
- `node test/run19.cjs`: third-person camera (~8 m behind, like Fister's): its crosshair ray passes through what the hand points at (a wall, the ground); the in-match HUD paints see-through, without full-screen backgrounds.
- `node test/run20.cjs`: clip view while a recorder takes frames in VR (first-person headset view at clip size, saved to `test/clip-frame.png`), nothing rendered when not recording, right stick click sends the clip key from a stand-in FisterQoL bridge.
- `node test/run23.cjs`: setup page "Fister VR + FisterQoL" option: generates the bookmarklet, runs it on a stand-in fister.fun home page (FisterQoL hook installed, VR layer injected with the page's settings, Enter VR), plus the "already running" and "game already loading" messages.
- `node test/run24.cjs`: save-clip button feedback: an old saved `right.thumbstick: null` becomes the clip button, and the on-screen message for saving, clip recording off, no Save clip key, and FisterQoL not loaded.
- `node test/run25.cjs`: reload loops with the FisterQoL bookmarklet: a game that adds a query parameter, reloads once, reloads every time (loader gives up after 3 with a banner and keeps the game running), goes to another page, or reloads on a service-worker change.
- `node test/run26.cjs`: a fister.fun-like Content-Security-Policy that blocks inline scripts, as an HTTP header and as a `<meta>` tag: FisterQoL must start in the frame (frame hosted on a policy-free same-origin file) and VR must work.
- `node test/run27.cjs`: like run19, but the fake headset offers WebXR Layers (`window.__xrMockLayers = true`), as the Quest Browser does: three.js draws into a projection layer and the direct-drawn HUD must land in it (`__xrMock.layerImage()` reads the layer back as a PNG).
- `node test/run28.cjs`: virtual 1920x1080 screen. In VR, fixed elements anchor to a 1920x1080 box, `vw`/`vh` rules become 1080p pixels (`#vwbox` in game3), width/height media rules are decided for 1920x1080, scripts see `innerWidth/innerHeight` 1920x1080, and the panel canvas is 16:9. Leaving VR restores all of it. Writes the panel image to `$SHOT`.
- `node test/run29.cjs`: left X holds E (the stand-in's emote wheel opens and frees the mouse), the laser picks an emote, E is released, the view uses the game's third-person camera while emoting and returns after; mid-jump the aim uses the real floor.
- `node test/run30.cjs`: page mirror and clip view on a Quest-like headset (layers, 1280x587 window, virtual screen, a game that follows `resize`). The flat page shows the headset view over the whole 1920x1080 screen right after the game canvas (overlays stay on top), refreshed slowly when not recording; clip frames are 16:9 and `clipRect()` is the virtual screen; with copies of the WebGL canvas forced black (the Quest's behaviour) the clip view switches to GPU read-back (async when three.js has `readRenderTargetPixelsAsync`; `SYNC=1` tests the direct fallback); the mirror is removed when VR ends. Page screenshot to `$SHOT` (default `test/run30-page.png`).
- `node test/run31.cjs`: main menu drawn through an offscreen buffer (`game2.html?composite`: menu scene into a 960x540 target, orthographic copy to the screen, a dark scissored avatar preview drawn straight to the screen on some frames, with more objects than the menu so it wins the camera pick). The headset must show the menu scene, not the preview's dark background; "Renders/s:" reports the insets skipped and offscreen views shown. Layer image to `$SHOT` (default `test/run31-layer.png`).
- `node test/run32.cjs`: ENTER VR on a menu with a separate loadout-preview renderer (45% of the screen, drawing every frame) while the main game draws nothing (`game2.html?norender`, attached late). VR must start menu-only (not on the preview), the panel must show the preview (snapshots), and the headset must move to the game renderer once the match draws the player's scene. Panel image to `$SHOT` (default `test/run32-panel.png`).
- `node test/run33.cjs` (layers mock): map loading. The game stops drawing and its old scene throws when drawn; the mod repeats the last view only briefly, catches the failure, shows the panel alone, and resumes. Then `WEBGL_lose_context` ends the VR session cleanly.
- `SEAL_PASSWORD=<pw> node test/run40-seal.cjs` (test branch only): password gate rejects a wrong password and reveals the page on the right one; Copy emits a sealed bookmarklet with no raw code in it; it runs only with the password; the static `dist/*.sealed.bookmarklet.txt` runs too.
