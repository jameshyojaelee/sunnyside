// Day and night. Flipping the switch eases the whole map over: the sun goes down, the painted
// ground and trees cool off, shop windows light up and every streetlight comes on.
import * as THREE from 'three';
import type { MapApp } from './app.ts';
import { setWindowsLit } from './render/buildings.ts';
import { NIGHT } from './render/shaders.ts';

const FADE_MS = 900;

const DAY = {
  sky: new THREE.Color('#ffffff'),
  ground: new THREE.Color('#9aa585'),
  hemi: 1.35,
  sun: new THREE.Color('#fff3da'),
  sunLevel: 1.1,
  clear: new THREE.Color('#1a2b13'),
};
const NIGHT_LOOK = {
  sky: new THREE.Color('#7f92cc'),
  ground: new THREE.Color('#2a3350'),
  hemi: 0.42,
  sun: new THREE.Color('#9db2ee'),
  sunLevel: 0.16,
  clear: new THREE.Color('#060a16'),
};

/** Unlit colors (roofs, road markings on courts, train stripes) have to be dimmed by hand. */
const baseColors = new WeakMap<THREE.Material, THREE.Color>();

export class NightMode {
  /** 0 = day, 1 = night; slides between the two. */
  level = 0;
  private target = 0;
  private app: MapApp;
  private listeners = new Set<(on: boolean) => void>();

  constructor(app: MapApp) {
    this.app = app;
    app.addTicker(this.tick);
    this.apply();
  }

  get on(): boolean {
    return this.target > 0.5;
  }

  toggle() {
    this.set(!this.on);
  }

  set(on: boolean) {
    this.target = on ? 1 : 0;
    setWindowsLit(on);
    this.listeners.forEach((f) => f(on));
    this.app.requestRender();
  }

  onChange(f: (on: boolean) => void) {
    this.listeners.add(f);
  }

  private tick = (now: number) => {
    if (this.level === this.target) return;
    const step = (this.lastTick ? Math.min(120, now - this.lastTick) : 16) / FADE_MS;
    this.lastTick = now;
    this.level = this.target > this.level ? Math.min(this.target, this.level + step) : Math.max(this.target, this.level - step);
    this.apply();
    this.app.requestRender();
  };
  private lastTick = 0;

  private apply() {
    const t = this.level;
    const mix = (a: THREE.Color, b: THREE.Color) => a.clone().lerp(b, t);
    NIGHT.value = t;
    const hemi = this.app.scene.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight);
    if (hemi) {
      hemi.color.copy(mix(DAY.sky, NIGHT_LOOK.sky));
      hemi.groundColor.copy(mix(DAY.ground, NIGHT_LOOK.ground));
      hemi.intensity = DAY.hemi + (NIGHT_LOOK.hemi - DAY.hemi) * t;
    }
    this.app.sunLight.color.copy(mix(DAY.sun, NIGHT_LOOK.sun));
    this.app.sunLight.intensity = DAY.sunLevel + (NIGHT_LOOK.sunLevel - DAY.sunLevel) * t;
    this.app.renderer.setClearColor(mix(DAY.clear, NIGHT_LOOK.clear));
    this.dimUnlit(t);
  }

  /** Materials that ignore lights: fade their color toward the same moonlit tone the shaders use. */
  private dimUnlit(t: number) {
    this.app.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const basic = mat as THREE.MeshBasicMaterial;
        if (!basic || !('color' in basic) || basic.type !== 'MeshBasicMaterial') continue;
        if (basic.userData.glow) continue; // neon and lit signs stay bright
        let base = baseColors.get(basic);
        if (!base) {
          base = basic.color.clone();
          baseColors.set(basic, base);
        }
        basic.color.copy(base).lerp(base.clone().multiply(new THREE.Color(0.3, 0.35, 0.52)), t);
      }
    });
  }
}
