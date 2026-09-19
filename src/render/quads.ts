import * as THREE from 'three';

export const UNIT = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** A quad from four corners, pushed as two triangles with a shared normal and UVs. */
export function pushQuad(pos: number[], nrm: number[], uv: number[], c: THREE.Vector3[], n: THREE.Vector3, uvs: number[][]) {
  for (const k of [0, 1, 2, 0, 2, 3]) {
    pos.push(c[k].x, c[k].y, c[k].z);
    nrm.push(n.x, n.y, n.z);
    uv.push(uvs[k][0], uvs[k][1]);
  }
}

export function geometry(pos: number[], nrm: number[], uv: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
