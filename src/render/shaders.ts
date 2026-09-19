import * as THREE from 'three';

// Shared GLSL: cheap value noise, the Sims-style grass and forest colors, and the fade that turns
// everything outside the Sunnyside boundary into forest.
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec3 grassColor(vec2 p) {
  float big = fbm(p * 0.012);
  float mid = vnoise(p * 0.11);
  float fine = vnoise(p * 0.9);
  vec3 c = mix(vec3(0.290, 0.435, 0.157), vec3(0.420, 0.565, 0.212), smoothstep(0.25, 0.75, big));
  c = mix(c, vec3(0.470, 0.545, 0.250), smoothstep(0.62, 0.9, fbm(p * 0.03 + 17.0)) * 0.35);
  return c * (0.93 + 0.1 * mid + 0.05 * fine);
}
vec3 forestColor(vec2 p) {
  float blobs = fbm(p * 0.09);
  float fine = vnoise(p * 0.6);
  vec3 c = mix(vec3(0.090, 0.165, 0.075), vec3(0.180, 0.290, 0.120), smoothstep(0.3, 0.75, blobs));
  return c * (0.9 + 0.15 * fine);
}
`;

export const FADE_GLSL = /* glsl */ `
uniform sampler2D uMask;
uniform vec4 uBounds; // minX, minY, 1/width, 1/height
float insideAmount(vec2 p) {
  float m = texture2D(uMask, (p - uBounds.xy) * uBounds.zw).r;
  return smoothstep(0.04, 0.55, m);
}
`;

export interface FadeUniforms {
  uMask: { value: THREE.Texture };
  uBounds: { value: THREE.Vector4 };
}

export type GroundPattern = 'plain' | 'grain' | 'water' | 'pitch' | 'cemetery' | 'gravel';

const PATTERN_GLSL: Record<GroundPattern, string> = {
  plain: 'vec3 c = uColor;',
  grain: 'vec3 c = uColor * (0.94 + 0.08 * vnoise(vWorld * 1.3) + 0.04 * vnoise(vWorld * 0.2));',
  gravel: 'vec3 c = uColor * (0.86 + 0.2 * vnoise(vWorld * 2.1) + 0.06 * vnoise(vWorld * 0.15));',
  water: `vec3 c = uColor * (0.9 + 0.14 * fbm(vWorld * 0.05 + vec2(0.0, 3.0)));
    c += vec3(0.05, 0.06, 0.08) * smoothstep(0.72, 0.9, vnoise(vec2(vWorld.x * 0.08, vWorld.y * 0.5)));`,
  pitch: 'vec3 c = uColor * (mod(floor(vWorld.x / 6.0 + vWorld.y / 17.0), 2.0) < 1.0 ? 0.95 : 1.04);',
  cemetery: `vec3 c = grassColor(vWorld) * 1.03;
    vec2 cell = fract(vWorld / vec2(3.2, 2.4));
    float stone = step(cell.x, 0.22) * step(cell.y, 0.14) * step(0.35, hash12(floor(vWorld / vec2(3.2, 2.4))));
    c = mix(c, vec3(0.72, 0.72, 0.70), stone * 0.9);`,
};

/** Flat ground layer: colored, patterned, and faded to forest outside the boundary. */
export function groundMaterial(color: THREE.ColorRepresentation, pattern: GroundPattern, fade: FadeUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, ...fade },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vWorld;
      ${NOISE_GLSL}
      ${FADE_GLSL}
      void main() {
        ${PATTERN_GLSL[pattern]}
        gl_FragColor = vec4(mix(forestColor(vWorld), c, insideAmount(vWorld)), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

export function grassMaterial(fade: FadeUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fade },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vWorld;
      ${NOISE_GLSL}
      ${FADE_GLSL}
      void main() {
        gl_FragColor = vec4(mix(forestColor(vWorld), grassColor(vWorld), insideAmount(vWorld)), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}
