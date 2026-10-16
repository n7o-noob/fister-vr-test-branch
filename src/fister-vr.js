// ==UserScript==
// @name         Fister VR (WebXR layer)
// @namespace    fister-vr.local
// @version      0.9.13
// @description  Experimental WebXR / SteamVR layer for Fister: Enter VR button, first-person lock, 1:1 headset tracking, 6DoF controllers.
// @match        https://fister.fun/*
// @match        https://www.fister.fun/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
// ==/UserScript==
//
// Works two ways:
//   1. Browser: install as a Tampermonkey/Violentmonkey userscript (Chrome/Edge on Windows + SteamVR).
//   2. Steam client: dist/main.js + dist/preload.js inject this file into the page when launched with --vr.
//   3. Quest Browser: run as a bookmarklet while the game is already open (late attach, see 1b below).
//
// The game's code is served live from fister.fun as an obfuscated bundle, so this layer does not edit that
// bundle. It hooks Three.js itself from the outside:
//   - every WebGLRenderer sets `this.isWebGLRenderer = true` in its constructor -> captured with a one-shot
//     Object.prototype setter, then `renderer.xr.enabled = true` is applied right after construction;
//   - the game's scene wrapper assigns `this.renderer = <WebGLRenderer>` -> captured the same way, which gives
//     us `gameScene.camera`, `gameScene.players`, `gameScene.localPlayerId` (names confirmed from FisterQoL);
//   - `renderer.render(scene, camera)` is wrapped per instance; while `renderer.xr.isPresenting` is true the
//     main view is re-rendered through an XR rig that sits on the first-person viewpoint.
// Anything that depends on game internals I could not see (first-person toggle name, arm rig, key bindings)
// is auto-detected where possible, logged, and overridable from the console via `fisterVR`.

(() => {
  'use strict';
  const VERSION = '0.9.13';
  const root = globalThis;
  if (root.fisterVR) return;

  // ---------------------------------------------------------------------------------------------------------
  // Config (persisted per browser profile; edit live with fisterVR.config.* then fisterVR.saveConfig())
  // ---------------------------------------------------------------------------------------------------------
  const DEFAULT_CONFIG = {
    worldScale: 1,              // >1 makes you feel bigger. Game units are assumed to be ~metres.
    referenceSpace: 'local',    // 'local' = seated/standing origin at your head at session start.
    anchor: 'auto',             // 'auto' | 'head' | 'camera'. auto: local avatar head if found, else game camera.
    hideLocalHead: true,        // hide your own avatar's head mesh while anchored inside it.
    disableScreenShake: true,   // camera shake in VR causes motion sickness.
    // First-person POV toggle. Leave path null to auto-detect. Path is relative to the game scene object,
    // e.g. 'firstPerson' or 'cameraController.mode'. `value` is what "ON" means (true, 'first', 1, ...).
    firstPerson: { path: null, value: true },
    // Controller boxes
    controllerBoxes: true,
    boxSize: [0.05, 0.05, 0.12],
    boxScale: 1,                  // controller box size multiplier; 0 hides them
    armScale: 1,                  // your arms' size in VR (visual, only you see it); e.g. 0.5 = half size
    boxColors: { left: 0x35c4ff, right: 0xff5a5a, none: 0xffffff },
    // Arms (visual, client-side): 'aim' = each arm stays on its shoulder and points at its controller,
    // 'hand' = the arm's hand end sits on the controller, 'off' = game animation only.
    armMode: 'hand',
    swapArms: true,
    // 'hand' arm mode: where the hands sit relative to the controllers, in metres, in your facing direction.
    // forward pushes them out in front of you, inward pulls them toward your centre line.
    handOffset: { forward: 0.15, inward: 0.06, up: 0 },
    // Hide your own torso and legs (and clothing/cosmetics on them) in the headset. Head, arms and held items stay.
    hideBody: true,
    // Power-up items (scythe, piston, car, tank, laser orb, first-person weapon) follow your VR hands.
    holdItems: true,
    armOverride: true,            // legacy switch; false behaves like armMode 'off'
    armAxis: 'auto',              // arm mesh's long axis toward the hand: 'auto' | '-y' | 'y' | '-z' | 'z' | '-x' | 'x'
    armRotationOffsetDeg: [0, 0, 0],
    // Aim (Vivecraft-style): 'hand' steers the game's own aim (mouse look, which the server sees) toward where
    // the right controller points; your view comes only from the headset. 'head' = old behaviour (mouse aims).
    aimMode: 'hand',
    aimHand: 'right',             // 'right' | 'left': the hand you aim (and click menus) with
    // The game's aim starts at your body; we turn it so it passes through the spot your hand's ray points at:
    // where the ray meets the ground, or this many metres out. A line from the hand shows that ray.
    aimDistance: 10,
    aimLaser: true,
    // Where the game's aim ray starts. The server (fister-community-server, getChunkThrowVelocity) aims from the
    // player's shoulder: body position + 0.2 (mesh root offset) + 1, along the look yaw/pitch. 'camera' is the old guess.
    aimOrigin: 'shoulder',
    // The game's menus and HUD are shown on a floating 16:9 screen. While in VR the page is laid out as if on a
    // 1920x1080 monitor (the Quest Browser window is a short 1280x587), so the UI keeps its desktop proportions and
    // positions. screen: how far away and how wide (metres) the floating screen is.
    virtualScreen: true,
    screen: { distance: 2.0, width: 2.5 },
    uiOpacity: 0.9,               // 0.2-1: how see-through the floating screen is
    // In-match HUD panel (health, style, scoreboard): distance and width in metres, and how far below eye level.
    // pull: how far widgets are moved in toward the centre of view (1 = where the page has them, 0 = all in the middle);
    // grow: how much bigger they're drawn.
    hud: { distance: 1.5, width: 2.0, drop: 0.05, pull: 0.5, grow: 1.4 },
    aimGain: 0.6,                 // fraction of the remaining angle corrected per frame
    aimDeadzoneDeg: 0.4,
    aimPitch: true,
    // Head-locked copy of the game's 2D interface (HUD, menus) with a laser pointer on the aim hand.
    // The game's menus and HUD on a panel in front of your body. mode 'body' or 'off'. Sizes in metres.
    menu: { mode: 'body', distance: 1.4, width: 1.6, drop: 0.15, tiltDeg: 8, followDeg: 35, maxFps: 12, resolution: 1600 },
    spoofPointerLock: true,       // tell the game the mouse is captured while in VR (needed for aim to reach it)
    // Head mode: raise the eyes above the avatar head's centre (metres; scaled with worldScale).
    eyeOffset: { up: 0.1, forward: 0 },
    // Hide glowing/inverted outline meshes (power-ups etc.) that render as black boxes in the headset.
    // 'world' = everything except player avatars, 'all', or 'off'.
    hideOutlines: 'world',
    // Input mapping. Buttons use the WebXR 'xr-standard' gamepad layout.
    // Targets: { mouse: 0|1|2 } | { key: 'KeyCode' } | 'recenter'. Defaults are GUESSES; rebind to match your
    // in-game controls (Settings > Controls).
    buttons: {
      'right.trigger': { mouse: 0 },
      'left.trigger': { mouse: 0 },
      'right.squeeze': { mouse: 2 },
      'left.squeeze': { mouse: 2 },
      'right.a': { key: 'KeyV' },   // voice chat (hold to talk)
      'right.b': 'refocus',      // wakes game input if it stops responding
      'left.x': 'emote',          // holds E (the emote wheel) until you pick an emote with the laser
      'left.y': { key: 'Escape' },
      'left.thumbstick': 'recenter',
      'right.thumbstick': 'clip', // save a clip, using the game's own clip key (FisterQoL build)
    },
    emoteKey: 'KeyE',             // the game's emote wheel key ('emote' button action holds it)
    moveStick: 'left',            // stick that sends WASD
    moveThreshold: 0.45,
    turnStick: 'right',           // stick that sends mouse X movement (turning)
    turnMode: 'snap',             // 'snap' | 'smooth' | 'rig' | 'off'. 'rig' turns only your view (use if the
                                  // game ignores the fake mouse movement, e.g. without pointer lock).
    rigSnapDegrees: 30,
    framebufferScale: 1,          // headset render resolution; try 0.7 on Quest 2 if it stutters
    snapTurnPixels: 250,          // mouse movementX sent per snap; tune to your in-game sensitivity
    smoothTurnPixelsPerFrame: 12,
    showStatus: true,
    showButton: true,             // ENTER VR / VR INFO / COPY LOG buttons on the page (FisterQoL also has them in settings)
    // Clips (FisterQoL build): while the game is recording a clip, a first-person view from the headset is rendered at clip
    // size and handed to the clip recorder, so clips taken in VR show what you saw instead of a frozen flat frame.
    clipView: 'headset',          // 'headset' | 'off'
    clipHeight: 720,              // pixel height of that view (the width follows your screen's shape)
    clipFov: 90,                  // vertical field of view, degrees
    clipSmoothing: 0.6,           // 0 = raw head motion, 0.9 = very steady
    // 'auto': copy the view from the game canvas, and switch to reading it back from the GPU if those copies come out
    // black (seen on the Quest). 'canvas' or 'readback' forces one.
    clipMethod: 'auto',
    clipReadbackHeight: 480,      // pixel height when reading back (each frame stalls the GPU a little; smaller is cheaper)
    // The flat page (what the Quest Browser shows behind the headset, and what clips are built from) stops updating in
    // VR. The page mirror shows the clip view full-screen under the game's own overlays instead of a black canvas.
    pageMirror: true,
    pageMirrorFps: 5,             // refresh rate of the mirror while no clip is being recorded (recording: every frame)
    // When the headset moves from menu-only VR to the game's renderer: 'match' = once the game draws the scene your
    // player is in, full-screen (menus with 3D previews stay menu-only); 'any' = the first big scene (before 0.9.13).
    handOff: 'match',
  };

  const CONFIG_KEY = 'fister-vr-config';
  const config = (() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {}; } catch { saved = {}; }
    // Settings baked into a bookmarklet (no console on Quest) win over saved ones.
    const baked = (root.__fisterVrConfigOverrides && typeof root.__fisterVrConfigOverrides === 'object') ? root.__fisterVrConfigOverrides : {};
    const merged = { ...DEFAULT_CONFIG, ...saved, ...baked };
    merged.firstPerson = { ...DEFAULT_CONFIG.firstPerson, ...(saved.firstPerson || {}), ...(baked.firstPerson || {}) };
    merged.buttons = { ...DEFAULT_CONFIG.buttons, ...(saved.buttons || {}), ...(baked.buttons || {}) };
    // 0.9.10: X opens the emote wheel instead of jumping. Older saved settings still have Space there.
    const lx = merged.buttons['left.x'];
    if (lx && typeof lx === 'object' && lx.key === 'Space' && !(baked.buttons && baked.buttons['left.x'])) merged.buttons['left.x'] = 'emote';
    // Before 0.9 the right stick click did nothing, and that `null` may be in saved settings. Give it the save-clip
    // action unless you picked something for it (QoL > VR sets clipButtonChosen) or another button already has it.
    if (!saved.clipButtonChosen && !(baked.buttons && 'right.thumbstick' in baked.buttons) && merged.buttons['right.thumbstick'] == null
        && !Object.values(merged.buttons).includes('clip')) merged.buttons['right.thumbstick'] = 'clip';
    merged.boxColors = { ...DEFAULT_CONFIG.boxColors, ...(saved.boxColors || {}), ...(baked.boxColors || {}) };
    merged.menu = { ...DEFAULT_CONFIG.menu, ...(saved.menu || {}), ...(baked.menu || {}) };
    merged.eyeOffset = { ...DEFAULT_CONFIG.eyeOffset, ...(saved.eyeOffset || {}), ...(baked.eyeOffset || {}) };
    merged.hud = { ...DEFAULT_CONFIG.hud, ...(saved.hud || {}), ...(baked.hud || {}) };
    merged.screen = { ...DEFAULT_CONFIG.screen, ...(saved.screen || {}), ...(baked.screen || {}) };
    merged.handOffset = { ...DEFAULT_CONFIG.handOffset, ...(saved.handOffset || {}), ...(baked.handOffset || {}) };
    if (merged.armOverride === false) merged.armMode = 'off';
    return merged;
  })();
  function saveConfig() {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); return true; } catch { return false; }
  }

  // Everything the mod (and the game) logs is kept in a ring buffer for the in-page / in-headset console.
  const nativeConsole = { info: console.info.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
  const logBuffer = [];
  let logListener = null;
  const stringify = (a) => {
    if (a instanceof Error) return a.stack || a.message || String(a);
    if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  };
  function record(level, args) {
    const msg = args.map(stringify).join(' ').slice(0, 800);
    const last = logBuffer[logBuffer.length - 1];
    if (last && last.msg === msg && last.level === level) { last.count++; last.t = performance.now(); }
    else { logBuffer.push({ t: performance.now(), level, msg, count: 1 }); if (logBuffer.length > 400) logBuffer.shift(); }
    if (logListener) logListener();
  }
  const log = (...args) => { record('info', args); nativeConsole.info('[Fister VR]', ...args); };
  const warn = (...args) => { record('warn', args); nativeConsole.warn('[Fister VR]', ...args); };
  console.warn = (...args) => { record('game-warn', args); nativeConsole.warn(...args); };
  console.error = (...args) => { record('game-error', args); nativeConsole.error(...args); };
  root.addEventListener('error', (e) => record('page-error', [e.message + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '')]));
  root.addEventListener('unhandledrejection', (e) => record('page-error', ['Unhandled promise: ', e.reason]));
  // Each VR feature runs isolated: one failing (e.g. arms) must not take down the headset view.
  const featureErrors = {};
  function safe(name, fn) {
    try { return fn(); }
    catch (error) {
      const count = featureErrors[name] = (featureErrors[name] || 0) + 1;
      if (count === 1 || count % 600 === 0) { record('error', [name + ' failed (' + count + 'x):', error]); nativeConsole.error('[Fister VR]', name, error); }
      return undefined;
    }
  }
  const warned = new Set();
  const warnOnce = (key, ...args) => { if (!warned.has(key)) { warned.add(key); warn(...args); } };

  // ---------------------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------------------
  const state = {
    renderers: new Set(),
    lateScene: null,         // stand-in scene from the Map probe when attached late
    menu: null,              // VR menu panel
    uiHit: null,             // where the right-hand laser meets the menu panel
    uiPress: null,
    pointerLockReleased: false,
    handBaseYaw: null,       // view yaw anchor in 'hand' aim mode
    aim: { ratioX: -0.0022, ratioY: -0.0022, lastDx: 0, lastDy: 0, lastYaw: null, lastPitch: null, flipX: 0, flipY: 0, stuck: 0 },
    focusTimer: 0,
    rigTurn: 0,              // radians, view-only turning (turnMode 'rig')
    renderer: null,          // renderer bound to the VR session
    gameScene: null,         // the game's scene wrapper (has .renderer/.camera/.players/.localPlayerId)
    sceneCandidates: [],
    threeScene: null,        // THREE.Scene last rendered with the main camera
    gameCamera: null,        // the game's main PerspectiveCamera
    cameraStats: new Map(),  // camera -> { count, renderer, scene }
    classes: null,           // harvested Three.js constructors
    rig: null,               // Object3D that follows the first-person viewpoint
    view: null,              // PerspectiveCamera child of rig handed to three's XR manager
    controllers: [],         // [{ index, group, box, handedness, source }]
    headOffset: null,        // Vector3, reference-space head position at last recenter
    yawOffset: 0,            // radians, reference-space head yaw at last recenter
    pendingRecenter: false,
    presenting: false,
    redirectRaf: false,
    rafQueue: new Map(),
    rafSeq: 0x40000000,
    gameAnimationLoop: new WeakMap(), // renderer -> game's own setAnimationLoop callback, if any
    xrTarget: null,
    canvasSnaps: new WeakMap(),
    renderStats: { screen: 0, inset: 0, offscreen: 0, flat: 0, used: 0, insetSize: '', offscreenSize: '', flatCamera: '', since: 0 },
    renderRate: null,
    xrFrameNo: 0,
    mainRendered: false,
    fp: null,                // { owner, key, previous, label }
    hiddenHead: null,
    shake: null,
    buttonsDown: new Map(),
    keysDown: new Set(),
    turnLatched: false,
    statusEl: null,
    buttonEl: null,
  };

  // ---------------------------------------------------------------------------------------------------------
  // 1. Capture Three.js renderers and the game's scene wrapper
  // ---------------------------------------------------------------------------------------------------------
  // Transparent Object.prototype setters: the first assignment of `name` on any object defines a normal own
  // property (exactly what the assignment would have done) and lets us look at the object.
  function installTrap(name, onAssign) {
    const descriptor = {
      configurable: true,
      enumerable: false,
      get() { return undefined; },
      set(value) {
        if (Object(this) !== this || !Object.isExtensible(this)) return;
        Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true });
        try { onAssign(this, value); } catch (error) { warnOnce('trap-' + name, 'hook error', error); }
      },
    };
    Object.defineProperty(Object.prototype, name, descriptor);
    return () => {
      const current = Object.getOwnPropertyDescriptor(Object.prototype, name);
      if (current && current.set === descriptor.set) delete Object.prototype[name];
    };
  }

  installTrap('isWebGLRenderer', (renderer, value) => {
    if (value !== true) return;
    // The constructor is still running; finish setup once it returns.
    queueMicrotask(() => captureRenderer(renderer));
  });

  const removeSceneTrap = installTrap('renderer', (owner, value) => {
    if (!value || value.isWebGLRenderer !== true) return;
    captureGameScene(owner, 'renderer assignment');
  });
  // Don't leave a global `'renderer' in obj` trap around forever.
  setTimeout(removeSceneTrap, 10 * 60 * 1000);

  // Several objects get a `.renderer` (the game scene, but also e.g. an EffectComposer). Keep them all and
  // pick the one that looks like the game scene when it is needed.
  function captureGameScene(owner, how) {
    if (state.sceneCandidates.includes(owner)) return;
    state.sceneCandidates.push(owner);
    if (state.sceneCandidates.length > 24) state.sceneCandidates.shift();
    log('Scene candidate captured via ' + how + '.');
  }

  function gameScene() {
    if (state.gameScene) return state.gameScene;
    const looksLikeGame = (c) => c && c.camera && c.camera.isCamera === true && ('players' in c || 'localPlayerId' in c);
    const found = state.sceneCandidates.find(looksLikeGame);
    if (found) {
      state.gameScene = found;
      removeSceneTrap();
      removeMapProbe();
      log('Game scene identified.');
      detectFirstPerson(true);
    }
    // Late attach (bookmarklet): the scene was built before we loaded. Use what the Map probe found.
    return state.gameScene || state.lateScene;
  }

  // ---------------------------------------------------------------------------------------------------------
  // 1b. Late attach (Quest Browser bookmarklet): the game is already running when this loads, so the
  //     constructor hooks above never fire. Three.js reads `camera.isArrayCamera` while rendering; a normal
  //     camera doesn't own that property, so the lookup reaches Object.prototype and hands us the camera.
  //     From the camera's prototype chain we briefly patch Object3D.prototype.onBeforeRender, which
  //     WebGLRenderer.render calls as scene.onBeforeRender(renderer, scene, camera) -> renderer + scene.
  // ---------------------------------------------------------------------------------------------------------
  let lateObject3DProto = null, lateOriginalOnBeforeRender = null;
  const lateGetter = function () {
    try { if (this && this.isCamera === true && wantRendererProbe()) armLateRendererProbe(this); } catch {}
    return undefined;
  };
  Object.defineProperty(Object.prototype, 'isArrayCamera', { configurable: true, enumerable: false, get: lateGetter, set(value) {
    if (Object(this) === this && Object.isExtensible(this)) Object.defineProperty(this, 'isArrayCamera', { value, writable: true, enumerable: true, configurable: true });
  } });
  function removeLateCameraProbe() {
    const current = Object.getOwnPropertyDescriptor(Object.prototype, 'isArrayCamera');
    if (current && current.get === lateGetter) delete Object.prototype.isArrayCamera;
  }

  // The game's main renderer draws to a big on-screen canvas; small ones (avatar previews) don't count.
  // The real window size, even while the virtual screen reports 1920x1080 to the game.
  const winSize = (() => {
    const d = (k) => Object.getOwnPropertyDescriptor(window, k) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), k);
    const w = d('innerWidth'), h = d('innerHeight');
    return () => ({ w: (w && w.get ? w.get.call(window) : window.innerWidth) || 1280, h: (h && h.get ? h.get.call(window) : window.innerHeight) || 720 });
  })();
  // Share of the screen a renderer's canvas covers, in CSS px (with the virtual screen on: of 1920x1080, or of the
  // real window for a canvas that kept its pre-VR size).
  function canvasCoverage(renderer) {
    const c = renderer && renderer.domElement;
    if (!c || !c.isConnected) return 0;
    const win = winSize(), area = c.clientWidth * c.clientHeight;
    // A game that doesn't follow the virtual screen's resize keeps a window-sized canvas: that counts as full too.
    const ofWindow = area / (win.w * win.h);
    return state.vscreen ? Math.max(area / (VSCREEN_W * VSCREEN_H), Math.min(ofWindow, 1)) : ofWindow;
  }
  function isMainRenderer(renderer) { return canvasCoverage(renderer) > 0.3; }
  // The scene our own player is in, if any: proof that a match (or training) is on, not a menu.
  function localPlayerScene() {
    const player = localPlayer();
    const head = player && player.head && player.head.isObject3D ? player.head : null;
    if (!head || player.removed) return null;
    const root = sceneRoot(head);
    return root && root.isScene === true ? root : null;
  }
  // Give the headset to the game's renderer only when it draws the match full-screen. On menus Fister's 3D views are
  // cosmetic/loadout previews (several renderers); handing them the session left the headset black (0.9.12 report).
  function readyForGameView(renderer, scene) {
    if (config.handOff === 'any') return isMainRenderer(renderer) && !!scene && sceneHasBuildingBlocks(scene);
    const playerScene = localPlayerScene();
    return !!playerScene && scene === playerScene && canvasCoverage(renderer) > 0.6;
  }
  function hasMainRenderer() { for (const r of state.renderers) if (isMainRenderer(r)) return true; return false; }
  // Keep looking for renderers until one draws full-screen, and all through menu-only VR (the match's renderer may be
  // new, or one that hasn't drawn since we attached; a big loadout preview used to stop the search).
  // Read on every camera.isArrayCamera lookup (many per frame), so the answer is cached for half a second.
  let probeWanted = true, probeCheckedAt = -Infinity;
  function wantRendererProbe() {
    const now = performance.now();
    if (now - probeCheckedAt < 500) return probeWanted;
    probeCheckedAt = now;
    probeWanted = !!(state.standalone && !state.standalone.handedOff);
    if (!probeWanted) { probeWanted = true; for (const r of state.renderers) if (canvasCoverage(r) > 0.6) { probeWanted = false; break; } }
    return probeWanted;
  }

  function armLateRendererProbe(camera) {
    if (lateObject3DProto) return;
    let proto = Object.getPrototypeOf(camera);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'onBeforeRender')) proto = Object.getPrototypeOf(proto);
    if (!proto || typeof proto.onBeforeRender !== 'function') return;
    lateObject3DProto = proto;
    lateOriginalOnBeforeRender = proto.onBeforeRender;
    proto.onBeforeRender = function fisterVrProbe(renderer, scene, cam) {
      if (renderer && renderer.isWebGLRenderer === true && scene && scene.isScene === true) {
        proto.onBeforeRender = lateOriginalOnBeforeRender; // restore at once
        lateObject3DProto = null; // may re-arm if this wasn't the main renderer
        log('Late attach: renderer found from a running frame.');
        captureRenderer(renderer);
        noteRender(renderer, scene, cam);
      }
      return lateOriginalOnBeforeRender.apply(this, arguments);
    };
  }

  // The game keeps players in a Map (FisterQoL iterates scene.players.values() and reads player.head /
  // leftArm / rightArm). Watch Map lookups until a map of player-like objects shows up.
  const MapProto = Map.prototype;
  const nativeMapGet = MapProto.get, nativeMapValues = MapProto.values, nativeMapForEach = MapProto.forEach;
  const isPlayerLike = (v) => v && typeof v === 'object' && v.head && v.head.isObject3D === true
    && ((v.leftArm && v.leftArm.isObject3D) || (v.rightArm && v.rightArm.isObject3D));
  const isLocalPlayerObj = (p) => !!p && ((typeof p.isLocalPlayer === 'function' && (() => { try { return p.isLocalPlayer(); } catch { return false; } })()) || p.isLocal === true);
  const wantsPlayers = () => !state.gameScene && (!state.lateScene || state.reprobe);
  function inspectPlayers(map) {
    if (!wantsPlayers()) return;
    if (state.lateScene && state.lateScene.players === map) return;
    let first;
    try { first = nativeMapValues.call(map).next().value; } catch { return; }
    if (!isPlayerLike(first)) return;
    let hasLocal = false;
    for (const value of nativeMapValues.call(map)) if (isLocalPlayerObj(value)) { hasLocal = true; break; }
    if (state.reprobe && !hasLocal) return; // when replacing a stale list, only accept one that contains us
    // Prefer a real scene wrapper referenced from a player; otherwise build a minimal stand-in.
    let owner = null;
    for (const value of nativeMapValues.call(map)) {
      for (const key of Object.keys(value)) {
        const ref = value[key];
        if (ref && typeof ref === 'object' && ref.renderer && ref.renderer.isWebGLRenderer === true && ref.players === map) { owner = ref; break; }
      }
      if (owner) break;
    }
    if (owner) captureGameScene(owner, 'player map');
    state.lateScene = owner || { players: map, get camera() { return state.gameCamera; }, get renderer() { return state.renderer; } };
    log((state.reprobe ? 'Player list replaced' : 'Players found') + ' via Map lookups' + (owner ? ' (with game scene)' : '') + (hasLocal ? '; local player present.' : '.'));
    state.reprobe = false;
    removeMapProbe();
  }
  function installMapProbe() {
    MapProto.get = function get(key) {
      const value = nativeMapGet.call(this, key);
      if (wantsPlayers() && isPlayerLike(value)) inspectPlayers(this);
      return value;
    };
    MapProto.values = function values() { if (wantsPlayers()) inspectPlayers(this); return nativeMapValues.call(this); };
    MapProto.forEach = function forEach(callback, thisArg) { if (wantsPlayers()) inspectPlayers(this); return nativeMapForEach.call(this, callback, thisArg); };
  }
  function removeMapProbe() {
    if (MapProto.get !== nativeMapGet) MapProto.get = nativeMapGet;
    if (MapProto.values !== nativeMapValues) MapProto.values = nativeMapValues;
    if (MapProto.forEach !== nativeMapForEach) MapProto.forEach = nativeMapForEach;
  }
  installMapProbe();
  setTimeout(() => { if (!state.reprobe) removeMapProbe(); }, 5 * 60 * 1000);

  function captureRenderer(renderer) {
    if (state.renderers.has(renderer) || typeof renderer.render !== 'function' || !renderer.xr) return;
    state.renderers.add(renderer);

    // Step 1 of the brief: renderer.xr.enabled = true directly after the WebGLRenderer is created.
    renderer.xr.enabled = true;
    try { renderer.xr.setReferenceSpaceType(config.referenceSpace); } catch {}

    const originalRender = renderer.render;
    renderer.render = function fisterVrRender(scene, camera) {
      try {
        return renderThroughVr(this, originalRender, scene, camera);
      } catch (error) {
        // A skinned mesh without skin data can't be measured for culling (seen with some power-up models once they
        // come into view in the headset). Draw those without culling and try again.
        const now = performance.now();
        if (/applyBoneTransform|getX/.test(String(error && error.stack)) && scene && scene.traverse && now - (state.skinFixAt || 0) > 2000) {
          state.skinFixAt = now;
          let fixed = 0;
          scene.traverse((n) => {
            if (!n.isSkinnedMesh || !n.frustumCulled || n.boundingSphere) return;
            try { n.computeBoundingSphere(); } catch { n.frustumCulled = false; fixed++; }
          });
          log('Turned off culling for ' + fixed + ' skinned mesh(es) without skin data.');
          try { return renderThroughVr(this, originalRender, scene, camera); } catch {}
        }
        warnOnce('render', 'render hook failed, falling back to the original renderer', error);
        record('error', ['Headset render failed:', error]);
        return originalRender.call(this, scene, camera);
      }
    };
    renderer.__fisterVrOriginalRender = originalRender;

    // A colour clear after the headset view was drawn this frame would wipe it (black flash). Keep depth/stencil.
    const originalClear = renderer.clear;
    renderer.clear = function fisterVrClear(color = true, depth = true, stencil = true) {
      if (state.presenting && this === state.renderer && state.mainRendered && color && !state.clipRendering) {
        const target = this.getRenderTarget();
        if (target === null || target === state.xrTarget) {
          state.blockedClears = (state.blockedClears || 0) + 1;
          if (state.blockedClears === 1) log('Blocked a screen clear after the headset view was drawn (would flash black).');
          return originalClear.call(this, false, depth, stencil);
        }
      }
      return originalClear.call(this, color, depth, stencil);
    };

    const originalLoop = renderer.setAnimationLoop;
    renderer.setAnimationLoop = function fisterVrSetAnimationLoop(callback) {
      state.gameAnimationLoop.set(this, callback || null);
      if (state.presenting && this === state.renderer) return; // re-applied on session end
      return originalLoop.call(this, callback);
    };
    renderer.__fisterVrOriginalLoop = originalLoop;

    renderer.xr.addEventListener('sessionstart', () => onSessionStart(renderer));
    renderer.xr.addEventListener('sessionend', () => onSessionEnd(renderer));

    log('WebGLRenderer captured' + (isMainRenderer(renderer) ? ' (main game view)' : ' (small, not the game view)') + '; renderer.xr.enabled = true.');
    whenBody(ensureVrButton);
    // (hand-off from menu-only VR happens in the render hook, once the game draws a scene we can build objects in)
  }

  // ---------------------------------------------------------------------------------------------------------
  // rAF redirection: during an immersive session the game's frames must run inside XRSession rAF.
  // ---------------------------------------------------------------------------------------------------------
  // In VR a game's "request full screen" or "resume audio" can fail or hang without a real click; neither matters in
  // the headset, so don't let them block (e.g. a join-lobby button awaiting them).
  const nativeRequestFullscreen = Element.prototype.requestFullscreen;
  if (nativeRequestFullscreen) {
    Element.prototype.requestFullscreen = function requestFullscreen(...args) {
      if (state.presenting) return Promise.resolve();
      return nativeRequestFullscreen.apply(this, args);
    };
  }
  for (const Ctx of [root.AudioContext, root.webkitAudioContext]) {
    if (!Ctx || !Ctx.prototype.resume || Ctx.prototype.__fisterVrResume) continue;
    const nativeResume = Ctx.prototype.resume;
    Ctx.prototype.__fisterVrResume = true;
    Ctx.prototype.resume = function resume(...args) {
      const p = nativeResume.apply(this, args);
      if (!state.presenting) return p;
      return Promise.race([p, new Promise((r) => setTimeout(r, 400))]);
    };
  }

  // Timers: with the page hidden behind VR the browser slows setTimeout/setInterval to about once a second, so menus,
  // loading and lobby lists stall. While in VR we also run due timers every headset frame.
  const nativeSetTimeout = root.setTimeout.bind(root), nativeClearTimeout = root.clearTimeout.bind(root);
  const nativeSetInterval = root.setInterval.bind(root), nativeClearInterval = root.clearInterval.bind(root);
  const timers = new Map();
  let timerSeq = 0x50000000;
  function runTimer(id, early) {
    const t = timers.get(id);
    if (!t) return;
    const now = performance.now();
    if (t.interval && !early && now < t.due - 1) return; // native interval tick for a period we already ran
    if (t.interval) t.due = now + t.interval;
    else { timers.delete(id); if (early) nativeClearTimeout(t.native); }
    try { t.fn.apply(root, t.args); } catch (error) { record('page-error', ['Timer error:', error]); nativeConsole.error(error); }
  }
  root.setTimeout = function setTimeout(fn, delay, ...args) {
    if (typeof fn !== 'function') return nativeSetTimeout(fn, delay, ...args);
    const id = ++timerSeq, d = Math.max(0, Number(delay) || 0);
    const t = { fn, args, due: performance.now() + d, interval: 0, native: 0 };
    timers.set(id, t);
    t.native = nativeSetTimeout(() => runTimer(id, false), d);
    return id;
  };
  root.setInterval = function setInterval(fn, delay, ...args) {
    if (typeof fn !== 'function') return nativeSetInterval(fn, delay, ...args);
    const id = ++timerSeq, d = Math.max(4, Number(delay) || 0);
    const t = { fn, args, due: performance.now() + d, interval: d, native: 0 };
    timers.set(id, t);
    t.native = nativeSetInterval(() => runTimer(id, false), d);
    return id;
  };
  const clearAny = function clear(id) {
    const t = timers.get(id);
    if (t) { timers.delete(id); if (t.interval) nativeClearInterval(t.native); else nativeClearTimeout(t.native); return; }
    nativeClearTimeout(id); nativeClearInterval(id);
  };
  root.clearTimeout = clearAny;
  root.clearInterval = clearAny;
  function runDueTimers() {
    if (!state.presenting || !timers.size) return;
    const now = performance.now();
    let budget = 200;
    for (const [id, t] of timers) {
      if (t.due <= now) { runTimer(id, true); if (--budget <= 0) break; }
    }
  }

  const nativeRaf = root.requestAnimationFrame.bind(root);
  const nativeCaf = root.cancelAnimationFrame.bind(root);
  root.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!state.redirectRaf) return nativeRaf(callback);
    const id = ++state.rafSeq;
    state.rafQueue.set(id, callback);
    return id;
  };
  root.cancelAnimationFrame = function cancelAnimationFrame(id) {
    if (state.rafQueue.delete(id)) return;
    nativeCaf(id);
  };

  function xrFrame(renderer, time, frame) {
    if (state.inXrFrame) return; // never re-enter (a queued callback must not run another XR frame inside this one)
    state.inXrFrame = true;
    try { xrFrameBody(renderer, time, frame); } finally { state.inXrFrame = false; }
  }
  function xrFrameBody(renderer, time, frame) {
    state.xrFrameNo++;
    const rs = state.renderStats;
    if (!rs.since) rs.since = time;
    if (time - rs.since >= 1000) {
      const k = 1000 / (time - rs.since);
      state.renderRate = { screen: rs.screen * k, inset: rs.inset * k, offscreen: rs.offscreen * k, flat: rs.flat * k, used: rs.used * k, insetSize: rs.insetSize, offscreenSize: rs.offscreenSize, flatCamera: rs.flatCamera };
      Object.assign(rs, { screen: 0, inset: 0, offscreen: 0, flat: 0, used: 0, since: time });
    }
    safe('timers', runDueTimers);
    state.xrTarget = renderer.getRenderTarget();
    state.mainRendered = false;
    if (time - state.focusTimer > 2000) {
      state.focusTimer = time;
      if (!nativeHasFocus.call(document)) reassertFocus('timer');
    }
    if (state.lastXrTime) state.frameMs = state.frameMs ? state.frameMs * 0.9 + (time - state.lastXrTime) * 0.1 : time - state.lastXrTime;
    state.lastXrTime = time;
    safe('controller input', () => pollInput(frame));

    const gameLoop = state.gameAnimationLoop.get(renderer);
    if (gameLoop) {
      try { gameLoop(time, frame); } catch (error) { record('game-error', ['Game loop error:', error]); nativeConsole.error(error); }
    }
    const queue = state.rafQueue;
    state.rafQueue = new Map();
    for (const callback of queue.values()) {
      try { callback(time); } catch (error) { record('game-error', ['Game frame error:', error]); nativeConsole.error(error); }
    }
    // Nothing went to the screen, but the game drew a full-screen-shaped offscreen view (render scaling): show that.
    const off = state.offscreenView;
    if (!state.mainRendered && off && off.frame === state.xrFrameNo) {
      state.offscreenViews = (state.offscreenViews || 0) + 1;
      state.renderStats.used++;
      if (state.offscreenViews === 1) log('Headset view: the game draws this screen into an offscreen buffer (' + state.renderStats.offscreenSize + '); showing that.');
      safe('offscreen view', () => renderMain(renderer, renderer.__fisterVrOriginalRender, off.scene, off.camera));
    }
    // Frame pacers (the game's, or FisterQoL's FPS cap) may skip a frame. An XR frame with no draw shows black,
    // so repeat the last view instead.
    if (!state.mainRendered && state.threeScene && (state.frameCamera || state.gameCamera)) {
      state.repeats = (state.repeats || 0) + 1;
      state.repeating = true;
      try { renderMain(renderer, renderer.__fisterVrOriginalRender, state.threeScene, state.frameCamera || state.gameCamera); }
      finally { state.repeating = false; }
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // 2. First-person lock + headset binding
  // ---------------------------------------------------------------------------------------------------------
  function noteRender(renderer, scene, camera) {
    if (!scene || scene.isScene !== true || !camera || camera.isPerspectiveCamera !== true) return;
    const entry = state.cameraStats.get(camera);
    if (entry) { entry.count++; entry.renderer = renderer; entry.scene = scene; }
    else state.cameraStats.set(camera, { count: 1, renderer, scene });
    if (state.cameraStats.size > 32) state.cameraStats.clear();
  }

  // A WebGL canvas keeps no picture after its frame, so copy it right after the game draws (menu-only VR, for the
  // panel). At most at the panel's frame rate, and only for canvases on screen.
  function snapshotCanvas(renderer) {
    const c = renderer.domElement;
    if (!c || !c.isConnected || !c.width || !c.height) return;
    const now = performance.now();
    let snap = state.canvasSnaps.get(c);
    const gap = 1000 / Math.max(1, Number(config.menu.maxFps) || 12);
    if (snap && now - snap.at < gap) return;
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (!snap) { const canvas = document.createElement('canvas'); snap = { canvas, ctx: canvas.getContext('2d'), at: 0, ok: false }; state.canvasSnaps.set(c, snap); }
    if (!snap.ctx) return;
    const k = Math.min(1, 1024 / Math.max(c.width, c.height));
    const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
    if (snap.canvas.width !== w || snap.canvas.height !== h) { snap.canvas.width = w; snap.canvas.height = h; }
    snap.ctx.clearRect(0, 0, w, h);
    snap.ctx.drawImage(c, 0, 0, w, h);
    snap.at = now; snap.ok = true;
    if (state.menu) state.menu.dirty = true;
    if (state.standalone && state.standalone.menu) state.standalone.menu.dirty = true;
  }

  function canvasArea(renderer) {
    const canvas = renderer.domElement;
    return canvas && canvas.isConnected ? (canvas.clientWidth * canvas.clientHeight) || 1 : 0;
  }

  function pickMain() {
    const gs = gameScene();
    let renderer = gs && gs.renderer && state.renderers.has(gs.renderer) ? gs.renderer : null;
    let camera = gs && gs.camera && gs.camera.isCamera ? gs.camera : null;
    if (!camera || !renderer) {
      let best = null, bestScore = -1;
      for (const [cam, entry] of state.cameraStats) {
        if (renderer && entry.renderer !== renderer) continue;
        const score = entry.count * canvasArea(entry.renderer) * (1 + (entry.scene.children ? entry.scene.children.length : 0));
        if (score > bestScore) { best = [cam, entry]; bestScore = score; }
      }
      if (best) { camera = camera || best[0]; renderer = renderer || best[1].renderer; }
    }
    if (!renderer) {
      renderer = [...state.renderers].sort((a, b) => canvasArea(b) - canvasArea(a))[0] || null;
    }
    return { renderer, camera };
  }

  function renderThroughVr(renderer, originalRender, scene, camera) {
    if (state.standalone && !state.standalone.handedOff && scene && scene.isScene
        && camera && camera.isPerspectiveCamera && readyForGameView(renderer, scene)) {
      noteRender(renderer, scene, camera);
      handOffStandalone(renderer);
      return originalRender.call(renderer, scene, camera);
    }
    if (!state.presenting || renderer !== state.renderer || !renderer.xr.isPresenting) {
      noteRender(renderer, scene, camera);
      const result = originalRender.call(renderer, scene, camera);
      if (state.standalone && !state.standalone.handedOff) safe('preview snapshot', () => snapshotCanvas(renderer));
      return result;
    }
    const isSceneRender = scene && scene.isScene && camera && camera.isPerspectiveCamera;
    if (isSceneRender) {
      const target = renderer.getRenderTarget();
      const toScreen = target === null || target === state.xrTarget;
      const inset = toScreen && isInsetRender(renderer);
      if (inset) {
        // A small picture-in-picture (avatar/cosmetic preview, minimap): never the headset view. On the Quest the
        // menu's preview was taken for the view, and the headset showed its dark background.
        state.renderStats.inset++;
        state.renderStats.insetSize = insetLabel(renderer);
        return;
      }
      // The headset view is the gameplay camera (even if it renders into a post-processing target), or whatever
      // perspective camera the game draws to the screen: menus, between rounds, killcam, spectating.
      if (camera === confirmedGameplayCamera() || toScreen) {
        if (toScreen) state.renderStats.screen++;
        if (state.mainRendered) return; // one headset view per XR frame
        return renderMain(renderer, originalRender, scene, camera);
      }
      // A full-screen-shaped offscreen target (render scaling, post-processing): if nothing reaches the screen this
      // frame, it becomes the headset view at the end of the frame (the flat copy the game then draws can't be
      // shown in stereo).
      noteOffscreenView(scene, camera, target);
    }
    // Everything else: offscreen helpers render normally (XR off for the call); screen-space post-processing
    // passes are dropped because they cannot be drawn stereo.
    const target = renderer.getRenderTarget();
    if (target === null || target === state.xrTarget) {
      if (camera && !camera.isPerspectiveCamera) { state.renderStats.flat++; state.renderStats.flatCamera = camera.type || 'camera'; }
      return;
    }
    renderer.xr.enabled = false;
    try { return originalRender.call(renderer, scene, camera); }
    finally { renderer.xr.enabled = true; }
  }

  // A camera we know follows our avatar: the game scene's camera, or one seen near the head. (state.gameCamera alone
  // is only the busiest camera when VR started, which on the main menu can be an avatar preview.)
  function confirmedGameplayCamera() {
    const gs = state.gameScene;
    if (gs && gs.camera && gs.camera.isCamera) return gs.camera;
    return state.gameplayCamera || null;
  }
  // The renderer's own viewport / scissor / size objects (three returns target.copy(internal) / target.set(w, h)).
  function rendererRect(renderer, getter) { let r = null; try { renderer[getter]({ copy(v) { r = v; return this; } }); } catch {} return r; }
  function rendererSizeArea(renderer) { let a = 0; try { renderer.getSize({ set(x, y) { a = x * y; return this; } }); } catch {} return a; }
  function isInsetRender(renderer) {
    const area = (r) => (r ? Math.max(0, r.z) * Math.max(0, r.w) : 0);
    const vp = area(rendererRect(renderer, 'getViewport'));
    const scissor = renderer.getScissorTest && renderer.getScissorTest() ? area(rendererRect(renderer, 'getScissor')) : 0;
    const drawn = scissor ? Math.min(vp || scissor, scissor) : vp;
    if (!drawn) return false;
    // "Full screen" = the biggest unscissored area the game has drawn to the screen, at least the renderer's size.
    if (!scissor) state.fullViewArea = Math.max(state.fullViewArea || 0, vp);
    const full = Math.max(state.fullViewArea || 0, rendererSizeArea(renderer) * 0.4);
    return drawn < full * 0.3;
  }
  function insetLabel(renderer) {
    const r = renderer.getScissorTest && renderer.getScissorTest() ? rendererRect(renderer, 'getScissor') : rendererRect(renderer, 'getViewport');
    return r ? Math.round(r.z) + 'x' + Math.round(r.w) : '?';
  }
  function noteOffscreenView(scene, camera, target) {
    if (!target || target.isWebGLCubeRenderTarget || target.isWebGL3DRenderTarget || target.isWebGLArrayRenderTarget) return;
    const w = target.width, h = target.height;
    if (!(w >= 256 && h >= 144)) return;
    const aspect = w / h;
    if (aspect < 1.1 || aspect > 2.8) return; // square/portrait targets are previews and icons
    state.renderStats.offscreen++;
    state.renderStats.offscreenSize = w + 'x' + h;
    const c = state.offscreenView;
    if (!c || c.frame !== state.xrFrameNo || w * h > c.area) state.offscreenView = { scene, camera, area: w * h, frame: state.xrFrameNo };
  }

  function gameplayCamera() {
    const gs = state.gameScene;
    if (gs && gs.camera && gs.camera.isCamera) return gs.camera;
    return state.gameCamera;
  }

  // Is this camera following our own avatar (gameplay), or a menu / round-break / killcam camera?
  // Once a camera has been seen following us it stays "the gameplay camera"; distance is only used to find it,
  // because a third-person or lagging camera can drift far from the head while walking.
  function sceneRoot(object) { let n = object; while (n && n.parent) n = n.parent; return n; }
  function isGameplayCamera(camera) {
    const gs = state.gameScene;
    if (gs && gs.camera && gs.camera.isCamera) {
      if (gs.killcamTargetId) return (state.gameplayReason = 'killcam', false);
      return (state.gameplayReason = camera === gs.camera ? 'game scene camera' : 'other camera', camera === gs.camera);
    }
    const player = localPlayer();
    const head = player && player.head && player.head.isObject3D ? player.head : null;
    if (!head) return (state.gameplayReason = 'no local player', false);
    if (player.removed) return (state.gameplayReason = 'local player removed', false);
    if (typeof player.health === 'number' && player.health <= 0) return (state.gameplayReason = 'dead', false);
    const root = sceneRoot(head);
    if (!root || root.isScene !== true) return (state.gameplayReason = 'local player not in any scene (stale)', false);
    if (state.gameplayCamera === camera) return (state.gameplayReason = 'gameplay camera', true);
    if (root !== state.threeScene) return (state.gameplayReason = 'different scene (menu)', false);
    const { tmp } = state;
    head.getWorldPosition(tmp.v4);
    camera.getWorldPosition(tmp.v2);
    const distance = tmp.v4.distanceTo(tmp.v2);
    if (distance < 15) {
      if (state.gameplayCamera !== camera) log('Gameplay camera identified (' + distance.toFixed(1) + ' from head).');
      state.gameplayCamera = camera;
      return (state.gameplayReason = 'near head', true);
    }
    return (state.gameplayReason = 'camera ' + distance.toFixed(1) + ' from head', false);
  }

  // Ragdolled? Fister exposes isRagdollState (seen in FisterQoL); fall back to other common names and to its
  // ragdoll meshes being on screen.
  function worldVisible(object) { for (let n = object; n; n = n.parent) if (n.visible === false) return false; return true; }
  // Emoting (dances etc.): like a ragdoll, show the game's own third-person camera so you can see it.
  function isEmoting(player) {
    if (!player) return false;
    if (player.isEmoting === true || player.emoting === true) return true;
    for (const holder of [player.state, player.serverState, player.lastServerState, player.snapshot, player.netState, player.lastState]) {
      if (holder && typeof holder === 'object' && holder.isEmoting === true) return true;
    }
    if (player.actionEmoteState) return true;
    if (player.emoteCameraAnchorLocked === true) return true;
    for (const pose of [player.wormEmotePose, player.twerkEmotePose]) if (pose && pose.active === true) return true;
    const anim = player.currentAnimationState;
    return typeof anim === 'string' && /emote|dance|twerk|worm|taunt/i.test(anim);
  }
  function isRagdolled(player) {
    if (!player) return false;
    for (const key of ['isRagdollState', 'isRagdoll', 'ragdolled', 'isRagdolled', 'ragdollActive']) {
      const value = player[key];
      if (typeof value === 'function') { try { if (value.call(player)) return true; } catch {} }
      else if (value === true) return true;
    }
    const anim = player.currentAnimationState;
    if (typeof anim === 'string' && /ragdoll/i.test(anim)) return true;
    const meshes = player.ragdollMeshes;
    if (meshes && typeof meshes === 'object') {
      const list = Array.isArray(meshes) ? meshes : meshes instanceof Map ? [...meshes.values()] : Object.values(meshes);
      for (const m of list) if (m && m.isObject3D && worldVisible(m) && sceneRoot(m) && sceneRoot(m).isScene) return true;
    }
    return false;
  }

  // If we attached late and our player list goes stale (game rebuilt it, respawn, new round), look again.
  function checkPlayersFresh() {
    if (state.gameScene || !state.lateScene || state.reprobe) return;
    const player = localPlayer();
    const root = player && player.head ? sceneRoot(player.head) : null;
    if (player && root && root.isScene) return;
    state.reprobe = true;
    installMapProbe();
    log('Local player ' + (player ? 'left the scene' : 'missing') + '; searching for the live player list.');
  }

  function renderMain(renderer, originalRender, scene, camera) {
    camera = camera || state.frameCamera || state.gameCamera;
    state.threeScene = scene;
    state.frameCamera = camera;
    if (!state.gameCamera) state.gameCamera = camera;
    const workStart = performance.now();
    if (!safe('rig', () => ensureRig(scene))) return originalRender.call(renderer, scene, camera);
    state.frameCount = (state.frameCount || 0) + 1;
    if (state.frameCount % 60 === 0) safe('player refresh', checkPlayersFresh);
    // Hysteresis: a brief hiccup (lag spike, respawn flicker) must not throw you out of your body.
    const raw = !!safe('gameplay check', () => isGameplayCamera(camera));
    let gameplay;
    if (raw) { state.offGameplayFrames = 0; gameplay = true; }
    else {
      state.offGameplayFrames = (state.offGameplayFrames || 0) + 1;
      gameplay = !!state.gameplay && camera === state.gameplayCamera && state.offGameplayFrames < 45;
    }
    if (gameplay !== !!state.gameplay) log(gameplay ? 'Entered gameplay view.' : 'Left gameplay view: ' + state.gameplayReason + '.');
    if (gameplay) state.gameCamera = camera;
    if (gameplay && !state.gameplay) safe('text focus', releaseTextFocus);
    state.gameplay = gameplay;
    // Ragdolled: hand the camera back to the game's normal third-person view until you get up.
    const ragdolled = gameplay && !!safe('ragdoll check', () => isRagdolled(localPlayer()));
    // Emotes: a few frames of hysteresis so a one-frame flicker doesn't swap cameras.
    const emoteNow = gameplay && !ragdolled && !!safe('emote check', () => isEmoting(localPlayer()));
    const nowMs = performance.now();
    state.emoteFrames = emoteNow ? (state.emoteFrames || 0) + 1 : 0;
    if (emoteNow) state.emoteSeenAt = nowMs;
    const emoting = !ragdolled && (state.emoting ? nowMs - (state.emoteSeenAt || 0) < 300 : state.emoteFrames >= 3);
    if (emoting !== !!state.emoting) log(emoting ? 'Emoting: following the game camera (third person).' : 'Emote over: first-person view.');
    state.emoting = emoting;
    const ragdoll = ragdolled || emoting; // both use the game's third-person camera
    if (ragdolled !== !!state.ragdolledOnly) log(ragdolled ? 'Ragdolled: following the game camera (third person).' : 'Back on your feet: first-person view.');
    state.ragdolledOnly = ragdolled;
    state.ragdoll = ragdoll;
    const inBody = gameplay && !ragdoll;
    if (inBody) { safe('first-person lock', lockFirstPerson); safe('screen shake', suppressShake); }
    else if (ragdoll) { safe('first-person release', unlockFirstPerson); safe('head', restoreHead); }
    safe('view rig', () => updateRig(scene, camera, inBody));
    if (!state.menu && config.menu.mode !== 'off' && (state.menuRetry = (state.menuRetry || 0) + 1) % 30 === 1) safe('menu setup', setupMenu);
    safe('menu', updateMenu);   // before aim, so aim pauses the same frame the laser lands on a menu
    safe('aim line', updateAimLaser);
    if (inBody) { safe('hand aim', steerAim); safe('arms', overrideArms); safe('held items', () => holdItems(localPlayer(), scene)); safe('hide body', () => hideBody(localPlayer())); }
    else { state.aim.lastYaw = null; safe('hide body', restoreBody); safe('held items', restoreItems); safe('arm size', restoreArmScale); }
    safe('outlines', () => hideOutlines(scene));
    safe('controller boxes', updateBoxes);
    const work = performance.now() - workStart;
    state.modMs = state.modMs ? state.modMs * 0.9 + work * 0.1 : work;
    const previousTarget = renderer.getRenderTarget();
    if (state.xrTarget && previousTarget !== state.xrTarget) renderer.setRenderTarget(state.xrTarget);
    try {
      if (state.overlayOk) hideThreeOverlay(true);
      originalRender.call(renderer, scene, state.view);
    } finally {
      if (state.xrTarget && previousTarget !== state.xrTarget) renderer.setRenderTarget(previousTarget);
    }
    state.mainRendered = true;
    if (renderer.xr.isPresenting) {
      try { if (drawOverlay(renderer)) state.overlayOk = true; }
      catch (error) {
        state.overlayOk = false; hideThreeOverlay(false);
        try { renderer.resetState(); } catch {}
        if (!state.overlayFailed) { state.overlayFailed = true; record('error', ['Drawing the panel directly failed; using three.js for it:', error]); }
      }
      if (!state.repeating && clipWanted()) safe('clip view', () => renderClipView(renderer, originalRender, scene));
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Clip view (FisterQoL build). In VR the game canvas stops updating (three.js draws into the headset's framebuffer),
  // so a clip recorded in VR would be one frozen frame. While the recorder is taking frames, draw a steadied
  // first-person view from the headset into a corner of the canvas, copy it to a 2D canvas, and give that to the
  // recorder through FisterQoL's clip hook (fisterVR.clipFrame).
  // ---------------------------------------------------------------------------------------------------------
  const clipRecording = () => performance.now() - (state.clipCaptureAt || 0) < 1500;
  function clipWanted() {
    if (config.clipView === 'off' || !state.presenting) return false;
    // Recording: draw a new view for each frame the recorder asked for (not more often than it takes them).
    if (clipRecording()) return !state.clip || !state.clip.frames || state.clipCaptureAt >= state.clip.frameAt;
    // Not recording: refresh the page mirror at a low rate.
    if (config.pageMirror === false) return false;
    const fps = Math.min(30, Math.max(1, Number(config.pageMirrorFps) || 5));
    return !state.clip || !state.clip.frames || performance.now() - (state.clip.frameAt || 0) >= 1000 / fps;
  }
  function clipSize(renderer) {
    const canvas = renderer.domElement;
    // With the virtual screen on, the page is a 1920x1080 screen (the game canvas keeps its pre-VR size: three.js
    // ignores setSize while presenting), so clips are 16:9 and line up with the overlays.
    const cw = state.vscreen ? VSCREEN_W : canvas.clientWidth || winSize().w, ch = state.vscreen ? VSCREEN_H : canvas.clientHeight || winSize().h;
    const aspect = Math.min(3, Math.max(0.4, cw / ch));
    let h = Math.round(Math.min(Math.max(240, Number(config.clipHeight) || 720), 2160));
    let w = Math.round(h * aspect);
    // The view is drawn into the canvas before copying; three.js sized the canvas to the headset framebuffer.
    const k = Math.min(1, canvas.width / w, canvas.height / h);
    w = Math.max(2, Math.floor(w * k / 2) * 2); h = Math.max(2, Math.floor(h * k / 2) * 2);
    return { w, h };
  }
  function renderClipView(renderer, originalRender, scene) {
    const C = state.classes;
    if (!C || !state.view || !C.Vector3 || !C.Quaternion) return;
    const { w, h } = clipSize(renderer);
    let clip = state.clip;
    if (!clip) {
      const canvas = document.createElement('canvas');
      clip = state.clip = { canvas, ctx: canvas.getContext('2d', { alpha: false }), cam: null, pos: new C.Vector3(), quat: new C.Quaternion(),
        scl: new C.Vector3(), primed: false, frames: 0, ms: 0, frameAt: 0 };
    }
    if (!clip.ctx || clip.pending) return; // a read-back is still on its way
    if (!clip.cam) { clip.cam = state.view.clone(false); clip.cam.name = 'fister-vr-clip-view'; }
    const cam = clip.cam;
    // Head pose in world space: three.js copied it onto our view camera during the headset render.
    state.view.updateMatrixWorld(true);
    const { tmp } = state;
    state.view.matrixWorld.decompose(tmp.v, tmp.q, clip.scl);
    const smooth = Math.min(0.95, Math.max(0, Number(config.clipSmoothing) || 0));
    if (!clip.primed || smooth === 0 || clip.pos.distanceToSquared(tmp.v) > 25) { clip.pos.copy(tmp.v); clip.quat.copy(tmp.q); clip.primed = true; }
    else { clip.pos.lerp(tmp.v, 1 - smooth); clip.quat.slerp(tmp.q, 1 - smooth); }
    cam.position.copy(clip.pos);
    cam.quaternion.copy(clip.quat);
    cam.scale.set(1, 1, 1);
    cam.fov = Math.min(120, Math.max(40, Number(config.clipFov) || 90));
    cam.aspect = w / h;
    const k = Math.max(0.05, clip.scl.x || 1);
    cam.near = state.view.near * k; cam.far = state.view.far * k;
    cam.layers.mask = state.view.layers.mask;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    if (!clip.method) clip.method = config.clipMethod === 'readback' ? 'readback' : 'canvas';
    const t0 = performance.now();
    const previousTarget = renderer.getRenderTarget();
    if (!state.vector4Ctor) { try { const vp = renderer.getViewport({ copy(v) { state.vector4Ctor = v.constructor; return this; } }); } catch {} }
    const previousViewport = state.vector4Ctor ? renderer.getViewport(new state.vector4Ctor()) : null;
    const canvas = renderer.domElement;
    const checkDue = t0 - (clip.checkAt || 0) > 1000;
    state.clipRendering = true;
    renderer.xr.enabled = false;
    let drew = true;
    try {
      if (clip.method === 'readback') {
        try { drew = clipReadback(renderer, originalRender, scene, cam, w, h); }
        catch (error) {
          clip.method = 'canvas'; clip.readbackFailed = true;
          record('error', ['Clip view: reading the view back failed; copying from the game canvas again:', error]);
          throw error;
        }
      } else {
        renderer.setRenderTarget(null);
        const ratio = renderer.getPixelRatio() || 1;
        renderer.setViewport(0, 0, w / ratio, h / ratio);
        originalRender.call(renderer, scene, cam);
        if (checkDue) clip.fbMax = sampleFramebuffer(renderer.getContext(), w, h);
        // Copy now, in the same task as the draw (the WebGL canvas keeps no frames). GL's origin is bottom-left.
        if (clip.canvas.width !== w || clip.canvas.height !== h) { clip.canvas.width = w; clip.canvas.height = h; }
        clip.ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
      }
      if (drew) clipFrameDone(clip);
    } finally {
      renderer.xr.enabled = true;
      state.clipRendering = false;
      if (previousViewport && previousViewport.isVector4) renderer.setViewport(previousViewport);
      renderer.setRenderTarget(previousTarget);
    }
    const ms = performance.now() - t0;
    clip.ms = clip.ms ? clip.ms * 0.9 + ms * 0.1 : ms;
    if (drew) clipFrameShown(clip, renderer, checkDue);
  }
  function clipFrameDone(clip) {
    clip.frames++;
    clip.frameAt = performance.now();
  }
  function clipFrameShown(clip, renderer, checkDue) {
    if (clip.frames === 1) log('Clip view: drawing the headset view at ' + clip.canvas.width + 'x' + clip.canvas.height + ' (' + clip.method + ').');
    if (checkDue) checkClipFrame(clip);
    safe('page mirror', () => updateMirror(renderer));
  }
  // Is a picture there at all? The brightest channel over a few spots (0 = all black).
  function sampleFramebuffer(gl, w, h) {
    if (!gl || !gl.readPixels) return null;
    const px = new Uint8Array(4);
    let max = 0;
    for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) {
      gl.readPixels(Math.floor(w * i / 4), Math.floor(h * j / 4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      max = Math.max(max, px[0], px[1], px[2]);
    }
    return max;
  }
  function sampleCanvas(source) {
    if (!state.clipProbe) { const c = document.createElement('canvas'); c.width = 16; c.height = 9; state.clipProbe = { c, ctx: c.getContext('2d', { willReadFrequently: true }) }; }
    const p = state.clipProbe;
    if (!p.ctx) return null;
    p.ctx.fillStyle = '#000'; p.ctx.fillRect(0, 0, 16, 9);
    p.ctx.drawImage(source, 0, 0, 16, 9);
    const d = p.ctx.getImageData(0, 0, 16, 9).data;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
    return max;
  }
  // On the Quest the copies from the game canvas came out black while presenting. Once a second, check the picture;
  // after 3 black checks in a row (a real scene is never pure black) switch to rendering into our own target and
  // reading the pixels back, which doesn't depend on the canvas.
  function checkClipFrame(clip) {
    clip.checkAt = performance.now();
    clip.imgMax = sampleCanvas(clip.canvas);
    if (clip.method !== 'canvas' || config.clipMethod === 'canvas' || clip.readbackFailed || clip.imgMax === null) return;
    clip.blackChecks = clip.imgMax < 6 ? (clip.blackChecks || 0) + 1 : 0;
    if (clip.blackChecks < 3) return;
    clip.method = 'readback';
    const fb = clip.fbMax == null ? 'unknown' : clip.fbMax < 6 ? 'black too' : 'has a picture';
    warn('Clip view: copies of the game canvas come out black (game canvas itself: ' + fb + '); reading the view back from the GPU instead.');
  }
  function clipReadback(renderer, originalRender, scene, cam, w, h) {
    const clip = state.clip;
    const Target = state.xrTarget && state.xrTarget.constructor;
    if (!Target || typeof renderer.readRenderTargetPixels !== 'function') throw new Error('no render target class');
    // Reading pixels back stalls the GPU, so keep it small.
    const s = Math.min(1, Math.min(1080, Math.max(240, Number(config.clipReadbackHeight) || 480)) / h);
    const rw = Math.max(2, Math.floor(w * s / 2) * 2), rh = Math.max(2, Math.floor(h * s / 2) * 2);
    if (!clip.rt || clip.rt.width !== rw || clip.rt.height !== rh) {
      if (clip.rt) { try { clip.rt.dispose(); } catch {} }
      clip.rt = new Target(rw, rh, { depthBuffer: true });
      // Like three's own XR target: encode to the screen's colour space instead of linear (the picture would be dark).
      clip.rt.isXRRenderTarget = true;
      if (clip.rt.texture && 'colorSpace' in clip.rt.texture) clip.rt.texture.colorSpace = renderer.outputColorSpace;
      clip.px = new Uint8Array(rw * rh * 4);
      clip.img = clip.ctx.createImageData(rw, rh);
    }
    renderer.setRenderTarget(clip.rt);
    originalRender.call(renderer, scene, cam);
    const blit = () => {
      const row = rw * 4, out = clip.img.data, px = clip.px;
      for (let y = 0; y < rh; y++) out.set(px.subarray((rh - 1 - y) * row, (rh - y) * row), y * row);
      for (let i = 3; i < out.length; i += 4) out[i] = 255;
      if (clip.canvas.width !== rw || clip.canvas.height !== rh) { clip.canvas.width = rw; clip.canvas.height = rh; }
      clip.ctx.putImageData(clip.img, 0, 0);
    };
    // Newer three.js reads back without stalling (pixel buffer + fence, ready a frame or two later).
    if (typeof renderer.readRenderTargetPixelsAsync === 'function' && !clip.asyncFailed) {
      clip.pending = true;
      clip.readMode = 'async';
      const px = clip.px, img = clip.img;
      Promise.resolve(renderer.readRenderTargetPixelsAsync(clip.rt, 0, 0, rw, rh, px)).then(() => {
        clip.pending = false;
        if (clip.px !== px || clip.img !== img || !state.presenting) return; // resized or VR ended meanwhile
        blit();
        clipFrameDone(clip);
        clipFrameShown(clip, renderer, performance.now() - (clip.checkAt || 0) > 1000);
      }, (error) => {
        clip.pending = false;
        clip.asyncFailed = true;
        record('warn', ['Clip view: reading back without stalling failed; reading back directly:', error]);
      });
      return false;
    }
    clip.readMode = 'sync';
    renderer.readRenderTargetPixels(clip.rt, 0, 0, rw, rh, clip.px);
    blit();
    return true;
  }
  // The page mirror is the clip view's canvas itself, placed right after the game canvas (so the game's overlays stay
  // on top) and stretched over the whole (virtual) screen.
  function updateMirror(renderer) {
    const clip = state.clip;
    if (config.pageMirror === false || !state.presenting || !clip || !clip.frames) { removeMirror(); return; }
    const m = clip.canvas, src = renderer.domElement;
    if (!m.id) {
      m.id = 'fister-vr-mirror';
      m.setAttribute('aria-hidden', 'true');
    }
    const W = state.vscreen ? VSCREEN_W : winSize().w, H = state.vscreen ? VSCREEN_H : winSize().h;
    const key = W + 'x' + H;
    if (m.isConnected && m.previousElementSibling === src && m.dataset.size === key) return;
    const st = m.style;
    st.cssText = 'position:fixed;left:0;top:0;margin:0;padding:0;border:0;width:' + W + 'px;height:' + H + 'px;object-fit:cover;pointer-events:none;display:block;';
    let z = 'auto';
    try { z = getComputedStyle(src).zIndex; } catch {}
    if (/^-?\d+$/.test(z)) st.zIndex = z;
    m.dataset.size = key;
    if (src && src.isConnected && src.parentNode) src.after(m);
    else if (document.body) document.body.prepend(m);
    if (!state.mirrorLogged) { state.mirrorLogged = true; log('Page mirror on: the flat page shows the headset view (' + key + ').'); }
  }
  function removeMirror() {
    const m = state.clip && state.clip.canvas;
    if (m && m.isConnected) m.remove();
  }
  function renderReport() {
    const r = state.renderRate;
    if (!state.presenting || !r) return '-';
    const n = (v) => Math.round(v);
    return 'to screen ' + n(r.screen) + ' · insets skipped ' + n(r.inset) + (r.inset ? ' (' + r.insetSize + ')' : '')
      + ' · offscreen views ' + n(r.offscreen) + (r.offscreen ? ' (' + r.offscreenSize + ', shown ' + n(r.used) + ')' : '')
      + ' · flat passes dropped ' + n(r.flat) + (r.flat ? ' (' + r.flatCamera + ')' : '');
  }
  function clipReport() {
    const clip = state.clip;
    if (config.clipView === 'off') return 'clip view off';
    if (!clip || !clip.frames) return 'no view drawn yet' + (state.presenting ? '' : ' (not in VR)');
    const lvl = (v) => (v == null ? '?' : v < 6 ? 'BLACK' : 'ok (' + v + ')');
    return clip.canvas.width + 'x' + clip.canvas.height + ' via ' + clip.method + (clip.method === 'readback' && clip.readMode ? ' (' + clip.readMode + ')' : '') + (clip.readbackFailed ? ' (read-back failed)' : '')
      + ' · ' + clip.frames + ' frames · ' + (clip.ms || 0).toFixed(1) + ' ms each · recording ' + (clipRecording() ? 'yes' : 'no')
      + ' · picture ' + lvl(clip.imgMax) + ' · game canvas ' + lvl(clip.fbMax) + ' · page mirror ' + (clip.canvas.isConnected ? 'on' : 'off');
  }
  // Where the clip picture sits on the page: FisterQoL maps its overlays into clips with this.
  function clipRect() {
    if (!state.presenting || !state.clip || !state.clip.frames) return null;
    const S = screenRect();
    return { x: S.x, y: S.y, width: S.w, height: S.h, left: S.x, top: S.y };
  }
  // Called by FisterQoL's clip hook for every frame the game's recorder takes. Returns the canvas with the headset view
  // (or null outside VR / with the clip view off, so the normal game canvas is used).
  function clipFrame() {
    state.clipCaptureAt = performance.now();
    if (config.clipView === 'off' || !state.presenting || !state.renderer || !state.renderer.xr.isPresenting) return null;
    const clip = state.clip;
    if (!clip || !clip.frames) {
      // First frame of a recording: nothing drawn yet. Hand over a black frame of the right size, not the stale canvas.
      const { w, h } = state.renderer ? clipSize(state.renderer) : { w: 1280, h: 720 };
      if (!state.clipBlank) { state.clipBlank = document.createElement('canvas'); }
      const b = state.clipBlank;
      if (b.width !== w || b.height !== h) { b.width = w; b.height = h; const c = b.getContext('2d'); if (c) { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); } }
      return b;
    }
    return clip.canvas;
  }

  // Grab Three.js constructors from live objects: the game's copy of three.js is a private ES module.
  // Does this scene contain what we need to build our own objects (a Mesh with a plain Float32 position attribute)?
  function sceneHasBuildingBlocks(scene) {
    let ok = false;
    try {
      scene.traverse((node) => {
        if (ok || node.isMesh !== true) return;
        const pos = node.geometry && node.geometry.attributes && node.geometry.attributes.position;
        if (pos && pos.isBufferAttribute === true && pos.isInterleavedBufferAttribute !== true && pos.array instanceof Float32Array) ok = true;
      });
    } catch {}
    return ok;
  }

  function harvestClasses(scene, camera) {
    // A previous scene (loading screen, empty menu) may not have had everything. Try again every 30 frames.
    if (state.classes && state.classes.Mesh && state.classes.Attribute) return state.classes;
    if (state.classes && ((state.harvestTries = (state.harvestTries || 0) + 1) % 30 !== 0)) return state.classes;
    const Vector3 = camera.position.constructor;
    const Quaternion = camera.quaternion.constructor;
    const Euler = camera.rotation.constructor;

    let Object3D = camera.constructor;
    for (;;) {
      const parent = Object.getPrototypeOf(Object3D);
      if (typeof parent !== 'function' || parent === Function.prototype) break;
      let probe;
      try { probe = new parent(); } catch { break; }
      if (!probe || probe.isObject3D !== true) break;
      Object3D = parent;
    }

    let Mesh = null, Attribute = null;
    scene.traverse((node) => {
      if (!Mesh && node.isMesh === true) {
        let ctor = node.constructor;
        while (typeof ctor === 'function' && ctor !== Function.prototype) {
          let probe = null;
          try { probe = new ctor(); } catch {}
          if (probe && probe.type === 'Mesh' && probe.isMesh === true && probe.geometry && probe.material) { Mesh = ctor; break; }
          ctor = Object.getPrototypeOf(ctor);
        }
      }
      const position = node.geometry && node.geometry.attributes && node.geometry.attributes.position;
      if (!Attribute && position && position.isBufferAttribute === true && position.isInterleavedBufferAttribute !== true
          && position.array instanceof Float32Array) {
        Attribute = position.constructor;
      }
    });

    const Matrix4 = camera.matrixWorld.constructor;
    const PerspectiveCamera = camera.isPerspectiveCamera ? camera.constructor : null;
    const previous = state.classes || {};
    state.classes = { ...previous, Vector3, Quaternion, Euler, Object3D, Mesh: Mesh || previous.Mesh || null, Attribute: Attribute || previous.Attribute || null, PerspectiveCamera, Matrix4 };
    if (state.classes.Mesh && state.classes.Attribute && !(previous.Mesh && previous.Attribute) && state.rig) safe('controller boxes', addMissingBoxes);
    log('Three.js classes harvested:', Object.fromEntries(Object.entries(state.classes).map(([k, v]) => [k, !!v])));
    return state.classes;
  }

  function ensureRig(scene) {
    const camera = state.gameCamera;
    if (!camera) return false;
    const C = harvestClasses(scene, camera);
    if (!state.rig) {
      state.rig = new C.Object3D();
      state.rig.name = 'fister-vr-rig';
      state.view = camera.clone(false);
      state.view.name = 'fister-vr-view';
      state.view.position.set(0, 0, 0);
      state.view.quaternion.set(0, 0, 0, 1);
      state.view.scale.set(1, 1, 1);
      state.rig.add(state.view);
      state.headOffset = new C.Vector3();
      state.tmp = { v: new C.Vector3(), v2: new C.Vector3(), v3: new C.Vector3(), v4: new C.Vector3(), q: new C.Quaternion(),
        q2: new C.Quaternion(), q3: new C.Quaternion(), e: new C.Euler(0, 0, 0, 'YXZ'), m: new C.Matrix4() };
      setupControllers();
    }
    if (state.rig.parent !== scene) scene.add(state.rig);
    return true;
  }

  function localPlayer() {
    const gs = gameScene();
    if (!gs || !gs.players) return null;
    const players = gs.players;
    if (typeof players.get === 'function' && gs.localPlayerId != null) {
      const direct = players.get(gs.localPlayerId);
      if (direct) return direct;
    }
    const list = typeof players.values === 'function' ? players.values() : Object.values(players);
    for (const player of list) {
      if (!player) continue;
      if (player.id != null && player.id === gs.localPlayerId) return player;
      if ((typeof player.isLocalPlayer === 'function' && player.isLocalPlayer()) || player.isLocal === true) return player;
    }
    return null;
  }

  function anchorObject() {
    const mode = config.anchor;
    if (mode !== 'camera') {
      const player = localPlayer();
      const head = player && player.head && player.head.isObject3D ? player.head : null;
      if (head && (mode === 'head' || !state.fp)) return { object: head, player };
    }
    return { object: state.frameCamera || state.gameCamera, player: null };
  }

  function updateRig(scene, camera, gameplay) {
    const { rig, view, tmp } = state;
    const gameCamera = camera || state.gameCamera;
    const scale = Math.max(0.05, Number(config.worldScale) || 1);
    // Outside gameplay (menus, round breaks, killcam) you sit where the game's camera is and look around freely.
    const anchor = gameplay ? anchorObject() : { object: gameCamera, player: null };

    // 'head' aim: view yaw follows the game camera (mouse / snap turn).
    // 'hand' aim: the game camera follows your right hand, so the view must NOT follow it (that would swing
    // the world every time you aim). The view keeps the yaw it had when VR started, plus stick turns.
    gameCamera.updateMatrixWorld();
    gameCamera.getWorldQuaternion(tmp.q);
    tmp.e.setFromQuaternion(tmp.q, 'YXZ');
    let baseYaw = tmp.e.y;
    if (config.aimMode === 'hand' && gameplay) {
      if (state.handBaseYaw === null) state.handBaseYaw = tmp.e.y;
      baseYaw = state.handBaseYaw;
    }
    const yaw = baseYaw - state.yawOffset + state.rigTurn;

    anchor.object.updateWorldMatrix(true, false);
    anchor.object.getWorldPosition(tmp.v2);
    const onHead = anchor.object !== gameCamera;
    if (onHead) {
      // Eyes a little above the head mesh's centre (and optionally forward along your facing).
      const eye = config.eyeOffset || {};
      tmp.v2.y += (Number(eye.up) || 0) * scale;
      const fwd = Number(eye.forward) || 0;
      if (fwd) { tmp.v2.x -= Math.sin(yaw) * fwd * scale; tmp.v2.z -= Math.cos(yaw) * fwd * scale; }
    }
    // Ignore a broken position (NaN) and one-frame teleports of the anchor; real teleports (respawn) persist.
    const valid = Number.isFinite(tmp.v2.x) && Number.isFinite(tmp.v2.y) && Number.isFinite(tmp.v2.z);
    if (!state.lastAnchor) state.lastAnchor = tmp.v2.clone();
    const jump = valid ? tmp.v2.distanceTo(state.lastAnchor) : Infinity;
    if (!valid || (jump > 3 * scale && !state.jumpPending)) {
      state.jumpPending = valid;
      state.glitches = (state.glitches || 0) + 1;
      rig.position.copy(state.lastAnchor);
    } else {
      state.jumpPending = false;
      state.lastAnchor.copy(tmp.v2);
      rig.position.copy(tmp.v2);
    }
    if (onHead) hideHead(anchor.object); else restoreHead();

    rig.rotation.set(0, yaw, 0);
    rig.scale.setScalar(scale);
    // eye_world = anchor + R(yaw) * scale * (headPose - headOffset)
    tmp.v.copy(state.headOffset).multiplyScalar(scale).applyQuaternion(rig.quaternion);
    rig.position.sub(tmp.v);
    rig.updateMatrixWorld(true);

    view.near = Math.min(gameCamera.near, 0.05);
    view.far = gameCamera.far;
    view.layers.mask = gameCamera.layers.mask;
  }

  function recenter(frame) {
    const renderer = state.renderer;
    if (!renderer || !frame) { state.pendingRecenter = true; return; }
    const space = renderer.xr.getReferenceSpace();
    const pose = space && frame.getViewerPose(space);
    if (!pose || !state.headOffset) { state.pendingRecenter = true; return; }
    const p = pose.transform.position, o = pose.transform.orientation;
    state.headOffset.set(p.x, p.y, p.z);
    state.tmp.q2.set(o.x, o.y, o.z, o.w);
    state.tmp.e.setFromQuaternion(state.tmp.q2, 'YXZ');
    state.yawOffset = state.tmp.e.y;
    state.pendingRecenter = false;
    log('Recentered.');
  }

  // --- first-person POV toggle -------------------------------------------------------------------------------
  const FP_NAME = /first.?person|fpv|^pov$|povmode|isfps|fps.?cam/i;
  const FP_MODE_NAME = /camera.?mode|view.?mode|pov|perspective.?mode/i;

  function resolvePath(base, path) {
    const parts = String(path).split('.');
    const key = parts.pop();
    let owner = base;
    for (const part of parts) { owner = owner && owner[part]; }
    return owner && typeof owner === 'object' ? { owner, key } : null;
  }

  function scanForToggle(base, depth, prefix, out, seen) {
    if (!base || typeof base !== 'object' || seen.has(base) || depth < 0) return;
    if (base.isObject3D || base.isMaterial || base.isBufferGeometry || base.isTexture) return;
    if (typeof Node !== 'undefined' && base instanceof Node) return;
    seen.add(base);
    let keys;
    try { keys = Object.keys(base); } catch { return; }
    for (const key of keys) {
      let value;
      try { value = base[key]; } catch { continue; }
      const label = prefix ? prefix + '.' + key : key;
      if (typeof value === 'boolean' && FP_NAME.test(key)) out.push({ owner: base, key, label, kind: 'boolean', value });
      else if ((typeof value === 'string' || typeof value === 'number') && FP_MODE_NAME.test(key)) out.push({ owner: base, key, label, kind: typeof value, value });
      else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set)) {
        scanForToggle(value, depth - 1, label, out, seen);
      }
    }
  }

  function detectFirstPerson(verbose) {
    const gs = gameScene();
    if (!gs) return null;
    if (config.firstPerson.path) {
      const hit = resolvePath(gs, config.firstPerson.path);
      if (hit) { state.fp = { ...hit, label: config.firstPerson.path, value: config.firstPerson.value }; return state.fp; }
      warnOnce('fp-path', 'Configured first-person path not found on game scene:', config.firstPerson.path);
    }
    const found = [];
    scanForToggle(gs, 2, '', found, new Set());
    const toggle = found.find((c) => c.kind === 'boolean');
    if (verbose && found.length) log('First-person candidates:', found.map((c) => c.label + ' = ' + JSON.stringify(c.value)).join(', '));
    if (toggle) {
      state.fp = { owner: toggle.owner, key: toggle.key, label: toggle.label, value: true };
      log('First-person toggle auto-detected: gameScene.' + toggle.label);
      return state.fp;
    }
    if (verbose) warnOnce('fp-missing', 'No boolean first-person toggle found on the game scene. Anchoring the view to the '
      + 'local avatar head instead. Run fisterVR.dump() and share the output, or set fisterVR.setFirstPersonPath(path, value).');
    return null;
  }

  function lockFirstPerson() {
    if (!state.renderer || !state.renderer.xr.isPresenting) return;
    const fp = state.fp || detectFirstPerson(false);
    if (!fp) return;
    if (!('previous' in fp)) fp.previous = fp.owner[fp.key];
    if (fp.owner[fp.key] !== fp.value) fp.owner[fp.key] = fp.value; // locked ON every frame while presenting
  }

  function unlockFirstPerson() {
    const fp = state.fp;
    if (fp && 'previous' in fp) { fp.owner[fp.key] = fp.previous; delete fp.previous; }
  }

  function hideHead(head) {
    if (!config.hideLocalHead) return;
    if (state.hiddenHead && state.hiddenHead.object !== head) restoreHead();
    if (head && !state.hiddenHead) { state.hiddenHead = { object: head, visible: head.visible }; }
    if (head) head.visible = false;
  }
  function restoreHead() {
    if (state.hiddenHead) { state.hiddenHead.object.visible = state.hiddenHead.visible; state.hiddenHead = null; }
  }

  function suppressShake() {
    const gs = gameScene();
    if (!config.disableScreenShake || !gs || typeof gs.screenShakeIntensity !== 'number') return;
    if (!state.shake) state.shake = { previous: gs.screenShakeIntensity };
    gs.screenShakeIntensity = 0;
  }
  function restoreShake() {
    if (state.shake && gameScene()) gameScene().screenShakeIntensity = state.shake.previous;
    state.shake = null;
  }

  // ---------------------------------------------------------------------------------------------------------
  // 3. Controllers: anchors, boxes, arm override, input mapping
  // ---------------------------------------------------------------------------------------------------------
  function boxGeometry(sx, sy, sz) {
    const { Mesh, Attribute } = state.classes;
    const geometry = new Mesh().geometry; // three's default BufferGeometry
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const c = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]];
    const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    const out = [];
    for (const [a, b, d, e] of faces) for (const i of [a, b, d, a, d, e]) out.push(...c[i]);
    geometry.setAttribute('position', new Attribute(new Float32Array(out), 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  function makeBox(index) {
    const C = state.classes;
    const box = new C.Mesh();
    box.geometry = boxGeometry(...config.boxSize);
    if (box.material.color) box.material.color.setHex(config.boxColors.none);
    box.name = 'fister-vr-controller-box-' + index;
    showOnAllLayers(box);
    return box;
  }
  function addMissingBoxes() {
    if (!config.controllerBoxes || !state.classes || !state.classes.Mesh || !state.classes.Attribute) return;
    for (const entry of state.controllers) {
      if (entry.box) continue;
      entry.box = makeBox(entry.index);
      entry.group.add(entry.box);
      if (entry.box.material.color) entry.box.material.color.setHex(config.boxColors[entry.handedness] ?? config.boxColors.none);
    }
  }

  function setupControllers() {
    const renderer = state.renderer;
    const C = state.classes;
    for (let index = 0; index < 2; index++) {
      const group = renderer.xr.getController(index);
      const entry = { index, group, box: null, handedness: 'none', source: null };
      if (config.controllerBoxes && C.Mesh && C.Attribute) {
        const box = new C.Mesh();
        box.geometry = boxGeometry(...config.boxSize);
        if (box.material.color) box.material.color.setHex(config.boxColors.none);
        box.name = 'fister-vr-controller-box-' + index;
        showOnAllLayers(box);
        group.add(box);
        entry.box = box;
      } else if (config.controllerBoxes) {
        warnOnce('boxes', 'Could not build controller boxes (Mesh/BufferAttribute classes not found in scene).');
      }
      group.addEventListener('connected', (event) => {
        entry.source = event.data;
        entry.handedness = event.data && event.data.handedness || 'none';
        if (entry.box && entry.box.material.color) entry.box.material.color.setHex(config.boxColors[entry.handedness] ?? config.boxColors.none);
        log('Controller ' + index + ' connected (' + entry.handedness + ').');
      });
      group.addEventListener('disconnected', () => { entry.source = null; entry.handedness = 'none'; });
      state.rig.add(group); // controllers live in the same space as the headset view
      state.controllers.push(entry);
    }
  }

  // --- outlines ------------------------------------------------------------------------------------------------
  // Outline / glow shells (typically back-faced, black, or subtractive/multiply-blended copies of a mesh) render as
  // solid black boxes in the headset. Hide them while in VR; avatars are left alone unless hideOutlines is 'all'.
  const BLEND_SUBTRACT = 3, BLEND_MULTIPLY = 4, BACK_SIDE = 1;
  function isOutlineMesh(node) {
    if (!node.isMesh || !node.material) return false;
    const gs = state.gameScene;
    if (gs && (node === gs.skyboxMesh)) return false;
    if (node.parent === state.rig || node.parent === state.view) return false;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const names = (node.name || '') + ' ' + materials.map((m) => (m && (m.name || m.type)) || '').join(' ');
    if (/outline|glow|halo|aura|highlight|silhouette/i.test(node.name || '') || materials.some((m) => m && /outline|glow|halo|aura|silhouette/i.test(m.name || ''))) return true;
    const geometry = node.geometry;
    if (geometry && !geometry.boundingSphere && geometry.computeBoundingSphere) geometry.computeBoundingSphere();
    const radius = geometry && geometry.boundingSphere ? geometry.boundingSphere.radius * Math.max(node.scale.x, node.scale.y, node.scale.z) : 0;
    if (radius > 40) return false; // skyboxes and level shells
    void names;
    for (const m of materials) {
      if (!m) continue;
      const dark = m.color && (m.color.r + m.color.g + m.color.b) < 0.12;
      if (m.blending === BLEND_SUBTRACT || m.blending === BLEND_MULTIPLY) return true;
      if (m.side === BACK_SIDE && (dark || m.isShaderMaterial || m.isRawShaderMaterial)) return true;
    }
    return false;
  }
  // Other players' outlines may be kept ('world'); your own never are: your eyes sit inside your avatar, so its
  // outline shell wraps the camera and blacks out the view.
  function insideAvatar(node) {
    const gs = gameScene();
    if (!gs || !gs.players) return false;
    const me = localPlayer();
    const roots = new Set();
    for (const p of (typeof gs.players.values === 'function' ? gs.players.values() : Object.values(gs.players))) {
      if (p === me) continue;
      if (p && p.mesh) roots.add(p.mesh);
      if (p && p.avatarVisualRoot) roots.add(p.avatarVisualRoot);
    }
    for (let n = node; n; n = n.parent) if (roots.has(n)) return true;
    return false;
  }
  function hideOutlines(scene) {
    if (config.hideOutlines === 'off') return;
    const hidden = state.outlines || (state.outlines = new Map());
    if (((state.outlineScan = (state.outlineScan || 0) + 1) % 30) === 1) {
      scene.traverse((node) => {
        if (hidden.has(node) || !isOutlineMesh(node)) return;
        if (config.hideOutlines !== 'all' && insideAvatar(node)) return;
        hidden.set(node, node.visible);
      });
    }
    for (const [node] of hidden) node.visible = false; // re-hide every frame in case the game toggles them
  }
  function restoreOutlines() {
    if (!state.outlines) return;
    for (const [node, visible] of state.outlines) node.visible = visible;
    state.outlines.clear();
  }

  // --- hide own torso & legs -----------------------------------------------------------------------------------
  // Meshes are moved to a layer the headset cameras don't draw (layers don't inherit, so arms parented to the
  // torso stay visible). Everything under the avatar except head, arms and held items counts: torso, legs and
  // whatever clothing or cosmetics hang off them.
  const HIDDEN_LAYER_MASK = 1 << 31;
  function bodyMeshes(player) {
    const keep = new Set([player.head, player.leftArm, player.rightArm, player.carMesh, player.tankMesh,
      ...ITEM_KEYS.map((k) => player[k])].filter((o) => o && o.isObject3D));
    const roots = [player.avatarVisualRoot, player.mesh, player.torso, player.leftLeg, player.rightLeg].filter((o) => o && o.isObject3D);
    const out = new Set();
    for (const root of roots) {
      root.traverse((node) => {
        if (!node.isMesh && !node.isSkinnedMesh && !node.isInstancedMesh) return;
        for (let n = node; n; n = n.parent) { if (keep.has(n)) return; if (n === root) break; }
        out.add(node);
      });
    }
    // Explicit body parts always count, even if they sit under a kept node in some rig.
    for (const part of [player.torso, player.leftLeg, player.rightLeg]) {
      if (part && part.isObject3D) part.traverse((node) => { if (node.isMesh) { let kept = false; for (let n = node; n && n !== part; n = n.parent) if (keep.has(n)) kept = true; if (!kept) out.add(node); } });
    }
    return out;
  }
  function hideBody(player) {
    if (!config.hideBody || !player) { restoreBody(); return; }
    const hidden = state.hiddenBody || (state.hiddenBody = new Map());
    if (state.bodyPlayer !== player) { restoreBody(); state.bodyPlayer = player; state.bodyScan = 0; }
    if ((state.bodyScan = (state.bodyScan || 0) + 1) % 30 === 1) {
      for (const node of bodyMeshes(player)) if (!hidden.has(node)) hidden.set(node, node.layers.mask);
    }
    for (const [node] of hidden) node.layers.mask = HIDDEN_LAYER_MASK;
  }
  function restoreBody() {
    if (!state.hiddenBody || !state.hiddenBody.size) return;
    for (const [node, mask] of state.hiddenBody) node.layers.mask = mask;
    state.hiddenBody.clear();
    state.bodyPlayer = null;
  }

  // --- arms ------------------------------------------------------------------------------------------------
  // Measure each arm once in its own space: which axis is long, where the shoulder end and hand end are.
  function armInfo(arm) {
    if (arm.__fisterVrArm) return arm.__fisterVrArm;
    const C = state.classes;
    arm.updateWorldMatrix(true, true);
    const inverse = new C.Matrix4().copy(arm.matrixWorld).invert();
    const p = new C.Vector3();
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    arm.traverse((node) => {
      const g = node.geometry;
      if (!node.isMesh || !g) return;
      if (!g.boundingBox && typeof g.computeBoundingBox === 'function') g.computeBoundingBox();
      const b = g.boundingBox;
      if (!b) return;
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
          .applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
        const c = [p.x, p.y, p.z];
        for (let k = 0; k < 3; k++) { if (c[k] < min[k]) min[k] = c[k]; if (c[k] > max[k]) max[k] = c[k]; }
      }
    });
    if (!Number.isFinite(min[0])) { min = [-0.05, -0.5, -0.05]; max = [0.05, 0, 0.05]; }
    let axisIndex, sign;
    const spec = String(config.armAxis || 'auto').toLowerCase();
    if (/^-?[xyz]$/.test(spec)) {
      axisIndex = 'xyz'.indexOf(spec.slice(-1));
      sign = spec.startsWith('-') ? -1 : 1;
    } else {
      const extent = [0, 1, 2].map((k) => max[k] - min[k]);
      axisIndex = extent.indexOf(Math.max(...extent));
      // The hand is the end farther from the arm's pivot (arms usually hang from the shoulder: -Y).
      sign = Math.abs(min[axisIndex]) >= Math.abs(max[axisIndex]) ? -1 : 1;
    }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const shoulder = center.slice(), hand = center.slice(), axis = [0, 0, 0];
    shoulder[axisIndex] = sign < 0 ? max[axisIndex] : min[axisIndex];
    hand[axisIndex] = sign < 0 ? min[axisIndex] : max[axisIndex];
    axis[axisIndex] = sign;
    const info = { axisIndex, axis: new C.Vector3(...axis), shoulder: new C.Vector3(...shoulder), hand: new C.Vector3(...hand),
      label: (sign < 0 ? '-' : '') + 'xyz'[axisIndex] };
    arm.__fisterVrArm = info;
    log('Arm measured: long axis ' + info.label + ', length ' + (max[axisIndex] - min[axisIndex]).toFixed(2));
    return info;
  }

  function overrideArms() {
    if (config.armMode === 'off') return;
    const player = localPlayer();
    if (!player) { warnOnce('arms', 'Arm override: local player not found.'); return; }
    const C = state.classes;
    if (!state.armTmp) {
      state.armTmp = { pin: new C.Vector3(), now: new C.Vector3(), target: new C.Vector3(), dir: new C.Vector3(),
        pos: new C.Vector3(), fwd: new C.Vector3(0, 0, -1), qw: new C.Quaternion(), qc: new C.Quaternion(),
        qp: new C.Quaternion(), qo: new C.Quaternion(), e: new C.Euler(), qv: new C.Quaternion(), fwdFlat: new C.Vector3(), right: new C.Vector3() };
    }
    const t = state.armTmp;
    const rot = (config.armRotationOffsetDeg || [0, 0, 0]).map((d) => (Number(d) || 0) * Math.PI / 180);
    t.e.set(rot[0], rot[1], rot[2], 'XYZ');
    t.qo.setFromEuler(t.e);
    for (const entry of state.controllers) {
      if (!entry.source) continue;
      const hand = entry.handedness === 'left' || entry.handedness === 'right'
        ? (config.swapArms ? (entry.handedness === 'left' ? 'right' : 'left') : entry.handedness) : null;
      const arm = hand === 'left' ? player.leftArm : hand === 'right' ? player.rightArm : null;
      if (!arm || !arm.isObject3D || !arm.parent) continue;
      // The arm as the game saw it when it placed held items this frame (held items are measured against this).
      // If the game doesn't reset the arm's size, it placed items against our resized arm: remember by how much
      // (sizeSeen), so items still end up scaled with your arm.
      const origs = state.armOrig || (state.armOrig = new Map());
      if (!origs.has(arm)) origs.set(arm, new C.Matrix4());
      arm.updateWorldMatrix(true, false);
      origs.get(arm).copy(arm.matrixWorld);
      const preSize = arm.scale.length();
      gamePose(arm); // start from the game's pose (it may not re-animate the arm every frame)
      const sizes = state.armSizeSeen || (state.armSizeSeen = new Map());
      sizes.set(arm, arm.scale.length() > 1e-9 ? preSize / arm.scale.length() : 1);
      const info = armInfo(arm);
      // Size: remember the game's own scale once, then apply ours on top (restored when you leave your body).
      const scaled = state.armScaled || (state.armScaled = new Map());
      if (!scaled.has(arm)) scaled.set(arm, arm.scale.clone());
      const k = Math.max(0.1, Math.min(2, Number(config.armScale) || 1));
      arm.scale.copy(scaled.get(arm)).multiplyScalar(k);
      arm.updateWorldMatrix(true, false);
      entry.group.getWorldPosition(t.target);
      if (config.armMode === 'hand') {
        // Hand end on the controller, long axis along the controller's pointing direction.
        entry.group.getWorldQuaternion(t.qc);
        t.qw.setFromUnitVectors(info.axis, t.fwd).premultiply(t.qc);
        t.pin.copy(t.target);
        // Shift the hands forward / toward your centre line, in the direction your head faces (flattened).
        const o = config.handOffset || {};
        const scale = state.rig.scale.x || 1;
        state.view.getWorldQuaternion(t.qv);
        t.fwdFlat.set(0, 0, -1).applyQuaternion(t.qv); t.fwdFlat.y = 0;
        if (t.fwdFlat.lengthSq() < 1e-6) t.fwdFlat.set(0, 0, -1); else t.fwdFlat.normalize();
        t.right.set(-t.fwdFlat.z, 0, t.fwdFlat.x);
        const inwardSign = entry.handedness === 'left' ? 1 : -1;
        t.pin.addScaledVector(t.fwdFlat, (Number(o.forward) || 0) * scale)
          .addScaledVector(t.right, inwardSign * (Number(o.inward) || 0) * scale);
        t.pin.y += (Number(o.up) || 0) * scale;
      } else {
        // Shoulder stays where the game put it; the arm points from there toward the controller.
        t.pin.copy(info.shoulder).applyMatrix4(arm.matrixWorld);
        t.dir.subVectors(t.target, t.pin);
        if (t.dir.lengthSq() < 1e-10) continue;
        t.dir.normalize();
        t.qw.setFromUnitVectors(info.axis, t.dir);
      }
      t.qw.multiply(t.qo);
      // Mirror across the plane that splits the hand into inside/outside: flip the arm's local axis that points
      // most sideways (perpendicular to the arm and to world up).
      if (config.armMode === 'hand') { // hands always mirrored: the claws belong on the outside
        t.dir.copy(info.axis).applyQuaternion(t.qw);           // arm direction, world
        t.right.set(0, 1, 0).cross(t.dir);                      // sideways, world
        if (t.right.lengthSq() > 1e-8) {
          t.right.normalize().applyQuaternion(t.qp.copy(t.qw).invert()); // sideways, arm local
          const c = [Math.abs(t.right.x), Math.abs(t.right.y), Math.abs(t.right.z)];
          c[info.axisIndex] = -1;
          const k2 = c.indexOf(Math.max(...c));
          const sideIndex = info.sideIndex === undefined ? (info.sideIndex = k2) : info.sideIndex;
          arm.scale.setComponent(sideIndex, -arm.scale.getComponent(sideIndex));
        }
      }
      arm.parent.getWorldQuaternion(t.qp);
      arm.quaternion.copy(t.qp.invert().multiply(t.qw));
      arm.updateMatrixWorld(true);
      // Move the arm so its pinned point (shoulder or hand) lands exactly on t.pin.
      t.now.copy(config.armMode === 'hand' ? info.hand : info.shoulder).applyMatrix4(arm.matrixWorld);
      arm.getWorldPosition(t.pos).add(t.pin).sub(t.now);
      arm.position.copy(arm.parent.worldToLocal(t.pos));
      arm.updateMatrixWorld(true);
      notePoseWritten(arm);
    }
  }

  // --- the game's own pose vs ours --------------------------------------------------------------------------------
  // We overwrite some objects' local pose every frame. If the game doesn't set them again next frame, what we find
  // is our own output, so put the game's last pose back first instead of building on ours.
  function gamePose(obj) {
    const poses = state.poses || (state.poses = new Map());
    let rec = poses.get(obj);
    if (!rec) { rec = { game: null, written: null }; poses.set(obj, rec); }
    // Per part: the game may set the position every frame but never the scale, say.
    if (!rec.game) rec.game = { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
    else {
      const w = rec.written;
      for (const [k, prop] of [['p', 'position'], ['q', 'quaternion'], ['s', 'scale']]) {
        if (w && obj[prop].equals(w[k])) obj[prop].copy(rec.game[k]);
        else rec.game[k].copy(obj[prop]);
      }
    }
    rec.written = null;
    return rec;
  }
  function notePoseWritten(obj) {
    const rec = state.poses && state.poses.get(obj);
    if (rec) rec.written = { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
  }
  function restoreGamePose(obj) {
    const rec = state.poses && state.poses.get(obj);
    if (rec && rec.game) { obj.position.copy(rec.game.p); obj.quaternion.copy(rec.game.q); obj.scale.copy(rec.game.s); }
    if (state.poses) state.poses.delete(obj);
  }

  // --- held items ---------------------------------------------------------------------------------------------
  // Power-up items are separate objects the game places from its own arm animation (or, for the first-person
  // weapon, from its camera), so they floated where the animation had them, or weren't drawn at all. Each frame we
  // take where the game put the item relative to its animated arm and apply that to the arm you're moving instead:
  // same grip, and it scales with the arm. Items far from the game's hand (camera-held) are put straight in the hand.
  // Held items as the game names them on a player (from a 0.7.9 debug report). carMesh/tankMesh are vehicles, not held.
  const ITEM_KEYS = ['javelinMesh', 'bananarangMesh', 'singularityGrenadeMesh', 'stickyBombMesh', 'spellbookMesh', 'dodgeballMesh',
    'pistonMesh', 'scytheMesh', 'physicsCannonMesh', 'bearTrapHeldMesh', 'sniperRifleMesh', 'harpoonVisual', 'laserbeamOrb',
    'firstPersonWeaponRoot'];
  const isUnder = (node, ancestor) => { for (let n = node && node.parent; n; n = n.parent) if (n === ancestor) return true; return false; };
  function armFor(player, hand) {
    const gameHand = config.swapArms ? (hand === 'left' ? 'right' : 'left') : hand;
    return gameHand === 'left' ? player.leftArm : player.rightArm;
  }
  function holdItems(player, scene) {
    if (!config.holdItems || config.armMode !== 'hand' || !player || !state.armOrig) { restoreItems(); return; }
    const C = state.classes;
    const t = state.itemTmp || (state.itemTmp = { m: new C.Matrix4(), m2: new C.Matrix4(), m3: new C.Matrix4(), p: new C.Vector3(),
      q: new C.Quaternion(), s: new C.Vector3(), h: new C.Vector3(), h2: new C.Vector3() });
    const items = state.heldItems || (state.heldItems = new Map());
    const seen = new Set();
    for (const key of ITEM_KEYS) {
      const item = player[key];
      if (!item || !item.isObject3D || item === player.leftArm || item === player.rightArm || seen.has(item)) continue;
      // Already hanging off an arm (or off another item): it follows your hand by itself.
      if (isUnder(item, player.leftArm) || isUnder(item, player.rightArm)) continue;
      if (ITEM_KEYS.some((k) => player[k] && player[k] !== item && player[k].isObject3D && isUnder(item, player[k]))) continue;
      seen.add(item);
      let rec = items.get(item);
      if (!rec) { rec = { key, home: item.parent, reparented: false, arm: null }; items.set(item, rec); }
      if (!rec.reparented) rec.home = item.parent;
      gamePose(item);
      if (!item.visible) continue;
      // Where the game means the item to be (in its own parent's space, even if we moved it into the scene).
      const home = rec.home;
      t.m.compose(item.position, item.quaternion, item.scale);
      if (home) { home.updateWorldMatrix(true, false); t.m.premultiply(home.matrixWorld); }
      // Which hand: the first-person weapon goes in your aim hand; others in whichever game hand is nearest.
      if (!rec.arm || !rec.arm.parent) {
        if (key === 'firstPersonWeaponRoot') rec.arm = armFor(player, config.aimHand);
        else {
          t.p.setFromMatrixPosition(t.m);
          let best = null, bestD = Infinity;
          for (const arm of [player.leftArm, player.rightArm]) {
            const orig = arm && state.armOrig.get(arm);
            if (!orig) continue;
            const d = t.h.copy(armInfo(arm).hand).applyMatrix4(orig).distanceTo(t.p);
            if (d < bestD) { bestD = d; best = arm; }
          }
          rec.arm = best;
        }
        if (rec.arm) log('Holding ' + key + ' in your ' + (rec.arm === armFor(player, 'right') ? 'right' : 'left') + ' hand.');
      }
      const arm = rec.arm, orig = arm && state.armOrig.get(arm);
      if (!orig) continue;
      const info = armInfo(arm);
      t.p.setFromMatrixPosition(t.m);
      const offHand = t.h.copy(info.hand).applyMatrix4(orig).distanceTo(t.p);
      const avatarScale = state.rig && state.rig.scale.x || 1;
      if (key === 'firstPersonWeaponRoot' || offHand > 0.6 * avatarScale) {
        // Not attached to the game's arm: put it at your hand, facing where the controller points.
        const entry = state.controllers.find((c) => c.source && armFor(player, c.handedness) === arm);
        const k = Math.max(0.1, Math.min(2, Number(config.armScale) || 1));
        t.m.decompose(t.h2, t.q, t.s);
        t.s.multiplyScalar(k);
        t.h.copy(info.hand).applyMatrix4(arm.matrixWorld);
        if (entry) entry.group.getWorldQuaternion(t.q); else arm.getWorldQuaternion(t.q);
        t.m3.compose(t.h, t.q, t.s);
      } else {
        // Same grip as the game's animation, carried over to your arm (inherits its size and mirroring).
        t.m2.copy(orig).invert().multiply(t.m);
        t.m3.copy(arm.matrixWorld).multiply(t.m2);
        const seen = state.armSizeSeen && state.armSizeSeen.get(arm) || 1;
        if (Math.abs(seen - 1) > 1e-4) t.m3.scale(t.s.setScalar(seen));
      }
      // Objects outside the scene (e.g. a weapon on the game's camera) are never drawn in the headset: move them in.
      let top = item; while (top.parent) top = top.parent;
      if (top !== scene) { scene.add(item); rec.reparented = true; }
      item.parent.updateWorldMatrix(true, false);
      t.m2.copy(item.parent.matrixWorld).invert().multiply(t.m3);
      t.m2.decompose(item.position, item.quaternion, item.scale);
      item.updateMatrixWorld(true);
      notePoseWritten(item);
    }
    for (const [item, rec] of items) if (!seen.has(item)) { putItemBack(item, rec); items.delete(item); }
  }
  function putItemBack(item, rec) {
    if (rec.reparented) { if (rec.home) rec.home.add(item); else if (item.parent) item.parent.remove(item); }
    restoreGamePose(item);
  }
  function restoreItems() {
    if (!state.heldItems || !state.heldItems.size) return;
    for (const [item, rec] of state.heldItems) putItemBack(item, rec);
    state.heldItems.clear();
  }

  function restoreArmScale() {
    if (state.armOrig) { for (const arm of state.armOrig.keys()) restoreGamePose(arm); state.armOrig.clear(); }
    if (!state.armScaled || !state.armScaled.size) return;
    for (const [arm, scale] of state.armScaled) arm.scale.copy(scale);
    state.armScaled.clear();
  }

  // Controller boxes follow boxScale live.
  function updateBoxes() {
    const k = Math.max(0, Number(config.boxScale));
    for (const entry of state.controllers) {
      if (!entry.box) continue;
      entry.box.visible = k > 0.01;
      entry.box.scale.setScalar(k > 0.01 ? k : 1);
    }
  }

  // --- Vivecraft-style aim: the game's own aim (what the server sees) follows the right hand -------------------
  // The game aims with mouse look. Each frame we compare where the right controller points with where the game
  // camera points and send the mouse movement that closes the gap. Pixels-per-radian is learned from how the
  // camera actually responded, so in-game sensitivity doesn't matter.
  const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  function aimEntry() {
    return state.controllers.find((c) => c.source && c.handedness === config.aimHand) || null;
  }
  function learnAim(axis, sent, moved) {
    const aim = state.aim, key = 'ratio' + axis, flip = 'flip' + axis;
    if (Math.abs(sent) < 4 || Math.abs(moved) < 1e-5) return;
    const sample = moved / sent;
    if (Math.abs(sample) < 2e-5 || Math.abs(sample) > 0.05) return;
    if (Math.sign(sample) !== Math.sign(aim[key])) {
      if (++aim[flip] >= 12) { aim[key] = sample; aim[flip] = 0; }
      return;
    }
    aim[flip] = 0;
    aim[key] = aim[key] * 0.8 + sample * 0.2;
  }
  // Where the aim hand's ray points: the ground in front of you, or aimDistance metres out. Also draws the aim line.
  function aimTarget(entry) {
    const t = state.aimTmp || (state.aimTmp = { o: new state.classes.Vector3(), d: new state.classes.Vector3(), p: new state.classes.Vector3(), q: new state.classes.Quaternion(), f: new state.classes.Vector3() });
    entry.group.getWorldPosition(t.o);
    entry.group.getWorldQuaternion(t.q);
    t.d.set(0, 0, -1).applyQuaternion(t.q);
    const scale = state.rig && state.rig.scale.x || 1;
    let dist = (Number(config.aimDistance) || 10) * scale;
    const player = localPlayer();
    if (player && player.mesh && player.mesh.isObject3D) {
      // The floor: the lowest the body has been over the last few seconds. Its current height is useless mid-jump
      // or mid-air-kick (the "floor" ended up right under your hand and the aim went straight down).
      player.mesh.getWorldPosition(t.f);
      const now = performance.now();
      if (state.groundY === undefined || t.f.y <= state.groundY || now - state.groundYAt > 2500) { state.groundY = t.f.y; state.groundYAt = now; }
      if (t.d.y < -0.02) {
        const hit = (state.groundY - t.o.y) / t.d.y;
        if (hit > 0.8 * scale && hit < dist) dist = hit;
      }
    }
    // Walls, blocks, other players: whatever the ray meets first (ignoring anything within 0.8 m of the hand).
    const wall = safe('aim raycast', () => raycastWorld(t.o, t.d, dist, 0.8 * scale));
    if (typeof wall === 'number' && wall < dist) dist = wall;
    t.p.copy(t.o).addScaledVector(t.d, dist);
    state.aimDist = dist / scale;
    return t.p;
  }
  // Cheap world ray test against boxes around the arena's meshes (refreshed every ~1.5 s; other players every frame).
  function raycastWorld(o, d, maxDist, minDist) {
    const scene = state.threeScene;
    if (!scene || !state.classes) return null;
    const now = performance.now();
    const C = state.classes;
    const cache = state.rayCache || (state.rayCache = { at: 0, boxes: [], scene: null, v: new C.Vector3(), m: null });
    const me = localPlayer();
    const players = (() => { const gs = gameScene(); const p = gs && gs.players; try { return p && typeof p.values === 'function' ? [...p.values()] : []; } catch { return []; } })();
    if (now - cache.at > 1500 || cache.scene !== scene) {
      cache.at = now; cache.scene = scene; cache.boxes = [];
      const skip = new Set([state.rig]);
      for (const p of players) for (const k of ['mesh', 'avatarVisualRoot', 'avatarFlipPivot', ...ITEM_KEYS]) if (p && p[k] && p[k].isObject3D) skip.add(p[k]);
      const v = cache.v;
      const walk = (node) => {
        if (skip.has(node) || node.visible === false) return;
        const g = node.geometry;
        if (node.isMesh && !node.isSkinnedMesh && g && g.attributes && g.attributes.position && !(node.material && node.material.transparent && node.material.opacity < 0.5)) {
          if (!g.boundingBox && typeof g.computeBoundingBox === 'function') { try { g.computeBoundingBox(); } catch {} }
          const b = g.boundingBox;
          if (b && Number.isFinite(b.min.x)) {
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < 8; i++) {
              v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(node.matrixWorld);
              const c = [v.x, v.y, v.z];
              for (let k = 0; k < 3; k++) { if (c[k] < min[k]) min[k] = c[k]; if (c[k] > max[k]) max[k] = c[k]; }
            }
            // Skip huge boxes (sky, the ground) and specks; the ground is handled as a plane.
            const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
            const thin = Math.min(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
            if (size > 0.05 && (size < 200 || thin < 3)) cache.boxes.push([min, max]); // huge but flat = floor slab
          }
        }
        for (const child of node.children) walk(child);
      };
      walk(scene);
    }
    const hitBox = (min, max) => {
      let t0 = minDist, t1 = maxDist;
      const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
      for (let k = 0; k < 3; k++) {
        if (Math.abs(da[k]) < 1e-9) { if (oa[k] < min[k] || oa[k] > max[k]) return Infinity; continue; }
        let a = (min[k] - oa[k]) / da[k], b = (max[k] - oa[k]) / da[k];
        if (a > b) { const x = a; a = b; b = x; }
        if (a > t0) t0 = a; if (b < t1) t1 = b;
        if (t0 > t1) return Infinity;
      }
      return t0;
    };
    let best = Infinity;
    const inside = (min, max) => o.x > min[0] && o.x < max[0] && o.y > min[1] && o.y < max[1] && o.z > min[2] && o.z < max[2];
    for (const [min, max] of cache.boxes) { if (inside(min, max)) continue; const t = hitBox(min, max); if (t < best) best = t; }
    // Other players (they move): a rough box around each body.
    const v = cache.v;
    for (const p of players) {
      if (!p || p === me || !p.mesh || !p.mesh.isObject3D) continue;
      p.mesh.getWorldPosition(v);
      const t = hitBox([v.x - 0.5, v.y, v.z - 0.5], [v.x + 0.5, v.y + 2.2, v.z + 0.5]);
      if (t < best) best = t;
    }
    return best;
  }
  function updateAimLaser() {
    const entry = aimEntry();
    const show = !!(config.aimLaser && config.aimMode === 'hand' && entry && state.gameplay && !state.ragdoll && !state.uiHit && state.classes && state.classes.Mesh);
    let laser = state.aimLaser;
    state.aimLineShown = show;
    if (!show) { if (laser) laser.visible = false; return; }
    if (!laser) {
      const g = boxGeometry(0.003, 0.003, 1);
      g.translate(0, 0, -0.5);
      laser = state.aimLaser = overlayMesh(g, 0xff5555, 1e6 - 1);
      laser.material.opacity = 0.45;
      laser.material.depthTest = true;
      laser.name = 'fister-vr-aim-laser';
    }
    if (laser.parent !== entry.group) entry.group.add(laser);
    if (state.aimDist === undefined) aimTarget(entry);
    laser.scale.set(1, 1, Math.max(0.05, state.aimDist || 1));
    laser.visible = true;
  }
  function steerAim() {
    const aim = state.aim;
    if (config.aimMode !== 'hand') return;
    const entry = aimEntry();
    if (!entry || !state.gameplay || state.uiHit || state.uiPress) { aim.lastYaw = null; return; }
    const { tmp, gameCamera } = state;
    // While the game itself turns or flips you (air kick, acrobatic flip, finisher, emote camera), leave the aim
    // alone: the camera moves without our mouse input, which used to corrupt the learned mouse ratio.
    const me = localPlayer();
    if (me && (me.airKickPoseActive === true || Number(me.acrobaticFlipVisualRemaining) > 0 || me.finisherRenderActive === true
        || me.emoteCameraAnchorLocked === true || me.replayFacingActive === true)) { aim.lastYaw = null; state.aimPaused = true; return; }
    state.aimPaused = false;
    const target = aimTarget(entry);
    // Direction from your body (where the game's aim starts) to the spot your hand points at.
    const player = localPlayer();
    let from;
    if (config.aimOrigin !== 'camera' && player && player.mesh && player.mesh.isObject3D) {
      // Mesh root sits at body + 0.2; the shoulder is 1 unit straight up (world up, as the server adds it). Not the
      // mesh's own up: that flips over during air kicks and flips.
      player.mesh.getWorldPosition(tmp.v4);
      tmp.v4.y += 1 * Math.abs(player.mesh.getWorldScale(tmp.v3).y || 1);
      from = tmp.v4;
    } else from = gameCamera.getWorldPosition(tmp.v4);
    tmp.v3.subVectors(target, from);
    if (tmp.v3.lengthSq() < 1e-6) { entry.group.getWorldQuaternion(tmp.q3); tmp.v3.set(0, 0, -1).applyQuaternion(tmp.q3); }
    tmp.v3.normalize();
    const wantYaw = Math.atan2(-tmp.v3.x, -tmp.v3.z);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, tmp.v3.y)));
    gameCamera.getWorldQuaternion(tmp.q);
    tmp.e.setFromQuaternion(tmp.q, 'YXZ');
    const yaw = tmp.e.y, pitch = tmp.e.x;
    if (aim.lastYaw !== null) {
      const movedYaw = wrapAngle(yaw - aim.lastYaw), movedPitch = pitch - aim.lastPitch;
      learnAim('X', aim.lastDx, movedYaw);
      learnAim('Y', aim.lastDy, movedPitch);
      if (Math.abs(aim.lastDx) + Math.abs(aim.lastDy) >= 4 && Math.abs(movedYaw) + Math.abs(movedPitch) < 1e-6) aim.stuck++;
      else if (Math.abs(movedYaw) + Math.abs(movedPitch) > 1e-6) aim.stuck = 0;
      if (aim.stuck === 90) { setStatus('Aim isn\'t reaching the game. Press the right B button to wake input.'); reassertFocus('aim stuck'); }
    }
    const dead = (Number(config.aimDeadzoneDeg) || 0) * Math.PI / 180;
    const gain = Math.min(1, Math.max(0.05, Number(config.aimGain) || 0.6));
    const errYaw = wrapAngle(wantYaw - yaw);
    const errPitch = config.aimPitch ? wantPitch - pitch : 0;
    const clamp = (n) => Math.max(-400, Math.min(400, n));
    const dx = Math.abs(errYaw) > dead ? clamp(Math.round(errYaw * gain / aim.ratioX)) : 0;
    const dy = Math.abs(errPitch) > dead ? clamp(Math.round(errPitch * gain / aim.ratioY)) : 0;
    aim.lastYaw = yaw; aim.lastPitch = pitch; aim.lastDx = dx; aim.lastDy = dy;
    if (dx || dy) sendMouseMove(dx, dy);
  }

  // --- page helpers ------------------------------------------------------------------------------------------
  const isOurs = (el) => !!(el && el.closest && el.closest('#fister-vr-bar, #fister-vr-status, #fister-vr-mirror, #fister-steam-overlay-heartbeat'));
  const isGameCanvas = (el) => !!(el && ((state.renderer && el === state.renderer.domElement) || [...state.renderers].some((r) => r.domElement === el)));

  // --- VR menus: the game's 2D interface on a panel in front of your body ------------------------------------------
  // Fister's HUD and menus (health, style/souls, scoreboard, charge bar, main menu, settings, loading screens) are a
  // flat web layer over the 3D view; the headset never sees it. We repaint that layer onto a texture and show it on a
  // panel that floats in front of you like the in-world health bars: it stays in place while you look around and
  // catches up when you turn far. Your right hand points a laser at it to click, drag sliders and scroll.
  const ALL_LAYERS = 0xffffffff >>> 0;
  function showOnAllLayers(object) {
    // The game camera may only render some layers; our own objects must show regardless.
    object.layers.mask = ALL_LAYERS & ~(1 << 31);
  }

  function textureCtorFrom(t) {
    if (!t || t.isTexture !== true) return null;
    let ctor = t.constructor;
    while (typeof ctor === 'function' && ctor !== Function.prototype) {
      let probe = null;
      try { probe = new ctor(); } catch {}
      if (probe && probe.isTexture === true && !probe.isCubeTexture && !probe.isDataTexture && !probe.isVideoTexture
          && !probe.isCompressedTexture && !probe.isDepthTexture && !probe.isFramebufferTexture) return ctor;
      ctor = Object.getPrototypeOf(ctor);
    }
    return null;
  }

  function findTextureCtor(scene) {
    const candidates = [];
    if (state.xrTarget && state.xrTarget.texture) candidates.push(state.xrTarget.texture);
    if (state.renderer) { const rt = state.renderer.getRenderTarget(); if (rt && rt.texture) candidates.push(rt.texture); }
    if (scene) {
      candidates.push(scene.background, scene.environment);
      scene.traverse((node) => {
        if (candidates.length > 64 || !node.material) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!material) continue;
          for (const key of ['map', 'emissiveMap', 'alphaMap', 'envMap', 'matcap', 'gradientMap']) if (material[key]) candidates.push(material[key]);
          if (material.uniforms) for (const u of Object.values(material.uniforms)) if (u && u.value && u.value.isTexture) candidates.push(u.value);
        }
      });
    }
    for (const t of candidates) { const ctor = textureCtorFrom(t); if (ctor) return ctor; }
    return null;
  }

  function planeGeometry() {
    const { Mesh, Attribute } = state.classes;
    const geometry = new Mesh().geometry;
    geometry.setAttribute('position', new Attribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geometry.setAttribute('uv', new Attribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
    geometry.computeBoundingSphere();
    return geometry;
  }

  function overlayMesh(geometry, color, order) {
    const mesh = new state.classes.Mesh();
    mesh.geometry = geometry;
    const m = mesh.material;
    if (m.color) m.color.setHex(color);
    m.transparent = true;
    m.depthTest = false;
    m.depthWrite = false;
    m.toneMapped = false;
    m.side = 2; // DoubleSide: visible whichever way it ends up facing
    m.needsUpdate = true;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    showOnAllLayers(mesh);
    return mesh;
  }

  function setupMenu() {
    if (!config.menu || config.menu.mode === 'off') { state.menuProblem = 'turned off'; return; }
    const C = state.classes;
    if (!C || !C.Mesh || !C.Attribute) { state.menuProblem = 'three.js classes not found yet'; return; }
    if (!C.Texture) C.Texture = findTextureCtor(state.threeScene);
    if (!C.Texture) { state.menuProblem = 'no texture class found yet'; return; }
    const width = Math.max(512, Math.min(2048, Number(config.menu.resolution) || 1600));
    const aspect = screenAspect();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * aspect);
    const ctx = canvas.getContext('2d');
    const texture = new C.Texture(canvas);
    if ('colorSpace' in texture) texture.colorSpace = 'srgb'; else if ('encoding' in texture) texture.encoding = 3001;
    texture.generateMipmaps = false;
    texture.minFilter = 1006;
    texture.magFilter = 1006;

    const panel = overlayMesh(planeGeometry(), 0xffffff, 1e6);
    panel.material.map = texture;
    panel.material.needsUpdate = true;
    panel.name = 'fister-vr-menu';
    const w = Number(config.menu.width) || 1.6;
    panel.scale.set(w, w * aspect, 1);
    state.rig.add(panel); // rig space = your play space; we place it in front of you every frame

    const dot = overlayMesh(boxGeometry(0.014, 0.014, 0.002), 0xffffff, 1e6 + 2);
    dot.visible = false;
    state.rig.add(dot);
    const laserGeometry = boxGeometry(0.004, 0.004, 1);
    laserGeometry.translate(0, 0, -0.5);
    const laser = overlayMesh(laserGeometry, 0xffffff, 1e6 + 1);
    laser.material.opacity = 0.55;
    laser.visible = false;

    state.menu = { canvas, ctx, texture, panel, dot, laser, aspect, yaw: null, dirty: true, lastDraw: 0, draws: 0,
      drawMs: 0, nodes: 0, noImages: false };
    state.menuProblem = null;
    // Redraw when the interface changes, plus a slow heartbeat for things that animate without DOM changes.
    try {
      state.menuObserver = new MutationObserver(() => { if (state.menu) state.menu.dirty = true; });
      state.menuObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch {}
    log('Menu panel ready (' + canvas.width + 'x' + canvas.height + ').');
  }

  function sameOrigin(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin || u.protocol === 'data:' || u.protocol === 'blob:'; }
    catch { return false; }
  }
  // Image cache for the menu painter. Same-origin and data: images draw directly; other sites' images are re-fetched
  // with CORS (works when the host allows it) so they don't poison the texture. Inline SVG icons are serialised to
  // data: images. Anything still loading redraws the panel when it arrives.
  const imageCache = new Map();
  function cachedImage(url, crossOrigin) {
    let entry = imageCache.get(url);
    if (!entry) {
      if (imageCache.size > 400) imageCache.delete(imageCache.keys().next().value);
      const img = new Image();
      entry = { img, ok: false, failed: false };
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.onload = () => { entry.ok = true; if (state.menu) state.menu.dirty = true; if (state.standalone && state.standalone.menu) state.standalone.menu.dirty = true; };
      img.onerror = () => { entry.failed = true; };
      img.src = url;
      imageCache.set(url, entry);
    }
    return entry.ok ? entry.img : null;
  }
  function imageFor(url) {
    if (!url) return null;
    return sameOrigin(url) ? cachedImage(url, false) : cachedImage(url, true);
  }
  function svgImage(el, cs) {
    if (el.querySelector('foreignObject')) return null;
    const clone = el.cloneNode(true);
    const r = el.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(Math.max(1, Math.round(r.width))));
    clone.setAttribute('height', String(Math.max(1, Math.round(r.height))));
    clone.setAttribute('style', 'color:' + cs.color + ';fill:' + cs.fill + ';stroke:' + cs.stroke);
    const text = new XMLSerializer().serializeToString(clone);
    if (text.length > 60000) return null;
    return cachedImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text), false);
  }
  const transparentColor = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c);

  // In a match (no menu open) the panel is a HUD: only the game's overlays (health, style, scoreboard, charge bar),
  // see-through, without the full-screen containers behind the game canvas (they painted a big gray slab).
  const hudMode = () => !!(state.gameplay && !state.ragdoll && !state.pointerLockReleased && !state.emoteWheel);

  // --- 1920x1080 virtual screen ----------------------------------------------------------------------------------
  // A transformed <body> is the containing block for position:fixed elements, so giving it a 1920x1080 box makes the
  // game's overlay UI lay out as on a 1080p monitor. It's scaled down to fit the real window so the laser can still
  // find elements with elementFromPoint. Undone when VR ends.
  const VSCREEN_W = 1920, VSCREEN_H = 1080;
  // Viewport units and screen-size media queries still follow the real window, so while the virtual screen is on:
  // stylesheet vw/vh values become 1080p pixels, width/height media rules are re-decided for 1920x1080, and the
  // game's scripts see innerWidth/innerHeight = 1920x1080. All of it is put back when VR ends.
  const VUNIT = /(-?\d*\.?\d+)(d|s|l)?(vw|vh|vmin|vmax)\b/g;
  const toPx = (val) => val.replace(VUNIT, (m, n, _x, u) => {
    const per = u === 'vw' ? VSCREEN_W : u === 'vh' ? VSCREEN_H : u === 'vmin' ? Math.min(VSCREEN_W, VSCREEN_H) : Math.max(VSCREEN_W, VSCREEN_H);
    return (Number(n) * per / 100).toFixed(2).replace(/\.?0+$/, '') + 'px';
  });
  function mediaMatchesVirtual(text) {
    // true / false, or null when it can't be decided (leave the rule alone).
    if (!/width|height|aspect|orientation/i.test(text)) return null;
    const lenPx = (v) => { const m = /^\s*(-?[\d.]+)\s*(px|em|rem)?\s*$/.exec(v); return m ? Number(m[1]) * (m[2] === 'em' || m[2] === 'rem' ? 16 : 1) : NaN; };
    const W = VSCREEN_W, H = VSCREEN_H;
    let any = false;
    for (const part of text.split(',')) {
      let p = part.trim().toLowerCase(), ok = true, neg = false;
      if (p.startsWith('not ')) { neg = true; p = p.slice(4); }
      if (/^only\s+/.test(p)) p = p.replace(/^only\s+/, '');
      if (/^print\b/.test(p)) ok = false;
      for (const c of p.match(/\(([^()]*)\)/g) || []) {
        const body = c.slice(1, -1).trim();
        let m;
        if ((m = /^(min|max)-(width|height)\s*:\s*(.+)$/.exec(body))) { const v = lenPx(m[3]), have = m[2] === 'width' ? W : H; if (isNaN(v)) return null; ok = ok && (m[1] === 'min' ? have >= v : have <= v); }
        else if ((m = /^(width|height)\s*(<=|>=|<|>)\s*(.+)$/.exec(body))) { const v = lenPx(m[3]), have = m[1] === 'width' ? W : H; if (isNaN(v)) return null; ok = ok && ({ '<': have < v, '>': have > v, '<=': have <= v, '>=': have >= v })[m[2]]; }
        else if ((m = /^orientation\s*:\s*(\w+)$/.exec(body))) ok = ok && (m[1] === 'landscape');
        else if ((m = /^(min|max)-aspect-ratio\s*:\s*([\d.]+)\s*\/\s*([\d.]+)$/.exec(body))) { const r = Number(m[2]) / Number(m[3]); ok = ok && (m[1] === 'min' ? W / H >= r : W / H <= r); }
        else if (/width|height|aspect/.test(body)) return null;
        else { try { ok = ok && window.matchMedia('(' + body + ')').matches; } catch { return null; } }
      }
      if (neg) ok = !ok;
      if (ok) any = true;
    }
    return any;
  }
  function rewriteRules(rules, undo, seen) {
    for (const rule of rules) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      if (rule.media && rule.cssRules && typeof rule.media.mediaText === 'string') {
        const verdict = mediaMatchesVirtual(rule.media.mediaText);
        if (verdict !== null) { const old = rule.media.mediaText; rule.media.mediaText = verdict ? 'all' : 'not all'; undo.push(() => { rule.media.mediaText = old; }); }
      }
      if (rule.style) {
        const st = rule.style;
        for (let i = 0; i < st.length; i++) {
          const name = st[i], val = st.getPropertyValue(name);
          if (!VUNIT.test(val)) continue;
          VUNIT.lastIndex = 0;
          const prio = st.getPropertyPriority(name);
          st.setProperty(name, toPx(val), prio);
          undo.push(() => st.setProperty(name, val, prio));
        }
        VUNIT.lastIndex = 0;
      }
      if (rule.cssRules && rule.type !== 7) { try { rewriteRules(rule.cssRules, undo, seen); } catch {} }
    }
  }
  function rewritePageForVirtualScreen() {
    const v = state.vscreen;
    if (!v) return;
    for (const sheet of document.styleSheets) { let rules = null; try { rules = sheet.cssRules; } catch {} if (rules) rewriteRules(rules, v.undo, v.seen); }
    for (const el of document.querySelectorAll('[style*="vw"], [style*="vh"], [style*="vmin"], [style*="vmax"]')) {
      if (el === document.body || isOurs(el)) continue;
      const before = el.getAttribute('style');
      const after = toPx(before);
      VUNIT.lastIndex = 0;
      if (after !== before) { el.setAttribute('style', after); v.undo.push(() => { if (el.getAttribute('style') === after) el.setAttribute('style', before); }); }
    }
  }
  function spoofWindowSize(on) {
    const keys = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'];
    if (on) {
      if (state.winDescriptors) return;
      state.winDescriptors = {};
      const values = { innerWidth: VSCREEN_W, innerHeight: VSCREEN_H, outerWidth: VSCREEN_W, outerHeight: VSCREEN_H };
      for (const k of keys) {
        state.winDescriptors[k] = Object.getOwnPropertyDescriptor(window, k) || null;
        try { Object.defineProperty(window, k, { configurable: true, enumerable: true, get: () => values[k], set() {} }); } catch {}
      }
    } else if (state.winDescriptors) {
      for (const k of keys) {
        const d = state.winDescriptors[k];
        try { if (d) Object.defineProperty(window, k, d); else delete window[k]; } catch {}
      }
      state.winDescriptors = null;
    }
  }
  function applyVirtualScreen(on) {
    const body = document.body;
    if (!body) return;
    if (on && config.virtualScreen !== false) {
      if (!state.vscreen) {
        state.vscreen = { style: body.getAttribute('style'), undo: [], seen: new WeakSet(), scanned: -Infinity };
        spoofWindowSize(true);
        log('Virtual screen on: the page is laid out at 1920x1080 while in VR.');
      }
      const now = performance.now();
      if (now - state.vscreen.scanned > 2000) { state.vscreen.scanned = now; safe('virtual screen styles', rewritePageForVirtualScreen); }
      const win = winSize();
      const k = Math.min(win.w / VSCREEN_W, win.h / VSCREEN_H);
      if (state.vscreen.k === k) return;
      state.vscreen.k = k;
      const set = (name, value) => body.style.setProperty(name, value, 'important');
      set('position', 'fixed'); set('left', '0px'); set('top', '0px'); set('margin', '0px');
      set('width', VSCREEN_W + 'px'); set('height', VSCREEN_H + 'px'); set('overflow', 'hidden');
      set('transform', 'scale(' + k + ')'); set('transform-origin', '0 0');
      try { window.dispatchEvent(new Event('resize')); } catch {}
    } else if (state.vscreen) {
      const v = state.vscreen;
      state.vscreen = null;
      spoofWindowSize(false);
      for (const fn of v.undo.reverse()) { try { fn(); } catch {} }
      if (v.style === null) body.removeAttribute('style'); else body.setAttribute('style', v.style);
      try { window.dispatchEvent(new Event('resize')); } catch {}
    }
  }
  // The screen area being shown, in page (visual) pixels, and how many visual pixels one CSS pixel is.
  function screenRect() {
    if (state.vscreen && document.body) {
      const r = document.body.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height, k: r.width / VSCREEN_W };
    }
    const win = winSize();
    return { x: 0, y: 0, w: win.w, h: win.h, k: 1 };
  }
  const screenAspect = () => (config.virtualScreen !== false ? VSCREEN_H / VSCREEN_W : Math.min(1, Math.max(0.3, winSize().h / winSize().w)));
  const uiOpacity = () => Math.max(0.2, Math.min(1, Number(config.uiOpacity) || 0.9));
  function paintDom(menu) {
    const hud = hudMode();
    if (state.presenting) applyVirtualScreen(true);
    const canvas = menu.canvas, ctx = menu.ctx;
    // Positions: page (visual) px -> canvas px. CSS sizes (fonts, borders, padding) are in CSS px: times k first.
    const S = screenRect(), k = S.k;
    const W = canvas.width, H = canvas.height, sx = W / S.w, sy = H / S.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, -S.x * sx, -S.y * sy);
    let budget = 5000, nodes = 0, unverified = [];
    const verified = menu.verified || (menu.verified = new WeakSet());
    const drawSource = (src, key, x, y, w, h) => {
      try { ctx.drawImage(src, x, y, w, h); if (!verified.has(key)) unverified.push(key); } catch {}
    };
    const range = document.createRange();
    const big = (r) => r.width * r.height > 0.5 * S.w * S.h;

    const boxPath = (r, cs) => {
      const x = r.left * sx, y = r.top * sy, w = r.width * sx, h = r.height * sy;
      const radius = Math.min((parseFloat(cs.borderTopLeftRadius) || 0) * k, r.width / 2, r.height / 2) * sx;
      ctx.beginPath();
      if (radius > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h);
    };
    const paintBox = (r, cs, alpha) => {
      let bg = cs.backgroundColor;
      if (transparentColor(bg) && cs.backgroundImage && cs.backgroundImage !== 'none') {
        const m = cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i); // gradient: use its first colour
        if (m) bg = m[0];
      }
      const bw = (parseFloat(cs.borderTopWidth) || 0) * k;
      const sides = ['Top', 'Right', 'Bottom', 'Left'].map((n) => ({ w: (parseFloat(cs['border' + n + 'Width']) || 0) * k, c: cs['border' + n + 'Color'], s: cs['border' + n + 'Style'] }));
      const uniform = sides.every((b) => b.w === sides[0].w && b.c === sides[0].c && b.s === sides[0].s);
      const anySide = sides.some((b) => b.w > 0 && b.s !== 'none' && !transparentColor(b.c));
      const hasBorder = uniform ? (bw > 0 && cs.borderTopStyle !== 'none' && !transparentColor(cs.borderTopColor)) : false;
      const bgUrl = cs.backgroundImage && cs.backgroundImage !== 'none' ? (cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/) || [])[1] : null;
      const shadow = cs.boxShadow && cs.boxShadow !== 'none' && /inset/.test(cs.boxShadow);
      if (transparentColor(bg) && !hasBorder && !shadow && !anySide && !bgUrl) return;
      ctx.globalAlpha = alpha;
      boxPath(r, cs);
      if (!transparentColor(bg)) { ctx.fillStyle = bg; ctx.fill(); }
      if (bgUrl && !menu.noImages) {
        const img = imageFor(bgUrl);
        if (img && img.naturalWidth) {
          // background-size: contain / cover / explicit sizes are approximated; repeat is drawn once.
          const x = r.left * sx, y = r.top * sy, w = r.width * sx, h = r.height * sy;
          const size = cs.backgroundSize || 'auto';
          let dw = w, dh = h;
          const ir = img.naturalWidth / img.naturalHeight;
          if (size === 'contain') { if (w / h > ir) { dh = h; dw = h * ir; } else { dw = w; dh = w / ir; } }
          else if (size === 'cover') { if (w / h > ir) { dw = w; dh = w / ir; } else { dh = h; dw = h * ir; } }
          else if (size === 'auto' || size === 'auto auto') { dw = Math.min(w, img.naturalWidth * k * sx); dh = dw / ir; }
          const pos = (cs.backgroundPosition || '50% 50%').split(' ');
          const frac = (v) => v.endsWith('%') ? parseFloat(v) / 100 : (v === 'center' ? 0.5 : v === 'right' || v === 'bottom' ? 1 : 0);
          ctx.save(); boxPath(r, cs); ctx.clip();
          drawSource(img, img, x + (w - dw) * frac(pos[0] || '50%'), y + (h - dh) * frac(pos[1] || pos[0] || '50%'), dw, dh);
          ctx.restore();
        }
      }
      if (hasBorder) { ctx.lineWidth = Math.max(1, bw * sx); ctx.strokeStyle = cs.borderTopColor; ctx.stroke(); }
      else if (anySide) {
        const x = r.left * sx, y = r.top * sy, w = r.width * sx, h = r.height * sy;
        const [t, rt, b, l] = sides;
        const draw = (side, fx, fy, fw, fh) => { if (side.w > 0 && side.s !== 'none' && !transparentColor(side.c)) { ctx.fillStyle = side.c; ctx.fillRect(fx, fy, fw, fh); } };
        draw(t, x, y, w, t.w * sy); draw(b, x, y + h - b.w * sy, w, b.w * sy);
        draw(l, x, y, l.w * sx, h); draw(rt, x + w - rt.w * sx, y, rt.w * sx, h);
      }
      if (shadow) {
        // Win95-style bevels are drawn with inset box-shadows: light top/left, dark bottom/right.
        const colors = cs.boxShadow.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) || [];
        const light = colors.find((c) => /255|#f|#e|#d/i.test(c)) || 'rgba(255,255,255,0.8)';
        const dark = colors.find((c) => c !== light) || 'rgba(0,0,0,0.5)';
        const x = r.left * sx, y = r.top * sy, w = r.width * sx, h = r.height * sy, t = Math.max(1, 2 * k * sx);
        ctx.fillStyle = light; ctx.fillRect(x, y, w, t); ctx.fillRect(x, y, t, h);
        ctx.fillStyle = dark; ctx.fillRect(x, y + h - t, w, t); ctx.fillRect(x + w - t, y, t, h);
      }
    };
    const setFont = (cs) => {
      const size = parseFloat(cs.fontSize) || 14;
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + (size * k * sy).toFixed(1) + 'px ' + cs.fontFamily;
      ctx.fillStyle = cs.color;
      ctx.textBaseline = 'middle';
      return size * k;
    };
    const caseOf = (cs, str) => cs.textTransform === 'uppercase' ? str.toUpperCase() : cs.textTransform === 'lowercase' ? str.toLowerCase() : str;
    const paintText = (node, cs, alpha) => {
      const raw = node.nodeValue;
      if (!raw || !raw.trim()) return;
      const size = setFont(cs);
      ctx.globalAlpha = alpha;
      const outline = cs.textShadow && cs.textShadow !== 'none';
      if (outline) { ctx.lineWidth = Math.max(2, size * sy * 0.18); ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineJoin = 'round'; }
      const put = (str, rect) => {
        if (!rect || rect.width === 0) return;
        const x = rect.left * sx, y = (rect.top + rect.height / 2) * sy;
        if (outline) ctx.strokeText(str, x, y);
        ctx.fillText(str, x, y);
      };
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (rects.length <= 1) { put(caseOf(cs, raw.trim()), rects[0]); return; }
      const re = /\S+/g;
      let match, count = 0;
      while ((match = re.exec(raw)) && count++ < 400) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        put(caseOf(cs, match[0]), range.getClientRects()[0]);
      }
    };

    const walk = (el, alpha, inWidget) => {
      if (--budget < 0 || isOurs(el)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const opacity = parseFloat(cs.opacity);
      const a = alpha * (Number.isFinite(opacity) ? opacity : 1);
      if (a < 0.02) return;
      nodes++;
      const visible = cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
      const r = el.getBoundingClientRect();
      const onScreen = r.right > S.x && r.bottom > S.y && r.left < S.x + S.w && r.top < S.y + S.h;
      const tag = el.tagName;
      if (visible && onScreen && r.width > 0 && r.height > 0 && isGameCanvas(el)) {
        // Menu-only VR: the game's 3D previews (loadout, cosmetics) are live canvases; draw their latest snapshot.
        const snap = state.standalone && !state.standalone.handedOff ? state.canvasSnaps.get(el) : null;
        if (snap && snap.ok) { ctx.globalAlpha = a; ctx.drawImage(snap.canvas, r.left * sx, r.top * sy, r.width * sx, r.height * sy); }
      }
      if (visible && onScreen && r.width > 0 && r.height > 0 && el !== document.body && el !== document.documentElement && !isGameCanvas(el)) {
        // In the HUD, full-width bars / tall columns are layout containers: look inside them for the widgets.
        // In a match, full-screen containers (the gray page behind the game view) are see-through.
        if (!(hud && big(r))) paintBox(r, cs, a);
        ctx.globalAlpha = a;
        if (tag === 'IMG' && !menu.noImages && el.complete && el.naturalWidth) {
          const src = el.currentSrc || el.src;
          const img = sameOrigin(src) ? el : imageFor(src);
          if (img) drawSource(img, img, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
        } else if ((tag === 'svg' || tag === 'SVG') && !menu.noImages && r.width * r.height < 0.25 * S.w * S.h) {
          const img = svgImage(el, cs);
          if (img) drawSource(img, img, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
        } else if (tag === 'VIDEO' && !menu.noImages && el.readyState >= 2 && sameOrigin(el.currentSrc || el.src)) {
          drawSource(el, el, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
        } else if (tag === 'CANVAS' && !menu.noImages && !big(r) && !(el.width * el.height > 0.3 * winSize().w * winSize().h)) {
          drawSource(el, el, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
        } else if ((tag === 'INPUT' || tag === 'TEXTAREA') && el.type === 'range') {
          const min = Number(el.min) || 0, max = Number(el.max) || 100, v = Number(el.value);
          const f = max > min ? (v - min) / (max - min) : 0;
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(r.left * sx, (r.top + r.height / 2 - 2) * sy, r.width * sx, 4 * sy);
          ctx.fillStyle = '#ddd'; ctx.fillRect((r.left + f * r.width - 5) * sx, r.top * sy, 10 * sx, r.height * sy);
        } else if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
          ctx.fillStyle = '#fff'; ctx.fillRect(r.left * sx, r.top * sy, r.width * sx, r.height * sy);
          if (el.checked) { ctx.fillStyle = '#111'; ctx.fillRect((r.left + r.width * 0.25) * sx, (r.top + r.height * 0.25) * sy, r.width * 0.5 * sx, r.height * 0.5 * sy); }
        } else if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && el.type !== 'password' && el.type !== 'hidden') {
          const text = tag === 'SELECT' ? (el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text + '  ▾' : '') : String(el.value || el.placeholder || '');
          if (text) {
            setFont(cs);
            if (!el.value && tag !== 'SELECT') ctx.globalAlpha = a * 0.5;
            ctx.fillText(text.slice(0, 200), (r.left + (parseFloat(cs.paddingLeft) || 4) * k) * sx, (r.top + r.height / 2) * sy);
          }
        }
      }
      if (tag === 'CANVAS' || tag === 'SELECT' || tag === 'svg' || tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE') return;
      // Scroll areas and clipped boxes: keep their children inside the box.
      const clip = cs.overflow !== 'visible' && cs.overflowY !== 'visible' && r.width > 0 && r.height > 0;
      if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(r.left * sx, r.top * sy, r.width * sx, r.height * sy); ctx.clip(); }
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) walk(child, a, inWidget);
        else if (child.nodeType === 3 && visible && onScreen) paintText(child, cs, a);
      }
      if (clip) ctx.restore();
    };
    if (document.body) walk(document.body, 1, false);
    ctx.globalAlpha = 1;
    // A cross-origin image would make the texture unusable. Checking costs a GPU readback, so only do it the first
    // time a new image/canvas is drawn.
    if (unverified.length) {
      try { ctx.getImageData(0, 0, 1, 1); for (const k of unverified) verified.add(k); }
      catch {
        if (!menu.noImages) { menu.noImages = true; warn('Menu panel: a cross-origin image blocked it; redrawing without images.'); return paintDom(menu); }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    menu.nodes = nodes;
    menu.texture.needsUpdate = true;
  }

  function hitInteractive(el) {
    if (!el || el === document.body || el === document.documentElement || isGameCanvas(el) || isOurs(el)) return false;
    if (!hudMode()) return true;
    const control = el.closest && el.closest('button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="menuitem"], [onclick]');
    if (control) return true;
    try { return getComputedStyle(el).cursor === 'pointer'; } catch { return false; }
  }

  function updateMenu() {
    const menu = state.menu;
    if (!menu) return;
    const now = performance.now();
    // Redraw: on change (capped), at least once a second for things that animate without DOM changes.
    // Adaptive: never spend more than ~8% of the time painting (a 4 ms paint allows ~12/s, a 15 ms paint ~5/s).
    const inMatch = state.gameplay && !state.uiHit && !state.pointerLockReleased;
    if (menu.wasHud !== hudMode()) { menu.wasHud = hudMode(); menu.dirty = true; menu.lastDraw = 0; }
    const minGap = Math.max(1000 / Math.max(1, Number(config.menu.maxFps) || 12), (menu.drawMs || 0) * (inMatch ? 25 : 12));
    if ((menu.dirty && now - menu.lastDraw > minGap) || now - menu.lastDraw > (inMatch ? 3000 : 1000)) {
      menu.dirty = false;
      menu.lastDraw = now;
      const t0 = performance.now();
      paintDom(menu);
      const dt = performance.now() - t0;
      menu.drawMs = menu.drawMs ? menu.drawMs * 0.8 + dt * 0.2 : dt;
      menu.draws++;
    }

    // Place the panel in front of you (rig space), below eye level, tilted toward you. It keeps its heading
    // until your head turns more than followDeg away, then catches up smoothly.
    const { tmp } = state;
    const view = state.view;
    const head = view.position; // last XR pose, rig space
    tmp.e.setFromQuaternion(view.quaternion, 'YXZ');
    const headYaw = tmp.e.y;
    if (menu.yaw === null) menu.yaw = headYaw;
    const diff = wrapAngle(headYaw - menu.yaw);
    const hud = hudMode();
    if (hud) { menu.yaw += diff * 0.2; menu.catching = false; } // HUD: stays in front of your face, gently smoothed
    else {
      const follow = (Number(config.menu.followDeg) || 35) * Math.PI / 180;
      if (Math.abs(diff) > follow) menu.catching = true;
      if (menu.catching) {
        menu.yaw += diff * 0.12;
        if (Math.abs(diff) < 0.05) menu.catching = false;
      }
    }
    const d = Number(config.screen.distance) || 2.0;
    const w = Number(config.screen.width) || 2.5, h = w * menu.aspect;
    const panel = menu.panel;
    panel.scale.set(w, h, 1);
    if (panel.material && panel.material.opacity !== uiOpacity()) panel.material.opacity = uiOpacity();
    const drop = hud ? 0 : Math.min(0.25, Number(config.menu.drop) || 0.15);
    panel.position.set(head.x - Math.sin(menu.yaw) * d, head.y - drop, head.z - Math.cos(menu.yaw) * d);
    panel.rotation.set(hud ? 0 : -(Number(config.menu.tiltDeg) || 8) * Math.PI / 180, menu.yaw, 0, 'YXZ');
    panel.updateMatrixWorld(true);

    // Laser from the right hand.
    const entry = aimEntry();
    let hit = null;
    if (entry) {
      if (menu.laser.parent !== entry.group) entry.group.add(menu.laser);
      entry.group.getWorldPosition(tmp.v);
      entry.group.getWorldQuaternion(tmp.q3);
      tmp.v2.set(0, 0, -1).applyQuaternion(tmp.q3).add(tmp.v);
      const o = panel.worldToLocal(tmp.v4.copy(tmp.v));
      const p2 = panel.worldToLocal(tmp.v2);
      const dz = p2.z - o.z;
      if (Math.abs(dz) > 1e-6) {
        const t = -o.z / dz;
        const x = o.x + (p2.x - o.x) * t, y = o.y + (p2.y - o.y) * t;
        if (t > 0 && Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5) {
          const S = screenRect();
          const cx = S.x + (x + 0.5) * S.w, cy = S.y + (0.5 - y) * S.h;
          const el = document.elementFromPoint(cx, cy);
          if (hitInteractive(el)) {
            hit = { element: el, x: cx, y: cy };
            const world = panel.localToWorld(tmp.v2.set(x, y, 0.002));
            menu.dot.position.copy(state.rig.worldToLocal(world.clone()));
            const scale = state.rig.scale.x || 1;
            menu.laser.scale.set(1, 1, panel.localToWorld(tmp.v2.set(x, y, 0)).distanceTo(tmp.v) / scale);
          }
        }
      }
    }
    state.uiHit = hit;
    menu.dot.visible = !!hit;
    menu.laser.visible = !!hit;
    if (state.uiPress && hit) uiDrag(hit);
  }

  function fireMouse(el, type, x, y, button, buttons) {
    const init = { button, buttons, bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
    if (type.startsWith('pointer')) el.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    else el.dispatchEvent(new MouseEvent(type, init));
  }

  // Native controls ignore synthetic events for their default behaviour, so sliders and dropdowns are set directly
  // (through the native value setter, so React notices).
  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function setRange(el, x) {
    const r = el.getBoundingClientRect();
    const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max), step = Number(el.step) || 1;
    let v = min + Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width))) * (max - min);
    v = Math.round(v / step) * step;
    nativeValueSetter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function stepSelect(el) {
    const n = el.options.length;
    if (!n) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex').set;
    setter.call(el, (el.selectedIndex + 1) % n);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function uiPress(down) {
    state.lastUiAt = performance.now();
    if (down) {
      const hit = state.uiHit;
      if (!hit) return false;
      state.uiPress = hit;
      fireMouse(hit.element, 'pointerdown', hit.x, hit.y, 0, 1);
      fireMouse(hit.element, 'mousedown', hit.x, hit.y, 0, 1);
      const el = hit.element;
      if (el.tagName === 'INPUT' && el.type === 'range') setRange(el, hit.x);
      return true;
    }
    const press = state.uiPress;
    if (!press) return false;
    state.uiPress = null;
    const at = state.uiHit || press;
    fireMouse(press.element, 'pointerup', at.x, at.y, 0, 0);
    fireMouse(press.element, 'mouseup', at.x, at.y, 0, 0);
    const same = at.element === press.element || press.element.contains(at.element) || at.element.contains(press.element);
    if (same) {
      const el = press.element;
      if (el.tagName === 'SELECT') stepSelect(el);
      else if (!(el.tagName === 'INPUT' && el.type === 'range')) {
        const clickable = el.closest('button, a, label, input, summary, [role], [onclick]') || el;
        if (typeof clickable.click === 'function' && /^(BUTTON|A|LABEL|INPUT|SUMMARY)$/.test(clickable.tagName)) clickable.click();
        else fireMouse(el, 'click', at.x, at.y, 0, 0);
      }
    }
    // Don't leave keyboard focus on a menu button: the game would stop seeing WASD.
    setTimeout(() => { const ae = document.activeElement; if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A')) ae.blur(); }, 0);
    // Picked something on the emote wheel: let go of the wheel key (after the game has seen the click).
    if (state.emoteWheel) setTimeout(() => closeEmoteWheel('emote picked'), 60);
    if (state.menu) state.menu.dirty = true;
    return true;
  }

  function uiDrag(hit) {
    const press = state.uiPress;
    if (!press) return;
    fireMouse(press.element, 'pointermove', hit.x, hit.y, 0, 1);
    fireMouse(press.element, 'mousemove', hit.x, hit.y, 0, 1);
    if (press.element.tagName === 'INPUT' && press.element.type === 'range') setRange(press.element, hit.x);
  }

  function uiScroll(amount) {
    const hit = state.uiHit;
    if (!hit) return;
    hit.element.dispatchEvent(new WheelEvent('wheel', { deltaY: amount, clientX: hit.x, clientY: hit.y, bubbles: true, cancelable: true }));
    // Synthetic wheel events don't scroll by themselves: scroll the nearest scrollable box directly.
    for (let n = hit.element; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 2) { n.scrollTop += amount; break; }
    }
    if (state.menu) state.menu.dirty = true;
  }

  function teardownMenu() {
    if (state.uiPress) uiPress(false);
    state.uiHit = null;
    if (state.menu) state.menu.yaw = null;
  }

  // --- pointer lock: many games only apply mouse look while the pointer is locked ---------------------------------
  const pointerLockDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
  // When the game asks to capture the mouse again (e.g. clicking back in after the pause menu), grant it in VR.
  const nativeRequestPointerLock = Element.prototype.requestPointerLock;
  if (nativeRequestPointerLock) {
    Element.prototype.requestPointerLock = function requestPointerLock(...args) {
      state.lockTarget = this;
      state.lockRequests = (state.lockRequests || 0) + 1;
      if (state.presenting && config.spoofPointerLock) {
        state.pointerLockReleased = false;
        setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0);
        return Promise.resolve();
      }
      return nativeRequestPointerLock.apply(this, args);
    };
  }
  document.addEventListener('pointerlockchange', () => {
    const real = pointerLockDescriptor && pointerLockDescriptor.get.call(document);
    if (real) state.lockTarget = real;
  }, true);
  try { const real = pointerLockDescriptor && pointerLockDescriptor.get.call(document); if (real) state.lockTarget = real; } catch {}
  const nativeExitPointerLock = Document.prototype.exitPointerLock;
  if (nativeExitPointerLock) {
    Document.prototype.exitPointerLock = function exitPointerLock(...args) {
      if (state.presenting && config.spoofPointerLock && !state.pointerLockReleased) {
        state.pointerLockReleased = true;
        setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0);
      }
      return nativeExitPointerLock.apply(this, args);
    };
  }
  function spoofPointerLock(on) {
    if (!pointerLockDescriptor || !config.spoofPointerLock) return;
    if (on === state.lockSpoofed) { if (on) document.dispatchEvent(new Event('pointerlockchange')); return; }
    state.lockSpoofed = on;
    if (on) {
      Object.defineProperty(Document.prototype, 'pointerLockElement', {
        configurable: true, enumerable: true,
        get() {
          const real = pointerLockDescriptor.get.call(this);
          if (real || !state.presenting || state.pointerLockReleased) return real || null;
          // The element the game asked to lock (it may compare against it), else the game canvas.
          if (state.lockTarget && state.lockTarget.isConnected) return state.lockTarget;
          return state.renderer && state.renderer.domElement ? state.renderer.domElement : null;
        },
      });
      document.dispatchEvent(new Event('pointerlockchange'));
    } else {
      Object.defineProperty(Document.prototype, 'pointerLockElement', pointerLockDescriptor);
      document.dispatchEvent(new Event('pointerlockchange'));
    }
  }

  // --- menu-only VR: enter VR before the game draws anything 3D ---------------------------------------------------
  // On the landing page / main menu the game may not have drawn a 3D frame yet, so there is no three.js renderer to
  // hand the headset to. In that case we run the session ourselves with a tiny WebGL renderer: the menu panel, the
  // laser and a floor grid. As soon as the game renders (you press Play, or the menu's skybox starts), the session is
  // handed to the game's renderer without leaving VR.
  const mat4 = {
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    // translate(x,y,z) * rotateY(yaw) * scale(sx,sy,sz)
    trs(x, y, z, yaw, sx, sy, sz) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1]);
    },
  };

  function standaloneGl(session) {
    const canvas = document.createElement('canvas');
    const attrs = { xrCompatible: true, alpha: false, antialias: true, depth: true };
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) throw new Error('WebGL unavailable');
    return { canvas, ...overlayProgram(gl) };
  }
  // A tiny textured-quad + lines program (no three.js), used for menu-only VR and for the panel/lasers in a match.
  function overlayProgram(gl) {
    const compile = (type, src) => {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec2 uv;uniform mat4 mvp;varying vec2 v;void main(){v=uv;gl_Position=mvp*vec4(p,1.0);}'));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D t;uniform vec4 c;uniform float tex;varying vec2 v;void main(){vec4 col=tex>0.5?texture2D(t,vec2(v.x,1.0-v.y))*c:c;if(col.a<0.01)discard;gl_FragColor=col;}'));
    gl.linkProgram(prog);
    const loc = { p: gl.getAttribLocation(prog, 'p'), uv: gl.getAttribLocation(prog, 'uv'), mvp: gl.getUniformLocation(prog, 'mvp'),
      t: gl.getUniformLocation(prog, 't'), c: gl.getUniformLocation(prog, 'c'), tex: gl.getUniformLocation(prog, 'tex') };
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0, 0, 0, 0.5, -0.5, 0, 1, 0, 0.5, 0.5, 0, 1, 1, -0.5, -0.5, 0, 0, 0, 0.5, 0.5, 0, 1, 1, -0.5, 0.5, 0, 0, 1]), gl.STATIC_DRAW);
    const lines = gl.createBuffer();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return { gl, prog, loc, quad, lines, texture };
  }

  // --- panel + lasers drawn straight into the headset frame -------------------------------------------------------
  // On the Quest the three.js-built panel never showed up in a match (menu-only VR, which draws with plain WebGL,
  // did). So after the game's headset frame is drawn, draw the panel, menu laser and aim line ourselves, on top, in
  // the XR reference space (= our rig's space), then let three.js re-sync its GL state.
  function drawOverlay(renderer) {
    if (config.overlayGl === false) return false;
    const xr = renderer.xr;
    const session = xr.getSession && xr.getSession();
    const frame = xr.getFrame && xr.getFrame();
    const space = xr.getReferenceSpace && xr.getReferenceSpace();
    // three.js draws into a projection layer (WebXR Layers; the Quest Browser has them) or an XRWebGLLayer.
    const layer = (xr.getBaseLayer && xr.getBaseLayer()) || (session && session.renderState && session.renderState.baseLayer);
    if (!session || !frame || !space || !layer) { state.overlayStatus = 'no XR layer yet'; return false; }
    const projection = !('framebuffer' in layer);
    const binding = projection && xr.getBinding ? xr.getBinding() : null;
    if (projection && !binding) { state.overlayStatus = 'projection layer without a binding'; return false; }
    const pose = frame.getViewerPose(space);
    if (!pose) { state.overlayStatus = 'no viewer pose'; return false; }
    const gl = renderer.getContext();
    let o = state.overlay;
    if (!o || o.gl !== gl) o = state.overlay = { ...overlayProgram(gl), uploaded: -1 };
    const { prog, loc, quad, lines, texture } = o;
    const menu = state.menu;
    const scale = state.rig && state.rig.scale.x || 1; // rig units -> reference space metres
    // Lines: menu laser (to the hit point) and the aim line, from the aim hand's ray.
    const lineData = [], lineColors = [];
    const src = [...session.inputSources].find((x) => x.handedness === config.aimHand && x.targetRaySpace);
    const rp = src && frame.getPose(src.targetRaySpace, space);
    let dotPos = null;
    if (rp) {
      const m = rp.transform.matrix, ox = m[12], oy = m[13], oz = m[14], dx = -m[8], dy = -m[9], dz = -m[10];
      if (state.uiHit && menu && menu.dot) {
        const d = menu.dot.position;
        dotPos = [d.x * scale, d.y * scale, d.z * scale];
        lineData.push(ox, oy, oz, ...dotPos); lineColors.push([1, 1, 1, 0.85]);
      } else if (state.aimLineShown) {
        const len = (state.aimDist || 10) * scale;
        lineData.push(ox, oy, oz, ox + dx * len, oy + dy * len, oz + dz * len); lineColors.push([1, 0.33, 0.33, 0.6]);
      }
    }
    const drawPanel = !!(menu && menu.panel && config.menu.mode !== 'off');
    if (!drawPanel && !lineData.length) return true;

    const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (projection && !o.fbo) o.fbo = gl.createFramebuffer();
    // Where each eye goes: the layer's framebuffer + viewport, or the projection layer's texture (side-by-side or
    // one per eye / texture-array slice) attached to our own framebuffer.
    const target = (view) => {
      if (!projection) { gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); return layer.getViewport(view); }
      const sub = binding.getViewSubImage(layer, view);
      if (!sub || !sub.colorTexture) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo);
      if (isGl2 && layer.textureArrayLength > 1) gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sub.colorTexture, 0, sub.imageIndex || 0);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sub.colorTexture, 0);
      return sub.viewport;
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, projection ? o.fbo : layer.framebuffer);
    if (isGl2) { gl.bindVertexArray(null); gl.bindSampler(0, null); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); }
    gl.useProgram(prog);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (drawPanel && o.uploaded !== menu.draws) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, menu.canvas);
      o.uploaded = menu.draws;
    }
    gl.uniform1i(loc.t, 0);
    // Panel model: its local matrix in rig space, scaled to reference-space metres.
    let panelModel = null;
    if (drawPanel) {
      menu.panel.updateMatrix();
      const e = menu.panel.matrix.elements;
      panelModel = new Float32Array(e);
      for (let i = 0; i < 16; i++) if (i % 4 !== 3) panelModel[i] *= scale; // scale rotation/scale and translation rows
      panelModel[15] = 1;
    }
    if (lineData.length) { gl.bindBuffer(gl.ARRAY_BUFFER, lines); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineData), gl.DYNAMIC_DRAW); }
    for (const view of pose.views) {
      const vp = target(view);
      if (!vp) continue;
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const vpm = mat4.mul(view.projectionMatrix, view.transform.inverse.matrix);
      if (panelModel) {
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 20, 12);
        gl.uniformMatrix4fv(loc.mvp, false, mat4.mul(vpm, panelModel));
        gl.uniform1f(loc.tex, 1); gl.uniform4f(loc.c, 1, 1, 1, uiOpacity());
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (lineData.length) {
        gl.bindBuffer(gl.ARRAY_BUFFER, lines);
        gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 12, 0);
        gl.disableVertexAttribArray(loc.uv); gl.vertexAttrib2f(loc.uv, 0, 0);
        gl.uniformMatrix4fv(loc.mvp, false, vpm);
        gl.uniform1f(loc.tex, 0);
        lineColors.forEach((c, i) => { gl.uniform4f(loc.c, c[0], c[1], c[2], c[3]); gl.drawArrays(gl.LINES, i * 2, 2); });
      }
      if (dotPos) {
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 20, 0);
        gl.disableVertexAttribArray(loc.uv); gl.vertexAttrib2f(loc.uv, 0, 0);
        gl.uniformMatrix4fv(loc.mvp, false, mat4.mul(vpm, mat4.trs(dotPos[0], dotPos[1], dotPos[2], menu.yaw || 0, 0.015, 0.015, 1)));
        gl.uniform1f(loc.tex, 0); gl.uniform4f(loc.c, 1, 1, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    gl.disableVertexAttribArray(loc.p); gl.disableVertexAttribArray(loc.uv);
    if (projection) { gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); }
    renderer.resetState();
    state.overlayStatus = projection ? 'projection layer' + (layer.textureArrayLength > 1 ? ' (texture array)' : '') : 'WebGL layer';
    state.overlayDraws = (state.overlayDraws || 0) + 1;
    return true;
  }
  // When we draw them ourselves, hide the three.js versions (they'd double up wherever three does draw them).
  function hideThreeOverlay(hide) {
    const menu = state.menu;
    if (menu && menu.panel) { menu.panel.visible = !hide; if (hide) { menu.dot.visible = false; menu.laser.visible = false; } }
    if (hide && state.aimLaser) state.aimLaser.visible = false;
  }

  async function startStandalone(session) {
    const g = standaloneGl(session);
    if (g.gl.makeXRCompatible) await g.gl.makeXRCompatible();
    const scale = Math.min(1.5, Math.max(0.4, Number(config.framebufferScale) || 1));
    const layer = new XRWebGLLayer(session, g.gl, { framebufferScaleFactor: scale });
    await session.updateRenderState({ baseLayer: layer });
    const space = await session.requestReferenceSpace('local');
    const width = Math.max(512, Math.min(2048, Number(config.menu.resolution) || 1600));
    const aspect = screenAspect();
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = Math.round(width * aspect);
    const menu = { canvas, ctx: canvas.getContext('2d'), texture: { needsUpdate: false }, aspect, dirty: true, lastDraw: 0, draws: 0, drawMs: 0, nodes: 0, noImages: false, yaw: null };
    const sa = { session, space, layer, g, menu, handedOff: false, frames: 0, floorY: null, hand: null };
    state.standalone = sa;
    state.presenting = true;
    state.redirectRaf = true;
    spoofFocus(true);
    state.pointerLockReleased = false;
    spoofPointerLock(true);
    safe('virtual screen', () => applyVirtualScreen(true));
    try { state.menuObserver2 = new MutationObserver(() => { menu.dirty = true; }); state.menuObserver2.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {}
    session.addEventListener('end', () => endStandalone(sa));
    attachSelectEvents(session);
    session.requestAnimationFrame((t, f) => standaloneFrame(sa, t, f));
    log('Menu-only VR started (no game 3D yet). It switches to the game view as soon as the game renders.');
    setStatus('In VR (menus) · switches to the game when it starts rendering');
  }

  function endStandalone(sa) {
    if (state.standalone !== sa) return;
    state.standalone = null;
    if (sa.handedOff) return;
    releaseAllInput();
    state.presenting = false;
    state.redirectRaf = false;
    state.uiHit = null;
    spoofFocus(false);
    spoofPointerLock(false);
    safe('virtual screen', () => applyVirtualScreen(false));
    if (state.menuObserver2) { try { state.menuObserver2.disconnect(); } catch {} state.menuObserver2 = null; }
    const queue = state.rafQueue;
    state.rafQueue = new Map();
    for (const callback of queue.values()) nativeRaf(callback);
    setStatus('');
    log('Menu-only VR ended.');
  }

  // Called from captureRenderer: the game started rendering while we run the session ourselves.
  function handOffStandalone(renderer) {
    const sa = state.standalone;
    if (!sa || sa.handedOff) return;
    sa.handedOff = true;
    if (state.menuObserver2) { try { state.menuObserver2.disconnect(); } catch {} state.menuObserver2 = null; }
    state.uiHit = null;
    state.renderer = renderer;
    try { renderer.xr.setFramebufferScaleFactor(Math.min(1.5, Math.max(0.4, Number(config.framebufferScale) || 1))); } catch {}
    renderer.xr.setSession(sa.session).then(() => {
      log('Handed the headset to the game renderer.');
    }).catch((error) => {
      record('error', ['Hand-off to the game renderer failed:', error]);
      sa.handedOff = false;
      state.standalone = sa;
      sa.session.requestAnimationFrame((t, f) => standaloneFrame(sa, t, f));
    });
  }

  function standaloneFrame(sa, time, frame) {
    if (sa.handedOff || state.standalone !== sa) return;
    sa.session.requestAnimationFrame((t, f) => standaloneFrame(sa, t, f));
    sa.frames++;
    safe('timers', runDueTimers);
    // Let the page (and the game's loop, if it runs) do its frame work inside the XR frame.
    const queue = state.rafQueue;
    state.rafQueue = new Map();
    for (const callback of queue.values()) { try { callback(time); } catch (error) { record('game-error', ['Game frame error:', error]); } }
    if (sa.handedOff) return; // the game rendered during its frame and took over
    safe('controller input', () => pollInput(frame));
    const pose = frame.getViewerPose(sa.space);
    if (!pose) return;
    safe('menu-only view', () => drawStandalone(sa, frame, pose));
  }

  function drawStandalone(sa, frame, pose) {
    const { gl, prog, loc, quad, lines, texture } = sa.g;
    const menu = sa.menu;
    const now = performance.now();
    const minGap = Math.max(1000 / Math.max(1, Number(config.menu.maxFps) || 12), (menu.drawMs || 0) * 12);
    if ((menu.dirty && now - menu.lastDraw > minGap) || now - menu.lastDraw > 1000) {
      menu.dirty = false; menu.lastDraw = now;
      const t0 = performance.now();
      paintDom(menu);
      const dt = performance.now() - t0;
      menu.drawMs = menu.drawMs ? menu.drawMs * 0.8 + dt * 0.2 : dt;
      menu.draws++;
    }
    // Panel: in front of your head, lazily following your facing.
    const hp = pose.transform.position, ho = pose.transform.orientation;
    const headYaw = Math.atan2(2 * (ho.w * ho.y + ho.x * ho.z), 1 - 2 * (ho.y * ho.y + ho.x * ho.x));
    if (menu.yaw === null) menu.yaw = headYaw;
    const diff = wrapAngle(headYaw - menu.yaw);
    if (Math.abs(diff) > (Number(config.menu.followDeg) || 35) * Math.PI / 180) menu.catching = true;
    if (menu.catching) { menu.yaw += diff * 0.12; if (Math.abs(diff) < 0.05) menu.catching = false; }
    if (sa.floorY === null) sa.floorY = hp.y - 1.6;
    const d = Number(config.screen.distance) || 2.0, w = Number(config.screen.width) || 2.5, h = w * menu.aspect;
    const cx = hp.x - Math.sin(menu.yaw) * d, cy = hp.y - (Number(config.menu.drop) || 0.15), cz = hp.z - Math.cos(menu.yaw) * d;

    // Laser from the right controller.
    let hit = null, ray = null;
    for (const source of frame.session.inputSources) {
      if (source.handedness !== config.aimHand || !source.targetRaySpace) continue;
      const rp = frame.getPose(source.targetRaySpace, sa.space);
      if (!rp) continue;
      const m = rp.transform.matrix;
      const o = [m[12], m[13], m[14]], dir = [-m[8], -m[9], -m[10]];
      ray = { o, dir, len: 3 };
      const cs = Math.cos(-menu.yaw), sn = Math.sin(-menu.yaw);
      const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
      const lo = [ox * cs + oz * sn, oy, -ox * sn + oz * cs];
      const ld = [dir[0] * cs + dir[2] * sn, dir[1], -dir[0] * sn + dir[2] * cs];
      if (Math.abs(ld[2]) > 1e-6) {
        const t = -lo[2] / ld[2];
        const x = lo[0] + ld[0] * t, y = lo[1] + ld[1] * t;
        if (t > 0 && Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2) {
          const S = screenRect();
          const clientX = S.x + (x / w + 0.5) * S.w, clientY = S.y + (0.5 - y / h) * S.h;
          const el = document.elementFromPoint(clientX, clientY);
          if (hitInteractive(el)) { hit = { element: el, x: clientX, y: clientY }; ray.len = t; }
        }
      }
    }
    state.uiHit = hit;
    if (state.uiPress && hit) uiDrag(hit);

    // Draw.
    const layer = sa.layer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0.07, 0.09, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (menu.texture.needsUpdate) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, menu.canvas);
      menu.texture.needsUpdate = false;
    }
    gl.uniform1i(loc.t, 0);
    // Floor grid + laser as lines.
    const grid = [];
    const fy = sa.floorY, gx = Math.round(hp.x), gz = Math.round(hp.z);
    for (let i = -8; i <= 8; i++) { grid.push(gx - 8, fy, gz + i, gx + 8, fy, gz + i, gx + i, fy, gz - 8, gx + i, fy, gz + 8); }
    const laser = ray ? [ray.o[0], ray.o[1], ray.o[2], ray.o[0] + ray.dir[0] * ray.len, ray.o[1] + ray.dir[1] * ray.len, ray.o[2] + ray.dir[2] * ray.len] : [];
    const panelModel = mat4.trs(cx, cy, cz, menu.yaw, w, h, 1);
    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const vpm = mat4.mul(view.projectionMatrix, view.transform.inverse.matrix);
      // lines
      gl.bindBuffer(gl.ARRAY_BUFFER, lines);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(grid.concat(laser)), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc.p);
      gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 12, 0);
      gl.disableVertexAttribArray(loc.uv);
      gl.vertexAttrib2f(loc.uv, 0, 0);
      gl.uniformMatrix4fv(loc.mvp, false, vpm);
      gl.uniform1f(loc.tex, 0);
      gl.uniform4f(loc.c, 0.3, 0.45, 0.55, 0.6);
      gl.drawArrays(gl.LINES, 0, grid.length / 3);
      if (laser.length) {
        gl.uniform4f(loc.c, 1, 1, 1, hit ? 0.9 : 0.35);
        gl.drawArrays(gl.LINES, grid.length / 3, 2);
      }
      // panel
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(loc.p);
      gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(loc.uv);
      gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 20, 12);
      gl.uniformMatrix4fv(loc.mvp, false, mat4.mul(vpm, panelModel));
      gl.uniform1f(loc.tex, 1);
      gl.uniform4f(loc.c, 1, 1, 1, uiOpacity());
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (hit && ray) {
        const p = [ray.o[0] + ray.dir[0] * ray.len, ray.o[1] + ray.dir[1] * ray.len, ray.o[2] + ray.dir[2] * ray.len];
        gl.uniformMatrix4fv(loc.mvp, false, mat4.mul(vpm, mat4.trs(p[0], p[1], p[2], menu.yaw, 0.015, 0.015, 1)));
        gl.uniform1f(loc.tex, 0);
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.DEPTH_TEST);
      }
    }
  }

  // --- keep the game listening ------------------------------------------------------------------------------
  // In an immersive session the 2D page can lose focus; the game then drops or ignores input until you switch
  // tabs. While in VR we report the page as focused/visible and replay focus + held keys whenever it slips.
  const nativeHasFocus = Document.prototype.hasFocus;
  function spoofFocus(on) {
    if (on) {
      Document.prototype.hasFocus = function hasFocus() { return state.presenting ? true : nativeHasFocus.call(this); };
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      } catch {}
    } else {
      Document.prototype.hasFocus = nativeHasFocus;
      try { delete document.visibilityState; delete document.hidden; } catch {}
    }
  }
  function reassertFocus(why) {
    if (!state.presenting) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && (isOurs(ae) || ae.tagName === 'BUTTON')) { try { ae.blur(); } catch {} }
    if (state.gameplay) releaseTextFocus();
    window.dispatchEvent(new FocusEvent('focus'));
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.dispatchEvent(new Event('visibilitychange'));
    for (const code of state.keysDown) dispatchKey(code, true);
    if (why !== 'timer') log('Input re-focused (' + why + ').');
  }
  window.addEventListener('blur', () => { if (state.presenting) setTimeout(() => reassertFocus('blur'), 30); }, true);
  document.addEventListener('visibilitychange', (event) => {
    if (state.presenting && event.isTrusted) setTimeout(() => reassertFocus('visibility'), 30);
  }, true);

  const BUTTON_INDEX = { trigger: 0, squeeze: 1, thumbstick: 3 };
  const FACE = { left: { x: 4, y: 5 }, right: { a: 4, b: 5 } };

  function keyFromCode(code) {
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();
    if (code.startsWith('Digit')) return code.slice(5);
    return { Space: ' ', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', Escape: 'Escape', Tab: 'Tab', Enter: 'Enter' }[code] || code;
  }
  const KEY_CODES = { Space: 32, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, Escape: 27, Tab: 9, Enter: 13 };
  function keyCodeFor(code) {
    if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
    if (/^Digit\d$/.test(code)) return code.charCodeAt(5);
    return KEY_CODES[code] || 0;
  }

  const isTextField = (el) => !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
  function keyTarget() {
    const ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement || isOurs(ae) || ae.tagName === 'BUTTON') return document.body || document;
    if (state.gameplay && isTextField(ae)) return document.body || document;
    return ae;
  }
  // A menu click (name box, lobby code, chat) can leave a text field focused. In a match that swallows W/A/S/D, and
  // many games ignore the mouse while you're typing. There's no keyboard in the headset, so let go of it.
  function releaseTextFocus() {
    const ae = document.activeElement;
    if (!isTextField(ae) || isOurs(ae) || (ae.closest && ae.closest('#fister-vr-info'))) return;
    // Dropdowns don't take movement keys, and you may be using a menu over the match (sandbox, settings).
    if (ae.tagName === 'SELECT' || (state.lastUiAt && performance.now() - state.lastUiAt < 8000)) return;
    try { ae.blur(); } catch {}
    log('Let go of a focused text box (' + describeEl(ae) + ') so movement keys reach the game.');
  }
  function describeEl(el) {
    if (!el) return 'none';
    if (el === document.body) return 'page';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
  }

  function dispatchKey(code, down) {
    const event = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: keyFromCode(code), bubbles: true, cancelable: true, composed: true });
    const keyCode = keyCodeFor(code);
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    Object.defineProperty(event, 'which', { get: () => keyCode });
    keyTarget().dispatchEvent(event);
  }

  function sendKey(code, down) {
    if (down === state.keysDown.has(code)) return;
    if (down) state.keysDown.add(code); else state.keysDown.delete(code);
    dispatchKey(code, down);
  }

  function inputTarget() {
    return (state.renderer && state.renderer.domElement && state.renderer.domElement.isConnected) ? state.renderer.domElement : document;
  }

  const mouseButtonsHeld = new Set();
  function sendMouseButton(button, down) {
    if (down) mouseButtonsHeld.add(button); else mouseButtonsHeld.delete(button);
    const buttons = [...mouseButtonsHeld].reduce((mask, b) => mask | (b === 0 ? 1 : b === 2 ? 2 : 4), 0);
    const target = inputTarget();
    const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const init = { button, buttons, bubbles: true, cancelable: true, composed: true, view: window,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    target.dispatchEvent(new PointerEvent(down ? 'pointerdown' : 'pointerup', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', init));
    if (!down && button === 0) target.dispatchEvent(new MouseEvent('click', init));
  }

  function sendMouseMove(dx, dy = 0) {
    if (!dx && !dy) return;
    const target = inputTarget();
    const init = { movementX: dx, movementY: dy, buttons: [...mouseButtonsHeld].reduce((m, b) => m | (b === 0 ? 1 : b === 2 ? 2 : 4), 0),
      bubbles: true, cancelable: true, composed: true, view: window };
    target.dispatchEvent(new PointerEvent('pointermove', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousemove', init));
  }

  // WebXR 'select' events count as a user action, so clicks done inside them may open full screen, start audio or
  // capture the mouse, which a lobby/join button may need. Menu clicks with the aim hand are done here.
  function attachSelectEvents(session) {
    if (!session || session.__fisterVrSelect) return;
    session.__fisterVrSelect = true;
    session.addEventListener('selectstart', (event) => {
      if (!event.inputSource || event.inputSource.handedness !== config.aimHand || !state.uiHit) return;
      state.triggerToUi = true;
      safe('menu click', () => uiPress(true));
    });
    session.addEventListener('selectend', (event) => {
      if (!event.inputSource || event.inputSource.handedness !== config.aimHand || !state.triggerToUi) return;
      safe('menu click', () => uiPress(false));
      state.selectReleased = true;
    });
  }

  function closeEmoteWheel(why) {
    const wheel = state.emoteWheel;
    if (!wheel) return;
    state.emoteWheel = null;
    sendKey(wheel.key, false);
    if (state.menu) state.menu.dirty = true;
    log('Emote wheel: released ' + wheel.key + ' (' + why + ').');
  }
  function runAction(action, down, frame, hand) {
    if (!action) return;
    if (action === 'recenter') { if (down) { recenter(frame); reassertFocus('recenter'); } return; }
    if (action === 'refocus') { if (down) reassertFocus('button'); return; }
    if (action === 'emote') {
      // X: hold the emote wheel key until an emote is picked with the laser (or X is pressed again).
      if (!down) return;
      if (state.emoteWheel) { closeEmoteWheel('X pressed again'); return; }
      const key = config.emoteKey || 'KeyE';
      state.emoteWheel = { key, since: performance.now() };
      sendKey(key, true);
      if (state.menu) { state.menu.dirty = true; state.menu.lastDraw = 0; }
      pulse(hand, 0.3, 30);
      log('Emote wheel: holding ' + key + '. Point at an emote and pull the trigger.');
      return;
    }
    if (action === 'clip') {
      // Press and release the game's own "save clip" binding (looked up by FisterQoL from the game's controls).
      if (down) {
        const bridge = root.__fisterQolVrBridge;
        if (!bridge) { log('Clip button: FisterQoL is not loaded.'); toast('Saving clips needs FisterQoL: use the "Fister VR + FisterQoL" bookmark.'); pulse(hand, 0.3, 40); return; }
        const bound = typeof bridge.clipInput === 'function' ? bridge.clipInput() : null;
        state.clipHeld = bound;
        if (!bound) { log('Clip button: no Save clip key found in the game controls.'); toast('No Save clip key found. Pick it in Settings > QoL > VR > Save clip key.'); pulse(hand, 0.3, 40); return; }
        let recording = null;
        try { const v = localStorage.getItem('fister-clip-recording'); recording = v === null ? null : v !== 'false'; } catch {}
        const name = bound.key ? bound.key.replace(/^Key|^Digit/, '') : 'mouse ' + (bound.mouse + 1);
        log('Clip button: sending ' + JSON.stringify(bound) + (recording === false ? ' (clip recording is off in the game settings)' : '') + '.');
        if (recording === false) toast('Clip recording is off. Turn it on in the game\'s Settings > Clips, then clips can be saved.');
        else toast('Saving clip (' + name + ')');
        pulse(hand, 0.7, 90);
        runAction(bound, true, frame, null);
      } else if (state.clipHeld) {
        runAction(state.clipHeld, false, frame, null);
        state.clipHeld = null;
      }
      return;
    }
    // Right trigger on the menu panel clicks the menu instead of punching.
    if (hand === config.aimHand && action.mouse === 0) {
      // Already handled by the select event? Then just consume the gamepad edge.
      if (down && state.triggerToUi) return;
      if (!down && state.triggerToUi) { state.triggerToUi = false; if (!state.selectReleased && state.uiPress) uiPress(false); state.selectReleased = false; return; }
      if (down ? state.uiHit : state.uiPress) { state.triggerToUi = down; uiPress(down); return; }
    }
    // Escape opens the game's pause menu, which many games do when the pointer is released.
    if (action.key === 'Escape' && down && config.spoofPointerLock && state.presenting) {
      state.pointerLockReleased = !state.pointerLockReleased;
      document.dispatchEvent(new Event('pointerlockchange'));
    }
    if (typeof action.mouse === 'number') sendMouseButton(action.mouse, down);
    else if (typeof action.key === 'string') sendKey(action.key, down);
  }

  function pulse(hand, intensity, ms) {
    try {
      const session = state.renderer && state.renderer.xr && state.renderer.xr.getSession && state.renderer.xr.getSession();
      for (const src of (session ? session.inputSources : [])) {
        if (src.handedness !== hand || !src.gamepad) continue;
        const act = src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
        if (act && act.pulse) act.pulse(intensity, ms);
        else if (src.gamepad.vibrationActuator && src.gamepad.vibrationActuator.playEffect) src.gamepad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity });
      }
    } catch {}
  }

  // Short message at the top of the screen. It's part of the page, so it also shows on the floating HUD in the headset.
  function toast(text) {
    whenBody(() => {
      let el = document.getElementById('fister-vr-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'fister-vr-toast';
        el.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:2147483645;max-width:min(560px,80vw);padding:8px 14px;'
          + 'background:#c0c0c0;color:#000;font:bold 15px Tahoma,Arial,sans-serif;text-align:center;pointer-events:none;'
          + 'box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px #808080,inset 2px 2px #dfdfdf;';
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.style.display = 'block';
      clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
      if (state.menu) state.menu.dirty = true;
    });
  }

  // Controllers that connected before our rig existed never sent us a 'connected' event. three.js assigns controller
  // slots in the order input sources appear, so adopt them from the session's list.
  function adoptControllers(session) {
    if (!session || !state.controllers.length) return;
    const sources = [...session.inputSources].filter((src) => src.targetRayMode === 'tracked-pointer' || src.gamepad);
    // three.js only tracks controllers it saw arrive ('inputsourceschange'). After the menu-only view hands the session
    // over, they had already arrived, so three never moves them: no hands, no aim. Replay the arrival for three.
    if (session.__fisterVrReplayed !== session && sources.length && typeof session.dispatchEvent === 'function' && state.controllers.some((c) => !c.source)) {
      session.__fisterVrReplayed = session;
      try {
        const event = new Event('inputsourceschange');
        event.added = [...session.inputSources];
        event.removed = [];
        session.dispatchEvent(event);
        log('Re-announced ' + sources.length + ' controller(s) to the game renderer.');
      } catch (error) { record('error', ['Controller replay failed:', error]); }
    }
    for (const entry of state.controllers) {
      if (entry.source) continue;
      const src = sources[entry.index];
      if (!src) continue;
      entry.source = src;
      entry.handedness = src.handedness || 'none';
      if (entry.box && entry.box.material.color) entry.box.material.color.setHex(config.boxColors[entry.handedness] ?? config.boxColors.none);
      log('Controller ' + entry.index + ' adopted (' + entry.handedness + ').');
    }
  }

  function pollInput(frame) {
    if (frame && frame.session) adoptControllers(frame.session);
    if (state.pendingRecenter) recenter(frame);
    const session = frame && frame.session;
    if (!session) return;
    let move = null, turn = null, scroll = 0;
    if (state.emoteWheel && performance.now() - state.emoteWheel.since > 15000) closeEmoteWheel('timed out');
    for (const source of session.inputSources) {
      const pad = source.gamepad;
      const hand = source.handedness;
      if (!pad || (hand !== 'left' && hand !== 'right')) continue;
      const names = { ...BUTTON_INDEX, ...(FACE[hand] || {}) };
      for (const [name, index] of Object.entries(names)) {
        const id = hand + '.' + name;
        const pressed = !!(pad.buttons[index] && pad.buttons[index].pressed);
        const was = state.buttonsDown.get(id) || false;
        if (pressed !== was) {
          state.buttonsDown.set(id, pressed);
          runAction(config.buttons[id], pressed, frame, hand);
        }
      }
      const sx = pad.axes.length >= 4 ? pad.axes[2] : pad.axes[0] || 0;
      const sy = pad.axes.length >= 4 ? pad.axes[3] : pad.axes[1] || 0;
      if (hand === config.moveStick) move = [sx, sy];
      if (hand === config.turnStick) turn = sx;
      if (hand === config.aimHand) scroll = sy;
    }
    // Point at the menu and push the right stick up/down to scroll.
    if (state.uiHit && Math.abs(scroll) > 0.3) uiScroll(scroll * 30);
    // Hold both grips for one second: open/close the debug console (it appears on the menu panel).
    const both = state.buttonsDown.get('left.squeeze') && state.buttonsDown.get('right.squeeze');
    const nowMs = performance.now();
    if (both) {
      if (!state.comboStart) state.comboStart = nowMs;
      else if (!state.comboFired && nowMs - state.comboStart > 1000) { state.comboFired = true; toggleInfoPanel(); }
    } else { state.comboStart = 0; state.comboFired = false; }
    if (move) {
      const t = config.moveThreshold;
      sendKey('KeyW', move[1] < -t);
      sendKey('KeyS', move[1] > t);
      sendKey('KeyA', move[0] < -t);
      sendKey('KeyD', move[0] > t);
    }
    // With hand aim the mouse belongs to the aim, so turning always rotates your view (Vivecraft-style).
    const viewTurn = config.aimMode === 'hand' || config.turnMode === 'rig';
    if (turn !== null && config.turnMode !== 'off' && viewTurn) {
      if (config.turnMode === 'smooth') {
        if (Math.abs(turn) > 0.15) state.rigTurn -= turn * 0.035;
      } else if (!state.turnLatched && Math.abs(turn) > 0.7) {
        state.turnLatched = true;
        state.rigTurn -= Math.sign(turn) * (Number(config.rigSnapDegrees) || 30) * Math.PI / 180;
      } else if (state.turnLatched && Math.abs(turn) < 0.3) {
        state.turnLatched = false;
      }
    } else if (turn !== null && config.turnMode !== 'off') {
      if (config.turnMode === 'smooth') {
        if (Math.abs(turn) > 0.15) sendMouseMove(Math.round(turn * config.smoothTurnPixelsPerFrame));
      } else if (!state.turnLatched && Math.abs(turn) > 0.7) {
        state.turnLatched = true;
        sendMouseMove(Math.sign(turn) * config.snapTurnPixels);
      } else if (state.turnLatched && Math.abs(turn) < 0.3) {
        state.turnLatched = false;
      }
    }
  }

  function releaseAllInput() {
    state.emoteWheel = null;
    for (const code of [...state.keysDown]) sendKey(code, false);
    for (const button of [...mouseButtonsHeld]) sendMouseButton(button, false);
    if (state.uiPress) uiPress(false);
    state.buttonsDown.clear();
    state.turnLatched = false;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------------------------------------
  function onSessionStart(renderer) {
    attachSelectEvents(renderer.xr.getSession());
    state.renderer = renderer;
    const main = pickMain();
    state.gameCamera = main.camera || state.gameCamera;
    state.presenting = true;
    state.pendingRecenter = true;
    state.handBaseYaw = null;
    state.rigTurn = 0;
    state.aim.lastYaw = null;
    state.aim.stuck = 0;
    detectFirstPerson(true);
    spoofFocus(true);
    state.pointerLockReleased = false;
    spoofPointerLock(true);
    safe('virtual screen', () => applyVirtualScreen(true));
    setTimeout(() => reassertFocus('session start'), 100);

    state.redirectRaf = true;
    // Hook the XR frame loop directly. renderer.setAnimationLoop would also restart three's window-rAF loop, which our
    // rAF redirect feeds back into the XR frame: infinite recursion (stack overflow, black frames).
    renderer.xr.setAnimationLoop((time, frame) => xrFrame(renderer, time, frame));
    setStatus('In VR' + (state.fp ? ' · first-person: ' + state.fp.label : ' · first-person: head anchor'));
    if (root.__fisterQolVrBridge && root.__fisterQolVrBridge.sessionChanged) { try { root.__fisterQolVrBridge.sessionChanged(true); } catch {} }
    log('XR session started. Main camera:', state.gameCamera ? 'found' : 'pending first render');
  }

  function onSessionEnd(renderer) {
    releaseAllInput();
    state.presenting = false;
    state.redirectRaf = false;
    spoofFocus(false);
    safe('virtual screen', () => applyVirtualScreen(false));
    teardownMenu();
    spoofPointerLock(false);
    unlockFirstPerson();
    restoreHead();
    restoreShake();
    restoreOutlines();
    restoreBody();
    restoreItems();
    restoreArmScale();
    if (state.rig && state.rig.parent) state.rig.parent.remove(state.rig);
    safe('page mirror', removeMirror);
    if (state.clip) { state.clip.primed = false; state.clip.frames = 0; state.clip.blackChecks = 0; }
    if (root.__fisterQolVrBridge && root.__fisterQolVrBridge.sessionChanged) { try { root.__fisterQolVrBridge.sessionChanged(false); } catch {} }
    renderer.xr.setAnimationLoop(null);
    renderer.__fisterVrOriginalLoop.call(renderer, state.gameAnimationLoop.get(renderer) || null);
    const queue = state.rafQueue;
    state.rafQueue = new Map();
    for (const callback of queue.values()) nativeRaf(callback);
    setStatus('');
    log('XR session ended.');
  }

  // ---------------------------------------------------------------------------------------------------------
  // VR button (same flow as three/examples/jsm/webxr/VRButton.js, MIT; the official file is not part of the
  // game's bundle and loading it from a CDN would be blocked by the site's CSP)
  // ---------------------------------------------------------------------------------------------------------
  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function styleButton(el) {
    el.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483646;padding:10px 14px;border:1px solid #fff;'
      + 'border-radius:4px;background:rgba(0,0,0,.55);color:#fff;font:bold 13px/1 sans-serif;text-align:center;'
      + 'opacity:.6;outline:none;cursor:pointer;';
    el.onmouseenter = () => { el.style.opacity = '1'; };
    el.onmouseleave = () => { el.style.opacity = '.6'; };
  }

  function ensureVrButton() {
    if (state.buttonEl) return;
    const button = document.createElement('button');
    button.id = 'fister-vr-button';
    styleButton(button);
    state.buttonEl = button;
    const bar = document.createElement('div');
    bar.id = 'fister-vr-bar';
    bar.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;';
    button.style.position = 'static';
    bar.appendChild(button);
    document.body.appendChild(bar);
    state.barEl = bar;
    if (config.showButton === false) bar.style.display = 'none';

    const status = document.createElement('div');
    status.id = 'fister-vr-status';
    status.style.cssText = 'position:fixed;bottom:58px;left:16px;z-index:2147483646;color:#fff;font:12px sans-serif;'
      + 'text-shadow:0 0 3px #000;pointer-events:none;';
    state.statusEl = status;
    document.body.appendChild(status);
    if (config.showButton === false) status.style.display = 'none';

    // "VR info" panel: live debug console + status, for browsers without DevTools (Quest). Also opens in the
    // headset by holding both grips for a second, and shows on the UI panel there.
    const info = document.createElement('button');
    info.id = 'fister-vr-info-button';
    info.textContent = 'VR INFO';
    styleButton(info);
    info.style.position = 'static';
    info.onclick = () => { toggleInfoPanel(); info.blur(); };
    bar.appendChild(info);
    const copy = document.createElement('button');
    copy.id = 'fister-vr-copy-button';
    copy.textContent = 'COPY LOG';
    styleButton(copy);
    copy.style.position = 'static';
    copy.onclick = () => { copyReport(copy, document.getElementById('fister-vr-info')); copy.blur(); };
    bar.appendChild(copy);

    const unsupported = (text) => {
      button.textContent = text;
      button.style.cursor = 'auto';
      button.onclick = null;
    };

    if (!('xr' in navigator) || !navigator.xr) {
      unsupported(window.isSecureContext === false ? 'WEBXR NEEDS HTTPS' : 'WEBXR NOT AVAILABLE');
      return;
    }

    let currentSession = null;
    // No 'layers': the session may start in menu-only mode and later move to the game renderer, which is simplest with
    // a plain XRWebGLLayer on both sides.
    const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor'] };

    async function onSessionStarted(session) {
      let { renderer, camera } = pickMain();
      // Straight to the game view only in a match: a renderer that last drew the scene our player is in, full-screen.
      // Menus (main menu, loadout, store) use menu-only VR; it moves to the game when a match starts.
      let entry = camera && state.cameraStats.get(camera);
      if (!renderer || !entry || !readyForGameView(renderer, entry.scene)) {
        const playerScene = localPlayerScene();
        const hit = playerScene && [...state.cameraStats.entries()].find(([, e]) => e.scene === playerScene && readyForGameView(e.renderer, e.scene));
        if (hit) { camera = hit[0]; entry = hit[1]; renderer = entry.renderer; }
        else {
          log('Not in a match (' + (playerScene ? 'player scene not drawn full-screen' : 'no local player') + ', ' + state.renderers.size + ' renderer(s)); starting menu-only VR.');
          renderer = null;
        }
      }
      session.addEventListener('end', onSessionEnded);
      button.textContent = 'EXIT VR';
      currentSession = session;
      if (!renderer) {
        try { await startStandalone(session); }
        catch (error) { record('error', ['Menu-only VR failed:', error]); session.end(); setStatus('VR failed: ' + (error && error.message || error)); }
        return;
      }
      state.renderer = renderer;
      try { renderer.xr.setFramebufferScaleFactor(Math.min(1.5, Math.max(0.4, Number(config.framebufferScale) || 1))); } catch {}
      await renderer.xr.setSession(session);
    }
    function onSessionEnded() {
      if (!currentSession) return;
      currentSession.removeEventListener('end', onSessionEnded);
      button.textContent = 'ENTER VR';
      currentSession = null;
    }

    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (!supported) { unsupported('VR NOT SUPPORTED'); return; }
      button.textContent = 'ENTER VR';
      button.onclick = () => {
        if (currentSession === null) {
          navigator.xr.requestSession('immersive-vr', sessionInit).then(onSessionStarted)
            .catch((error) => { warn('requestSession failed', error); setStatus('VR failed: ' + (error && error.message || error)); });
        } else {
          currentSession.end();
        }
      };
      if (navigator.xr.offerSession !== undefined) {
        navigator.xr.offerSession('immersive-vr', sessionInit).then(onSessionStarted).catch(() => {});
      }
    }).catch((error) => { unsupported('VR NOT ALLOWED'); warn('isSessionSupported failed', error); });
  }

  // --- debug console --------------------------------------------------------------------------------------------
  const LEVEL_COLORS = { info: '#9fd3ff', warn: '#ffd166', error: '#ff6b6b', 'game-warn': '#e6c47a', 'game-error': '#ff9a9a', 'page-error': '#ff6b6b', eval: '#b8f5a8', input: '#cccccc' };
  function liveSummary() {
    const player = (() => { try { return localPlayer(); } catch { return null; } })();
    const errors = Object.entries(featureErrors).map(([k, v]) => k + '×' + v).join(', ') || 'none';
    const fps = state.frameMs ? Math.round(1000 / state.frameMs) : 0;
    return [
      'VR: ' + (state.standalone && !state.standalone.handedOff ? 'in headset (menu-only, waiting for the game to render)' : state.presenting ? 'in headset' : 'not in VR') + (fps ? ' · ' + fps + ' fps' : ''),
      'View: ' + (state.gameplay ? (state.ragdoll ? 'ragdoll (third person)' : 'gameplay') : 'menu/theater') + ' (' + (state.gameplayReason || '-') + ')',
      'Eyes: ' + (state.gameplay ? (anchorObject().object === state.gameCamera ? 'game camera' : 'avatar head') : 'game camera')
        + ' · first-person flag: ' + (state.fp ? state.fp.label : 'none'),
      'Players: ' + (state.gameScene ? 'game scene' : state.lateScene ? 'map probe' : 'not found') + (state.reprobe ? ' (re-searching)' : '')
        + ' · local: ' + (player ? 'yes' : 'no'),
      'Aim: ' + config.aimMode + (state.aimPaused ? ' (paused: air kick/flip)' : '') + (state.emoteWheel ? ' · emote wheel open' : '') + (state.emoting ? ' · emoting' : '') + ' · learned ' + (state.aim.ratioX * 1000).toFixed(2) + ' mrad/px' + (state.aim.stuck > 30 ? ' · NOT RESPONDING' : ''),
      'Menu panel: ' + (state.menu ? (state.overlayOk ? 'drawn directly (' + (state.overlayDraws || 0) + ' frames, ' + (state.overlayStatus || '') + ')' : 'three.js mesh' + (state.overlayStatus ? ' (direct: ' + state.overlayStatus + ')' : '')) + (state.vscreen ? ' · 1920x1080 screen' : '') + (hudMode() ? ' (HUD)' : '') + ' · ' + state.menu.draws + ' draws · ' + state.menu.nodes + ' elements · ' + state.menu.drawMs.toFixed(1) + ' ms/draw' : (state.menuProblem || 'not built yet'))
        + ' · laser: ' + (state.uiHit ? 'on ' + state.uiHit.element.tagName.toLowerCase() : 'off') + ' · mouse captured: ' + (document.pointerLockElement ? 'yes' : 'no'),
      'Input: keys to ' + describeEl(keyTarget()) + ' · focus ' + describeEl(document.activeElement) + ' · page focused ' + (nativeHasFocus.call(document) ? 'yes' : 'no')
        + ' · game locked ' + describeEl(state.lockTarget) + ' (' + (state.lockRequests || 0) + 'x) · keys held ' + ([...state.keysDown].join(' ') || 'none'),
      'Frame: ' + (state.frameMs ? state.frameMs.toFixed(1) + ' ms' : '-') + ' · mod work ' + (state.modMs || 0).toFixed(1) + ' ms · repeated frames ' + (state.repeats || 0) + ' · blocked late clears ' + (state.blockedClears || 0) + ' · position glitches ' + (state.glitches || 0),
      'Renders/s: ' + renderReport(),
      'Clips: ' + clipReport(),
      'Feature errors: ' + errors,
    ];
  }

  function toggleInfoPanel(forceTab) {
    const old = document.getElementById('fister-vr-info');
    if (old && !forceTab) { old.remove(); logListener = null; return; }
    if (old) old.remove();
    const panel = document.createElement('div');
    panel.id = 'fister-vr-info';
    panel.style.cssText = 'position:fixed;left:16px;right:16px;top:12px;max-height:calc(100vh - 80px);overflow:auto;max-width:860px;z-index:2147483647;'
      + 'background:rgba(8,12,16,.94);color:#e8eef2;border:1px solid #6b7c8a;border-radius:8px;padding:10px;'
      + 'font:13px/1.35 ui-monospace,Consolas,monospace;display:flex;flex-direction:column;gap:8px;';
    const btn = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:bold 13px sans-serif;padding:8px 12px;border-radius:5px;border:1px solid #8aa;background:#1d2a33;color:#fff;cursor:pointer;';
      b.onclick = (e) => { e.stopPropagation(); onClick(b); b.blur(); };
      return b;
    };
    const tabsRow = document.createElement('div');
    tabsRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';
    const summary = document.createElement('div');
    summary.style.cssText = 'white-space:pre-wrap;color:#cfe8d0;border-bottom:1px solid #33444f;padding-bottom:6px;';
    const body = document.createElement('div');
    body.style.cssText = 'height:min(300px,40vh);overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;';
    let tab = forceTab || 'console';

    const renderConsole = () => {
      body.textContent = '';
      // Newest at the bottom; only what fits, so the headset copy of this panel stays inside its box.
      const shown = logBuffer.slice(-18);
      for (const entry of shown) {
        const line = document.createElement('div');
        line.style.cssText = 'white-space:pre-wrap;word-break:break-word;max-height:2.7em;overflow:hidden;color:' + (LEVEL_COLORS[entry.level] || '#fff');
        const secs = (entry.t / 1000).toFixed(1).padStart(7, ' ');
        line.textContent = secs + ' ' + entry.level.padEnd(10, ' ') + (entry.count > 1 ? '(' + entry.count + 'x) ' : '') + entry.msg.split('\n')[0].slice(0, 220);
        body.appendChild(line);
      }
      if (!shown.length) body.textContent = 'No messages yet.';
    };
    const renderStatus = () => {
      body.textContent = '';
      const pre = document.createElement('div');
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;overflow:hidden;';
      const d = root.fisterVR.dump();
      pre.textContent = Object.entries(d).filter(([k]) => !['gameScene', 'localPlayer', 'storage', 'userAgent'].includes(k))
        .map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('\n');
      body.appendChild(pre);
    };
    const runRow = document.createElement('div');
    runRow.style.cssText = 'display:flex;gap:6px;';
    const input = document.createElement('input');
    input.placeholder = 'JavaScript, e.g. fisterVR.config.aimGain = 0.4';
    input.style.cssText = 'flex:1;min-width:0;font:13px ui-monospace,monospace;padding:8px;background:#0d1419;color:#fff;border:1px solid #556;border-radius:5px;';
    const run = () => {
      const code = input.value.trim();
      if (!code) return;
      record('input', ['> ' + code]);
      try {
        const result = (0, eval)(code);
        record('eval', [result === undefined ? 'undefined' : result]);
      } catch (error) {
        record('error', [/unsafe-eval|Content Security/i.test(String(error)) ? 'The site blocks running typed code (CSP). Use the buttons instead.' : error]);
      }
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') run(); });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    runRow.append(input, btn('Run', run), btn('Copy all', (b) => copyReport(b, panel)));

    const refresh = () => {
      summary.textContent = liveSummary().join('\n');
      if (tab === 'console') renderConsole(); else renderStatus();
    };
    const setTab = (name) => { tab = name; refresh(); };
    const copyAll = (b) => copyReport(b, panel);
    tabsRow.append(
      btn('Console', () => setTab('console')),
      btn('Status', () => setTab('status')),
      btn('Copy all', copyAll),
      btn('Clear', () => { logBuffer.length = 0; refresh(); }),
      btn('Recenter', () => { state.pendingRecenter = true; }),
      btn('Wake input', () => reassertFocus('console')),
      btn('Close', () => toggleInfoPanel()),
    );
    panel.append(tabsRow, summary, body, runRow);
    document.body.appendChild(panel);
    let pending = false;
    logListener = () => { if (!pending) { pending = true; setTimeout(() => { pending = false; if (panel.isConnected) refresh(); }, 250); } };
    const tick = () => { if (!panel.isConnected) return; refresh(); setTimeout(tick, 1000); };
    tick();
  }

  function reportText() {
    let dump = '';
    try { dump = JSON.stringify(root.fisterVR.dump(), null, 1); } catch (error) { dump = 'dump failed: ' + error; }
    return 'Fister VR ' + VERSION + ' report\n' + liveSummary().join('\n') + '\n\nLOG\n'
      + logBuffer.map((e) => (e.t / 1000).toFixed(1) + ' ' + e.level + (e.count > 1 ? ' (' + e.count + 'x)' : '') + ' ' + e.msg).join('\n')
      + '\n\nDETAILS\n' + dump;
  }
  // Copy the whole report. If the browser refuses the clipboard, show it in a box, already selected, to copy by hand.
  function copyReport(button, host) {
    const text = reportText();
    const label = button ? button.textContent : '';
    const done = (ok) => { if (button) { button.textContent = ok ? 'Copied!' : 'Copy failed'; setTimeout(() => { button.textContent = label; }, 1800); } };
    const showBox = () => {
      let box = document.getElementById('fister-vr-copybox');
      if (!box) {
        box = document.createElement('textarea');
        box.id = 'fister-vr-copybox';
        box.readOnly = true;
        box.style.cssText = 'width:100%;height:160px;box-sizing:border-box;font:12px ui-monospace,monospace;background:#0d1419;color:#fff;border:1px solid #6b7c8a;border-radius:5px;';
        (host || document.body).appendChild(box);
      }
      box.value = text;
      box.focus(); box.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      done(ok);
      if (!ok) log('Copy blocked by the browser: the report is in the box below the console, selected. Long-press it and choose Copy.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), showBox);
    else showBox();
  }

  function setStatus(text) {
    if (state.statusEl && config.showStatus) state.statusEl.textContent = text ? 'Fister VR: ' + text : '';
  }

  // ---------------------------------------------------------------------------------------------------------
  // Console API
  // ---------------------------------------------------------------------------------------------------------
  function describe(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'Array(' + value.length + ')';
    if (value instanceof Map) return 'Map(' + value.size + ')';
    if (typeof value === 'object') return (value.type || (value.constructor && value.constructor.name) || 'object');
    if (typeof value === 'function') return 'function';
    return typeof value + ' = ' + JSON.stringify(value);
  }

  function applyButtonVisibility() {
    const show = config.showButton !== false;
    if (state.barEl) state.barEl.style.display = show ? 'flex' : 'none';
    if (state.statusEl) state.statusEl.style.display = show ? '' : 'none';
  }

  root.fisterVR = Object.freeze({
    version: VERSION,
    console: () => toggleInfoPanel(),
    // Same as pressing ENTER VR / EXIT VR. Call it from a click so the browser allows the headset session.
    toggle() { whenBody(ensureVrButton); const b = state.buttonEl; if (b && typeof b.onclick === 'function') { b.onclick(); return true; } return false; },
    get buttonText() { return state.buttonEl ? state.buttonEl.textContent : ''; },
    get presenting() { return !!state.presenting || !!(state.standalone && !state.standalone.handedOff); },
    copyLog: (button) => copyReport(button || null, document.getElementById('fister-vr-info')),
    applyButtonVisibility,
    clipFrame,
    clipRect,
    clipStats: () => state.clip ? { frames: state.clip.frames, ms: +state.clip.ms.toFixed(2), width: state.clip.canvas.width, height: state.clip.canvas.height, recording: clipRecording(), method: state.clip.method, picture: state.clip.imgMax, gameCanvas: state.clip.fbMax, mirror: state.clip.canvas.isConnected } : { frames: 0, recording: clipRecording() },
    config,
    state,
    saveConfig,
    recenter: () => { state.pendingRecenter = true; },
    setFirstPersonPath(path, value = true) {
      config.firstPerson = { path, value };
      saveConfig();
      state.fp = null;
      return detectFirstPerson(true);
    },
    resetConfig() { try { localStorage.removeItem(CONFIG_KEY); } catch {} location.reload(); },
    // Paste the output of this to get exact game hook names wired in.
    dump() {
      const gs = gameScene();
      const out = { version: VERSION, userAgent: navigator.userAgent, attach: state.lateScene && state.lateScene !== state.gameScene ? 'late' : 'early',
        gameSceneCaptured: !!state.gameScene, playersFound: !!(gs && gs.players), localPlayerFound: !!localPlayer(),
        renderers: state.renderers.size, camerasSeen: state.cameraStats.size,
        menuPanel: state.menu ? { draws: state.menu.draws, elements: state.menu.nodes, msPerDraw: +state.menu.drawMs.toFixed(1) } : (state.menuProblem || 'not built yet'),
        inGameplay: !!state.gameplay,
        outlinesHidden: state.outlines ? [...state.outlines.keys()].slice(0, 12).map((n) => {
          const m = Array.isArray(n.material) ? n.material[0] : n.material;
          return (n.name || '(unnamed)') + ' ' + (m && m.type) + ' side=' + (m && m.side) + ' blend=' + (m && m.blending) + (m && m.color ? ' #' + m.color.getHexString() : '');
        }) : [],
        firstPerson: state.fp ? state.fp.label : null,
        clip: (() => { try { const b = root.__fisterQolVrBridge; return b && typeof b.clipInfo === 'function' ? b.clipInfo() : 'FisterQoL not loaded'; } catch (e) { return String(e); } })(),
        gameScene: {}, localPlayer: {}, storage: {} };
      if (gs) for (const key of Object.keys(gs)) { try { out.gameScene[key] = describe(gs[key]); } catch {} }
      const player = localPlayer();
      if (player) for (const key of Object.keys(player)) { try { out.localPlayer[key] = describe(player[key]); } catch {} }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (/fister|camera|view|person|pov|control|bind/i.test(key)) out.storage[key] = String(localStorage.getItem(key)).slice(0, 200);
        }
      } catch {}
      const text = JSON.stringify(out, null, 1);
      console.log(text);
      return out;
    },
    _internals: { isEmoting, liveSummary, screenRect, applyVirtualScreen, captureRenderer, captureGameScene, pickMain, harvestClasses, ensureRig, updateRig, detectFirstPerson,
      lockFirstPerson, unlockFirstPerson, boxGeometry, overrideArms, localPlayer, xrFrame, pollInput, gameScene, steerAim, armInfo, reassertFocus, spoofFocus, hideOutlines, isGameplayCamera, toggleInfoPanel, checkPlayersFresh, setupMenu, updateMenu, paintDom, startStandalone, handOffStandalone, isMainRenderer, sceneHasBuildingBlocks, runDueTimers, uiPress, uiScroll, spoofPointerLock, logBuffer, liveSummary, hideBody, restoreBody, bodyMeshes, isRagdolled },
  });

  whenBody(ensureVrButton); // available right away, even before the game draws anything 3D
  log('v' + VERSION + ' loaded.');
})();
