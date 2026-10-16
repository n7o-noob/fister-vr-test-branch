// Minimal fake WebXR device: enough of the API for the mod and three.js's WebXRManager to run end to end.
(() => {
  const persp = (fov, aspect, near, far) => { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); };
  const translation = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const xform = (m) => ({ matrix: m, position: { x: m[12], y: m[13], z: m[14], w: 1 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    get inverse() { return { matrix: translation(-m[12], -m[13], -m[14]) }; } });
  const rayMatrix = (o, d) => {
    const len = Math.hypot(...d); const z = [-d[0] / len, -d[1] / len, -d[2] / len];
    let x = [z[2], 0, -z[0]]; const xl = Math.hypot(...x) || 1; x = x.map(v => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return new Float32Array([...x, 0, ...y, 0, ...z, 0, o[0], o[1], o[2], 1]);
  };
  const pad = () => ({ buttons: Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0], mapping: 'xr-standard' });
  const sources = ['right', 'left'].map((hand) => ({ handedness: hand, targetRayMode: 'tracked-pointer', profiles: [], gamepad: pad(),
    targetRaySpace: { hand, kind: 'ray' }, gripSpace: { hand, kind: 'grip' } }));
  const rays = { right: rayMatrix([0.2, 1.2, -0.3], [0, 0, -1]), left: rayMatrix([-0.2, 1.2, -0.3], [0, 0, -1]) };
  const head = translation(0, 1.6, 0);
  const proj = persp(Math.PI / 2, 1, 0.05, 1000);
  window.__xrMock = {
    sessions: 0, frames: 0,
    setRay(hand, o, d) { rays[hand] = rayMatrix(o, d); },
    setAxes(hand, axes) { const s = sources.find(x => x.handedness === hand); axes.forEach((v, i) => { s.gamepad.axes[i] = v; }); },
    press(hand, index, on) { const s = sources.find(x => x.handedness === hand); s.gamepad.buttons[index].pressed = on; s.gamepad.buttons[index].value = on ? 1 : 0; if (index === 0 && window.__xrMock.session) { const e = new Event(on ? 'selectstart' : 'selectend'); e.inputSource = s; e.frame = window.__xrMock.session.__frame(); window.__xrMock.session.dispatchEvent(e); if (!on) { const e2 = new Event('select'); e2.inputSource = s; e2.frame = window.__xrMock.session.__frame(); window.__xrMock.session.dispatchEvent(e2); } } },
  };
  class FakeLayer {
    constructor(session, gl) { this.gl = gl; this.framebuffer = null; this.framebufferWidth = gl.drawingBufferWidth; this.framebufferHeight = gl.drawingBufferHeight; this.ignoreDepthValues = false; this.antialias = true; session.__layers.push(this); }
    getViewport(view) { const w = this.framebufferWidth / 2; return { x: view.eye === 'left' ? 0 : w, y: 0, width: w, height: this.framebufferHeight }; }
  }
  window.XRWebGLLayer = FakeLayer;
  // Optional WebXR Layers, like the Quest Browser: three.js then draws into a projection layer's texture instead.
  // Turn on with window.__xrMockLayers = true before the page loads.
  if (window.__xrMockLayers) {
    class FakeBinding {
      constructor(session, gl) { this.session = session; this.gl = gl; }
      createProjectionLayer() {
        const gl = this.gl, w = 1280, h = 640;
        const color = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, color);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const depth = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, depth);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH24_STENCIL8, w, h, 0, gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        const layer = { textureWidth: w, textureHeight: h, textureArrayLength: 1, ignoreDepthValues: false, fixedFoveation: 0, __color: color, __depth: depth };
        window.__xrMock.projectionLayer = layer; window.__xrMock.gl = gl;
        return layer;
      }
      getViewSubImage(layer, view) {
        const w = layer.textureWidth / 2;
        return { colorTexture: layer.__color, depthStencilTexture: layer.__depth, imageIndex: 0,
          viewport: { x: view.eye === 'left' ? 0 : w, y: 0, width: w, height: layer.textureHeight } };
      }
    }
    window.XRWebGLBinding = FakeBinding;
    // Read the projection layer back as an image (what the headset would show).
    window.__xrMock.layerImage = () => {
      const gl = window.__xrMock.gl, layer = window.__xrMock.projectionLayer;
      if (!gl || !layer) return null;
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.__color, 0);
      const w = layer.textureWidth, h = layer.textureHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    };
  }
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) C.prototype.makeXRCompatible = () => Promise.resolve();
  class FakeSession extends EventTarget {
    constructor() { super(); this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000 }; this.inputSources = sources; this.enabledFeatures = ['local']; this.environmentBlendMode = 'opaque'; this.visibilityState = 'visible'; this.__layers = []; this.__ended = false;
      setTimeout(() => { const e = new Event('inputsourceschange'); e.added = sources; e.removed = []; this.dispatchEvent(e); }, 30); }
    updateRenderState(s) { Object.assign(this.renderState, s); return Promise.resolve(); }
    requestReferenceSpace() { return Promise.resolve({ getOffsetReferenceSpace() { return this; }, addEventListener() {} }); }
    requestAnimationFrame(cb) { return setTimeout(() => { if (this.__ended) return; window.__xrMock.frames++; cb(performance.now(), this.__frame()); }, 14); }
    cancelAnimationFrame(id) { clearTimeout(id); }
    end() { if (this.__ended) return Promise.resolve(); this.__ended = true; this.dispatchEvent(new Event('end')); return Promise.resolve(); }
    __frame() {
      const session = this;
      const view = (eye, dx) => ({ eye, projectionMatrix: proj, transform: xform(translation(dx, 1.6, 0)), recommendedViewportScale: null, requestViewportScale() {} });
      return { session,
        getViewerPose() { return { transform: xform(head), views: [view('left', -0.032), view('right', 0.032)], emulatedPosition: false }; },
        getPose(space) { if (!space || !space.hand) return null; return { transform: xform(rays[space.hand]), emulatedPosition: false }; },
      };
    }
  }
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: () => Promise.resolve(true),
    requestSession: () => { window.__xrMock.sessions++; window.__xrMock.session = new FakeSession(); return Promise.resolve(window.__xrMock.session); },
    addEventListener() {}, removeEventListener() {},
  } });
})();
