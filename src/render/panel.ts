import * as THREE from 'three';

/**
 * A vertical sign with a face on each side, each reading left-to-right for someone facing it.
 * `normal` is horizontal; the panel is centered on `center`.
 */
export function twoSidedPanel(center: THREE.Vector3, normal: THREE.Vector3, width: number, height: number, thickness: number, material: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const n0 = normal.clone().setZ(0).normalize();
  for (const n of [n0, n0.clone().negate()]) {
    const right = new THREE.Vector3().crossVectors(n.clone().negate(), new THREE.Vector3(0, 0, 1));
    const mid = center.clone().addScaledVector(n, thickness / 2);
    const hw = right.clone().multiplyScalar(width / 2);
    const hh = new THREE.Vector3(0, 0, height / 2);
    const bl = mid.clone().sub(hw).sub(hh);
    const br = mid.clone().add(hw).sub(hh);
    const tr = mid.clone().add(hw).add(hh);
    const tl = mid.clone().sub(hw).add(hh);
    for (const v of [bl, br, tr, bl, tr, tl]) pos.push(v.x, v.y, v.z);
    for (let k = 0; k < 6; k++) nrm.push(n.x, n.y, n.z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return new THREE.Mesh(g, material);
}

/** Thin box filling the gap between the two faces of a panel, so it has body at an angle. */
export function panelEdge(center: THREE.Vector3, normal: THREE.Vector3, width: number, height: number, thickness: number, material: THREE.Material): THREE.Mesh {
  const box = new THREE.Mesh(new THREE.BoxGeometry(width, thickness * 0.95, height * 0.98), material);
  box.position.copy(center);
  box.rotation.z = Math.atan2(normal.y, normal.x) - Math.PI / 2;
  return box;
}

/** Canvas texture helper for signs. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Largest bold font size (px) at which `text` fits in `maxWidth`. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number, weight = 900): number {
  let size = maxSize;
  for (; size > 10; size -= 2) {
    ctx.font = `${weight} ${size}px Nunito, system-ui, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}
