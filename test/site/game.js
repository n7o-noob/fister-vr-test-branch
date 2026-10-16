import * as THREE from './three.module.js';
// Something else that grabs `.renderer` first (like an EffectComposer)
class FakeComposer { constructor(r){ this.renderer = r; this.passes = []; } }
class Player {
  constructor(id, scene){
    this.id = id; this.mesh = new THREE.Group(); this.mesh.position.set(2, 0, -3);
    this.head = new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3), new THREE.MeshStandardMaterial()); this.head.position.y = 1.6;
    this.leftArm = new THREE.Mesh(new THREE.BoxGeometry(.1,.5,.1), new THREE.MeshStandardMaterial()); this.leftArm.position.set(-.3,1.2,0);
    this.rightArm = this.leftArm.clone(); this.rightArm.position.x = .3;
    this.mesh.add(this.head, this.leftArm, this.rightArm); scene.add(this.mesh);
  }
  isLocalPlayer(){ return this.id === 'me'; }
}
class GameScene {
  constructor(){
    const renderer = new THREE.WebGLRenderer({ antialias:false });
    this.composer = new FakeComposer(renderer);
    renderer.setSize(800, 600);
    document.getElementById('game').appendChild(renderer.domElement);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 500);
    this.players = new Map();
    this.localPlayerId = 'me';
    this.cameraController = location.search.includes('nofp') ? { distance: 4 } : { firstPersonEnabled: false, distance: 4 };
    this.screenShakeIntensity = 0.4;
    this.scene.add(new THREE.Mesh(new THREE.BoxGeometry(50,.1,50), new THREE.MeshBasicMaterial({color:0x334455})));
    this.players.set('me', new Player('me', this.scene));
    this.players.set('bot', new Player('bot', this.scene));
    this.frames = 0;
  }
  update(){
    const me = this.players.get('me');
    this.mesh = me.mesh; me.mesh.rotation.y += 0.01;
    // third-person unless first-person flag is on
    const headPos = me.head.getWorldPosition(new THREE.Vector3());
    if (this.cameraController.firstPersonEnabled) this.camera.position.copy(headPos);
    else this.camera.position.copy(headPos).add(new THREE.Vector3(0, 1, 4));
    this.camera.rotation.set(-0.2, 0.7, 0, 'YXZ');
  }
  frame = () => { this.update(); this.renderer.render(this.scene, this.camera); this.frames++; requestAnimationFrame(this.frame); };
}
// Avatar preview renderer in a menu (should not be picked as main)
const preview = new THREE.WebGLRenderer(); preview.setSize(64,64);
const pScene = new THREE.Scene(), pCam = new THREE.PerspectiveCamera();
window.game = new GameScene();
requestAnimationFrame(window.game.frame);
(function pv(){ preview.render(pScene, pCam); requestAnimationFrame(pv); })();
window.THREE_REF = THREE;
