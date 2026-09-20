import * as THREE from 'three';
import { applyToCamera, fitScale, screenToGround, worldToScreen, type ViewState, type Viewport } from './camera.ts';
import type { MapData } from './mapdata.ts';
import { buildFadeUniforms, buildGround } from './render/ground.ts';
import { buildParkProps } from './render/parkProps.ts';
import { makeShadowMaterial } from './render/shadow.ts';
import type { FadeUniforms } from './render/shaders.ts';
import { buildTrees, type Trees } from './render/trees.ts';
import { buildViaduct } from './render/viaduct.ts';

// Colors are authored as final screen values (Sims-era look), so turn off color management.
THREE.ColorManagement.enabled = false;

const MAX_SCALE = 26; // px per meter at closest zoom
const ROTATE_STEP = Math.PI / 4;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Anim {
  from: ViewState;
  to: ViewState;
  start: number;
  ms: number;
}

export class MapApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  readonly data: MapData;
  readonly baseAzimuth: number;
  /** Horizontal ground shift of a shadow per meter of height (world-fixed sun). */
  readonly sunOffset: THREE.Vector2;
  readonly sunLight: THREE.DirectionalLight;
  readonly shadowMaterial = makeShadowMaterial();
  readonly fade: FadeUniforms;
  /** Ground draw slot for place lots (see buildGround). */
  readonly lotOrder: number;
  readonly trees: Trees;
  view: ViewState;
  vp: Viewport = { width: 1, height: 1 };

  private anim: Anim | null = null;
  private frameRequested = false;
  /** Set when something changed (view, hover, data); cleared after a render. */
  private dirty = true;
  private lastRender = 0;
  private tickers = new Set<(now: number) => void>();
  private viewListeners = new Set<() => void>();

  private container: HTMLElement;

  constructor(container: HTMLElement, data: MapData) {
    this.container = container;
    this.data = data;
    // Phones have far less GPU memory than laptops: skip multisampling and draw fewer pixels there.
    const small = Math.min(window.screen.width, window.screen.height) <= 820;
    this.renderer = new THREE.WebGLRenderer({ antialias: !small, stencil: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.75 : 2));
    this.renderer.setClearColor('#1a2b13');
    this.renderer.domElement.className = 'map-canvas';
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

    // Camera looks across the street grid at an angle, like a Sims neighborhood, turned a little
    // toward north (grid + 30 deg puts north about 20 deg right of straight up).
    this.baseAzimuth = ((data.gridAngle + 30) * Math.PI) / 180;

    // Shadows fall toward the right of the default view and slightly away from the camera.
    const fwd = new THREE.Vector2(Math.cos(this.baseAzimuth), Math.sin(this.baseAzimuth));
    this.sunOffset = fwd.clone().rotateAround(new THREE.Vector2(), (-55 * Math.PI) / 180).multiplyScalar(0.8);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9aa585', 1.35));
    this.sunLight = new THREE.DirectionalLight('#fff3da', 1.1);
    this.sunLight.position.set(-this.sunOffset.x, -this.sunOffset.y, 1).multiplyScalar(1000);
    this.scene.add(this.sunLight);

    this.fade = buildFadeUniforms(data);
    const ground = buildGround(data, this.fade);
    this.scene.add(ground.group);
    this.lotOrder = ground.lotOrder;
    this.trees = buildTrees(data.trees, this.fade, this.shadowMaterial, this.sunOffset);
    this.scene.add(this.trees.group);
    this.scene.add(buildViaduct(data, this.shadowMaterial, this.sunOffset));
    this.scene.add(buildParkProps(data, this.shadowMaterial, this.sunOffset));

    const c = data.core;
    this.view = { tx: (c.minX + c.maxX) / 2, ty: (c.minY + c.maxY) / 2, scale: 1, azimuth: this.baseAzimuth };
    this.resize();
    this.view.scale = this.fitScale();
    new ResizeObserver(() => this.resize()).observe(container);
    this.requestRender();
  }

  fitScale(azimuth = this.view.azimuth): number {
    return fitScale(this.vp, azimuth, this.data.core);
  }

  get minScale(): number {
    return this.fitScale() * 0.85;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.vp = { width: w, height: h };
    this.renderer.setSize(w, h, false);
    this.setView({});
  }

  /** Apply a view change immediately (clamped), cancelling any animation. */
  setView(v: Partial<ViewState>, cancelAnim = true) {
    if (cancelAnim) this.anim = null;
    this.view = this.clamp({ ...this.view, ...v });
    this.requestRender();
    this.viewListeners.forEach((f) => f());
  }

  animateTo(v: Partial<ViewState>, ms = 550) {
    this.anim = { from: { ...this.view }, to: this.clamp({ ...this.view, ...v }), start: performance.now(), ms };
    this.requestRender();
  }

  /** Turn the view by one step (45 deg; eight views all the way around). */
  rotate(dir: 1 | -1) {
    const base = this.anim?.to ?? this.view;
    this.animateTo({ azimuth: base.azimuth + dir * ROTATE_STEP }, 350);
  }

  /** Turn the view freely, for a rotate drag or a sideways trackpad swipe. */
  rotateBy(rad: number) {
    this.setView({ azimuth: this.view.azimuth + rad });
  }

  /** Settle a free rotation on the nearest of the eight views. */
  snapAzimuth() {
    const a = this.view.azimuth;
    const snapped = this.baseAzimuth + Math.round((a - this.baseAzimuth) / ROTATE_STEP) * ROTATE_STEP;
    if (Math.abs(snapped - a) > 1e-4) this.animateTo({ azimuth: snapped }, 220);
  }

  /** Zoom by a factor keeping the ground point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number) {
    const [gx, gy] = this.screenToGround(sx, sy);
    const scale = Math.min(MAX_SCALE, Math.max(this.minScale, this.view.scale * factor));
    const next = { ...this.view, scale };
    const [nx, ny] = screenToGround(next, this.vp, sx, sy);
    this.setView({ scale, tx: this.view.tx + gx - nx, ty: this.view.ty + gy - ny });
  }

  zoomAnimated(factor: number) {
    const base = this.anim?.to ?? this.view;
    this.animateTo({ scale: Math.min(MAX_SCALE, Math.max(this.minScale, base.scale * factor)) }, 300);
  }

  home() {
    this.animateTo({
      tx: (this.data.core.minX + this.data.core.maxX) / 2,
      ty: (this.data.core.minY + this.data.core.maxY) / 2,
      scale: this.fitScale(),
    });
  }

  /** Camera target that puts world point (x, y, z) at screen (sx, sy) for the given scale. */
  targetFor(x: number, y: number, z: number, scale: number, sx: number, sy: number): { tx: number; ty: number } {
    const v: ViewState = { tx: x, ty: y, scale, azimuth: (this.anim?.to ?? this.view).azimuth };
    const [px, py] = worldToScreen(v, this.vp, x, y, z);
    const [tx, ty] = screenToGround(v, this.vp, this.vp.width / 2 - (sx - px), this.vp.height / 2 - (sy - py));
    return { tx, ty };
  }

  screenToGround(sx: number, sy: number): [number, number] {
    return screenToGround(this.view, this.vp, sx, sy);
  }

  worldToScreen(x: number, y: number, z = 0): [number, number] {
    return worldToScreen(this.view, this.vp, x, y, z);
  }

  onViewChange(f: () => void) {
    this.viewListeners.add(f);
  }

  /** Register a per-frame callback that keeps the loop running (e.g. bobbing markers). */
  addTicker(f: (now: number) => void) {
    this.tickers.add(f);
    this.requestRender();
  }

  removeTicker(f: (now: number) => void) {
    this.tickers.delete(f);
  }

  requestRender() {
    this.dirty = true;
    this.schedule();
  }

  private schedule() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(this.frame);
  }

  private clamp(v: ViewState): ViewState {
    const c = this.data.core;
    const slack = 150;
    return {
      ...v,
      tx: Math.min(c.maxX + slack, Math.max(c.minX - slack, v.tx)),
      ty: Math.min(c.maxY + slack, Math.max(c.minY - slack, v.ty)),
      scale: Math.min(MAX_SCALE, Math.max(this.fitScale(v.azimuth) * 0.85, v.scale)),
    };
  }

  private frame = (now: number) => {
    this.frameRequested = false;
    // Ambient animation only (trains, hearts): 30 fps is plenty and saves battery.
    if (!this.dirty && !this.anim && now - this.lastRender < 32) {
      if (this.tickers.size) this.schedule();
      return;
    }
    this.dirty = false;
    this.lastRender = now;
    if (this.anim) {
      const { from, to, start, ms } = this.anim;
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      const lerp = (a: number, b: number) => a + (b - a) * k;
      // Scale interpolates geometrically so zooming feels even.
      this.view = {
        tx: lerp(from.tx, to.tx),
        ty: lerp(from.ty, to.ty),
        scale: from.scale * (to.scale / from.scale) ** k,
        azimuth: lerp(from.azimuth, to.azimuth),
      };
      if (t >= 1) this.anim = null;
      this.viewListeners.forEach((f) => f());
    }
    this.tickers.forEach((f) => f(now));
    applyToCamera(this.camera, this.view, this.vp);
    this.trees.setAzimuth(this.view.azimuth);
    this.renderer.render(this.scene, this.camera);
    if (this.anim || this.tickers.size) this.schedule();
  };
}
