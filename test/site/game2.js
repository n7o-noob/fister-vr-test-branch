import * as THREE from './three.module.js';
class Player {
  constructor(id, scene) {
    this.id = id; this.mesh = new THREE.Group(); this.mesh.position.set(0, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5522aa });
    this.head = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3), mat); this.head.position.y = 1.6;
    // Arms pivot at the shoulder and hang down -Y, like a typical avatar rig.
    const armGeo = new THREE.BoxGeometry(.12, .6, .12); armGeo.translate(0, -0.3, 0);
    this.leftArm = new THREE.Mesh(armGeo, mat); this.leftArm.position.set(-.25, 1.4, 0);
    this.rightArm = new THREE.Mesh(armGeo, mat); this.rightArm.position.set(.25, 1.4, 0);
    // Torso + legs + clothing. Arms hang off the torso, as in many rigs.
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(.5, .6, .25), mat); this.torso.position.y = 1.1;
    this.shirt = new THREE.Mesh(new THREE.BoxGeometry(.55, .5, .3), new THREE.MeshStandardMaterial({ color: 0x2266ff })); this.torso.add(this.shirt);
    const legGeo = new THREE.BoxGeometry(.15, .8, .15); legGeo.translate(0, -0.4, 0);
    this.leftLeg = new THREE.Mesh(legGeo, mat); this.leftLeg.position.set(-.12, .8, 0);
    this.rightLeg = new THREE.Mesh(legGeo, mat); this.rightLeg.position.set(.12, .8, 0);
    this.shoe = new THREE.Mesh(new THREE.BoxGeometry(.18, .1, .25), mat); this.shoe.position.y = -0.78; this.leftLeg.add(this.shoe);
    this.hat = new THREE.Mesh(new THREE.BoxGeometry(.35, .1, .35), mat); this.hat.position.y = 0.2; this.head.add(this.hat);
    // arms parented to the torso (positions relative to torso)
    this.leftArm.position.set(-.25, .3, 0); this.rightArm.position.set(.25, .3, 0);
    this.torso.add(this.leftArm, this.rightArm);
    // Every avatar has a black back-faced outline shell around its body (the "inverted black box" look).
    this.outline = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.9, .5), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    this.outline.position.y = 0.95;
    this.mesh.add(this.head, this.torso, this.leftLeg, this.rightLeg, this.outline); scene.add(this.mesh);
    if (location.search.includes('items')) {
      // Power-up items like Fister's: separate objects the game places from its arm animation each frame.
      this.scytheMesh = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .7), new THREE.MeshStandardMaterial({ color: 0xcccccc })); scene.add(this.scytheMesh);
      this.firstPersonWeaponRoot = new THREE.Group(); this.firstPersonWeaponRoot.add(new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .3), new THREE.MeshBasicMaterial({ color: 0xff8800 })));
    }
  }
  isLocalPlayer() { return this.id === 'me'; }
}
class Game {
  constructor() {
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(innerWidth, innerHeight);
    document.getElementById('game').appendChild(renderer.domElement);
    this.renderer = renderer; this.scene = new THREE.Scene();
    if (location.search.includes('textured')) { const c = document.createElement('canvas'); c.width = c.height = 4; this.scene.background = new THREE.CanvasTexture(c); }
    else this.scene.background = new THREE.Color(0x88bbee); // flat-coloured, no textures anywhere
    // Power-up with an inverted-hull outline (back faces, black) - renders as a black box in VR.
    this.powerup = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .4), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    this.powerup.position.set(1, 1, -2);
    this.powerupOutline = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .4), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    this.powerupOutline.scale.setScalar(1.15); this.powerup.add(this.powerupOutline); this.scene.add(this.powerup);
    // Menu / between-rounds: separate scene and camera, no avatar.
    this.menuScene = new THREE.Scene(); this.menuScene.background = new THREE.Color(0x222244);
    this.menuScene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff00ff })));
    this.menuCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100); this.menuCamera.position.set(3, 2, 6); this.menuCamera.lookAt(0, 0, 0);
    this.requireLock = location.search.includes('lock'); this.mode = 'play'; this.rebuildAt = -1; this.thirdPerson = location.search.includes('third');
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 500);
    this.players = new Map(); this.localPlayerId = 'me';
    this.scene.add(new THREE.Mesh(new THREE.BoxGeometry(50, .1, 50), new THREE.MeshBasicMaterial({ color: 0x228822 })));
    this.players.set('me', new Player('me', this.scene));
    const other = new Player('bot', this.scene); other.mesh.position.set(3, 0, -4); this.players.set('bot', other);
    this.yaw = 0; this.pitch = 0; this.sens = 0.0031; this.keys = new Set(); this.paused = false; this.frames = 0; this.respawns = 0;
    this.lockEl = () => (location.search.includes('lockbody') ? document.body : this.renderer.domElement);
    const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' && a.type === 'text'); };
    document.addEventListener('mousemove', (e) => { if (this.paused || typing()) return; if (this.requireLock && document.pointerLockElement !== this.lockEl()) return; this.yaw -= e.movementX * this.sens; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * this.sens)); });
    window.addEventListener('keydown', (e) => { if (!this.paused && !typing()) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // The bug the user hit: losing focus clears input and ignores it until the window is focused again.
    window.addEventListener('blur', () => { this.paused = true; this.keys.clear(); });
    window.addEventListener('focus', () => { this.paused = false; });
    document.getElementById('respawn').addEventListener('click', () => this.respawns++);
  }
  rebuildPlayers() {
    // What some games do on respawn / resync: throw away the player objects and the Map, make new ones.
    const old = this.players.get('me');
    this.scene.remove(old.mesh);
    const fresh = new Player('me', this.scene);
    fresh.mesh.position.copy(old.mesh.position);
    this.players = new Map([['me', fresh]]);
  }
  frame = () => {
    if (location.search.includes('norender') && !window.__started) { requestAnimationFrame(this.frame); return; } // main menu: no 3D yet
    if (location.search.includes('emptymenu') && !window.__started) { // main menu drawn as a sky colour only (no meshes)
      if (!this.emptyScene) { this.emptyScene = new THREE.Scene(); this.emptyScene.background = new THREE.Color(0x88bbee); }
      this.renderer.render(this.emptyScene, this.menuCamera); requestAnimationFrame(this.frame); return;
    }
    if (location.search.includes('rebuild') && this.frames === this.rebuildAt) this.rebuildPlayers();
    const me = this.players.get('me');
    me.mesh.rotation.y = this.yaw;
    if (this.keys.has('KeyW')) me.mesh.translateZ(-0.08);
    this.camera.position.copy(me.mesh.localToWorld(new THREE.Vector3(0, 1.6, 0)));
    me.isRagdollState = !!this.ragdoll;
    if (this.ragdoll) { me.head.position.set(Math.sin(this.frames) * 0.5, 0.4, 0.6); this.camera.position.add(new THREE.Vector3(0, 2, 6)); }
    else if (!this.glitchNext) me.head.position.set(0, 1.6, 0);
    if (this.thirdPerson) this.camera.position.add(new THREE.Vector3(Math.sin(this.yaw) * 8, 2, Math.cos(this.yaw) * 8));
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (me.scytheMesh) {
      // Arm swing animation; the scythe is put at the (game) hand end every frame, blade along the arm's forward.
      if (location.search.includes('animall')) { me.leftArm.position.set(-.25, .3, 0); me.leftArm.scale.set(1, 1, 1); }
      me.leftArm.rotation.x = Math.sin(this.frames * 0.05) * 0.6;
      me.leftArm.updateMatrixWorld(true);
      const hand = me.leftArm.localToWorld(new THREE.Vector3(0, -0.6, 0));
      me.scytheMesh.position.copy(hand); me.leftArm.getWorldQuaternion(me.scytheMesh.quaternion);
      if (!me.firstPersonWeaponRoot.parent) { this.camera.add(me.firstPersonWeaponRoot); me.firstPersonWeaponRoot.position.set(0.3, -0.3, -0.5); }
    }
    if (this.glitchNext) { this.glitchNext = false; me.head.position.set(NaN, NaN, NaN); me.head.updateMatrixWorld(); }
    if (location.search.includes('composite') && !window.__started) {
      // Main menu like a render-scaled game: 3D background into an offscreen target, then a flat full-screen copy
      // (orthographic camera) to the screen, plus a small avatar preview drawn straight to the screen (dark, scissored).
      const r = this.renderer, size = r.getSize(new THREE.Vector2());
      if (!this.menuTarget) {
        this.menuTarget = new THREE.WebGLRenderTarget(960, 540);
        this.blitScene = new THREE.Scene(); this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.menuTarget.texture })));
        this.previewScene = new THREE.Scene(); this.previewScene.background = new THREE.Color(0x050505);
        // Avatar parts + cosmetics: more objects than the menu scene, so it looks like the "main" camera to a picker.
        for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(.1, .2, .1), new THREE.MeshBasicMaterial({ color: 0x333333 })); m.position.set((i % 4 - 1.5) * .12, Math.floor(i / 4) * .22 - .22, 0); this.previewScene.add(m); }
        this.previewCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 10); this.previewCamera.position.set(0, 0, 2);
      }
      this.menuScene.children[0].rotation.y = this.frames * 0.02;
      r.setRenderTarget(this.menuTarget); r.render(this.menuScene, this.menuCamera); r.setRenderTarget(null);
      r.render(this.blitScene, this.blitCamera);
      const pw = Math.round(size.x * 0.2), ph = Math.round(size.y * 0.3);
      // The preview redraws only on some frames (on demand), and twice when it does (e.g. a shadow/outline pass).
      if (this.frames % 4 === 0) for (let k = 0; k < 2; k++) {
      r.setScissorTest(true); r.setScissor(20, 20, pw, ph); r.setViewport(20, 20, pw, ph);
      r.autoClear = false; r.clear(); r.render(this.previewScene, this.previewCamera); r.autoClear = true;
      r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y);
      }
      this.frames++; requestAnimationFrame(this.frame); return;
    }
    if (this.mode === 'menu') this.renderer.render(this.menuScene, this.menuCamera);
    else this.renderer.render(this.scene, this.camera);
    if (this.lateClear) this.renderer.clear(); // a game that clears after drawing
    this.frames++; requestAnimationFrame(this.frame);
  };
}
window.THREE_REF = THREE;
window.game = new Game(); requestAnimationFrame(window.game.frame);
if (location.search.includes('layer1')) {
  // Camera and world on layer 1 only: objects left on layer 0 are invisible to this camera.
  window.game.camera.layers.set(1);
  window.game.scene.traverse((o) => o.layers.set(1));
}
