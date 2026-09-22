import * as THREE from 'three';
import { rng } from '../geo.ts';
import { FADE_GLSL, NIGHT, NIGHT_GLSL, NOISE_GLSL, type FadeUniforms } from './shaders.ts';

const CELL_W = 128;
const CELL_H = 160;
const TYPES = 4;

/** Procedural tree sprites: 0/1 round deciduous (light/dark), 2/3 conifer (green/blue-green). */
function drawAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CELL_W * TYPES;
  c.height = CELL_H;
  const ctx = c.getContext('2d')!;
  const rand = rng(7);

  const round = (ox: number, base: string, mid: string, light: string) => {
    const cx = ox + CELL_W / 2;
    ctx.fillStyle = '#4a3320';
    ctx.fillRect(cx - 4, 104, 8, CELL_H - 104 - 2);
    ctx.fillStyle = '#6b4a2c';
    ctx.fillRect(cx - 4, 104, 3, CELL_H - 104 - 2);
    const blob = (x: number, y: number, r: number, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // Dark body, then lit clusters toward the upper left, then leaf speckles.
    for (let i = 0; i < 9; i++) blob(cx + (rand() - 0.5) * 60, 66 + (rand() - 0.5) * 50, 20 + rand() * 12, base);
    for (let i = 0; i < 7; i++) blob(cx - 10 + (rand() - 0.6) * 44, 56 + (rand() - 0.6) * 38, 13 + rand() * 9, mid);
    for (let i = 0; i < 26; i++) blob(cx - 14 + (rand() - 0.6) * 46, 50 + (rand() - 0.6) * 44, 2 + rand() * 4, light);
  };

  const conifer = (ox: number, dark: string, lightCol: string) => {
    const cx = ox + CELL_W / 2;
    ctx.fillStyle = '#4a3320';
    ctx.fillRect(cx - 3, 140, 6, CELL_H - 142);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const baseY = 146 - i * 30;
      const apexY = baseY - 58;
      const half = 40 - i * 8;
      // Jagged lower edge running from the outer corner back to the trunk.
      const jag = (side: number) => {
        const pts: Array<[number, number]> = [];
        for (let k = 0; k <= 6; k++) pts.push([cx + side * half * (1 - k / 6), baseY + (k % 2 ? -5 : 0)]);
        return pts;
      };
      // Left (lit) half.
      ctx.fillStyle = lightCol;
      ctx.beginPath();
      ctx.moveTo(cx, apexY);
      ctx.lineTo(cx - half, baseY);
      for (const [x, y] of jag(-1)) ctx.lineTo(x, y);
      ctx.lineTo(cx, baseY);
      ctx.closePath();
      ctx.fill();
      // Right (shaded) half.
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(cx, apexY);
      ctx.lineTo(cx + half, baseY);
      for (const [x, y] of jag(1)) ctx.lineTo(x, y);
      ctx.lineTo(cx, baseY);
      ctx.closePath();
      ctx.fill();
    }
  };

  round(0, '#2d5a1f', '#437a2b', '#6b9f3f');
  round(CELL_W, '#27491b', '#3a6425', '#5b8a36');
  conifer(CELL_W * 2, '#173f1d', '#2b6429');
  conifer(CELL_W * 3, '#16392b', '#2a5a41');
  return c;
}

export interface Trees {
  group: THREE.Group;
  setAzimuth(azimuth: number): void;
  /** Hide trees whose base is inside any of these rings (flat local-meter arrays). */
  setHidden(test: (x: number, y: number) => boolean): void;
}

export function buildTrees(flatTrees: number[], fade: FadeUniforms, shadowMaterial: THREE.ShaderMaterial, sunOffset: THREE.Vector2): Trees {
  const all = new Float32Array(flatTrees);
  const count = all.length / 4;

  const atlas = new THREE.CanvasTexture(drawAtlas());
  atlas.anisotropy = 4;

  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = new THREE.InstancedBufferAttribute(all.slice(), 4);
  quad.setAttribute('aTree', inst);
  quad.instanceCount = count;

  const uRight = { value: new THREE.Vector2(1, 0) };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, uRight, uNight: NIGHT, ...fade },
    vertexShader: /* glsl */ `
      attribute vec4 aTree;
      uniform vec2 uRight;
      varying vec2 vUv;
      varying vec2 vWorld;
      void main() {
        float h = aTree.z * 1.12;
        float w = aTree.z * 0.8;
        vec3 wp = vec3(aTree.xy + uRight * position.x * w, position.y * h);
        vUv = vec2((uv.x + aTree.w) / ${TYPES.toFixed(1)}, uv.y);
        vWorld = aTree.xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying vec2 vWorld;
      ${NOISE_GLSL}
      ${FADE_GLSL}
      ${NIGHT_GLSL}
      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        if (c.a < 0.08) discard;
        c.rgb *= mix(0.72, 1.0, insideAmount(vWorld));
        c.rgb = nightly(c.rgb);
        gl_FragColor = c;
      }`,
    alphaToCoverage: true,
  });
  const sprites = new THREE.Mesh(quad, mat);
  sprites.frustumCulled = false;

  // Blob shadows: one quad per tree, cut to an ellipse in the fragment shader (2 triangles, not 12).
  const shadowGeo = new THREE.InstancedBufferGeometry();
  shadowGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  shadowGeo.setIndex([0, 1, 2, 0, 2, 3]);
  shadowGeo.setAttribute('aTree', inst);
  shadowGeo.instanceCount = count;
  const sMat = shadowMaterial.clone();
  sMat.uniforms = { ...sMat.uniforms, uSun: { value: sunOffset } };
  sMat.vertexShader = /* glsl */ `
    attribute vec4 aTree;
    uniform vec2 uSun;
    varying vec2 vLocal;
    void main() {
      vLocal = position.xy;
      float r = aTree.z * (aTree.w < 1.5 ? 0.3 : 0.2);
      vec2 dir = normalize(uSun);
      vec2 perp = vec2(-dir.y, dir.x);
      vec2 c = aTree.xy + uSun * aTree.z * 0.45;
      vec2 p = c + perp * position.x * r + dir * position.y * r * 1.5;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.05, 1.0);
    }`;
  sMat.fragmentShader = /* glsl */ `
    uniform float uOpacity;
    varying vec2 vLocal;
    void main() {
      if (dot(vLocal, vLocal) > 1.0) discard;
      gl_FragColor = vec4(0.04, 0.07, 0.02, uOpacity);
    }`;
  const shadows = new THREE.Mesh(shadowGeo, sMat);
  shadows.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'trees';
  group.add(shadows, sprites);

  return {
    group,
    setAzimuth(azimuth) {
      uRight.value.set(Math.sin(azimuth), -Math.cos(azimuth));
    },
    setHidden(test) {
      const arr = inst.array as Float32Array;
      let n = 0;
      for (let i = 0; i < count; i++) {
        const x = all[i * 4];
        const y = all[i * 4 + 1];
        if (test(x, y)) continue;
        arr.set(all.subarray(i * 4, i * 4 + 4), n * 4);
        n++;
      }
      inst.needsUpdate = true;
      quad.instanceCount = n;
      shadowGeo.instanceCount = n;
    },
  };
}
