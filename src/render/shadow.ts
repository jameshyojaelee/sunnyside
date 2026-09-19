import * as THREE from 'three';

/**
 * Translucent ground shadow. The stencil lets each pixel darken only once, so overlapping
 * shadows (tree blobs, building sweeps, the viaduct) never stack into darker patches.
 */
export function makeShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.3 } },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.xy, 0.05, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(0.04, 0.07, 0.02, uOpacity); }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
}
