import * as THREE from 'three';

/** Sims-style dimetric view: 30 deg elevation makes a ground square project 2:1. */
export const ELEVATION = Math.PI / 6;
const SIN_EL = Math.sin(ELEVATION);
const COS_EL = Math.cos(ELEVATION);
const CAMERA_DISTANCE = 3000;

export interface ViewState {
  /** Ground point at the center of the screen (world meters). */
  tx: number;
  ty: number;
  /** Pixels per meter. */
  scale: number;
  /** Horizontal look direction, math angle in radians (0 = looking east, PI/2 = looking north). */
  azimuth: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Screen position (CSS px, origin top-left) of a world point. */
export function worldToScreen(v: ViewState, vp: Viewport, x: number, y: number, z = 0): [number, number] {
  const dx = Math.cos(v.azimuth);
  const dy = Math.sin(v.azimuth);
  const rx = x - v.tx;
  const ry = y - v.ty;
  const right = rx * dy - ry * dx;
  const up = SIN_EL * (rx * dx + ry * dy) + COS_EL * z;
  return [vp.width / 2 + right * v.scale, vp.height / 2 - up * v.scale];
}

/** Ground point (z = 0) under a screen position. Exact inverse of worldToScreen for z = 0. */
export function screenToGround(v: ViewState, vp: Viewport, sx: number, sy: number): [number, number] {
  const dx = Math.cos(v.azimuth);
  const dy = Math.sin(v.azimuth);
  const a = (sx - vp.width / 2) / v.scale;
  const b = (vp.height / 2 - sy) / v.scale / SIN_EL;
  // right vector = (dy, -dx), forward = (dx, dy)
  return [v.tx + a * dy + b * dx, v.ty - a * dx + b * dy];
}

/** Camera right vector on the ground plane (used by tree billboards). */
export function cameraRight(azimuth: number): [number, number] {
  return [Math.sin(azimuth), -Math.cos(azimuth)];
}

export function applyToCamera(cam: THREE.OrthographicCamera, v: ViewState, vp: Viewport): void {
  const dx = Math.cos(v.azimuth);
  const dy = Math.sin(v.azimuth);
  cam.up.set(0, 0, 1);
  cam.position.set(v.tx - dx * COS_EL * CAMERA_DISTANCE, v.ty - dy * COS_EL * CAMERA_DISTANCE, SIN_EL * CAMERA_DISTANCE);
  cam.lookAt(v.tx, v.ty, 0);
  const hw = vp.width / 2 / v.scale;
  const hh = vp.height / 2 / v.scale;
  cam.left = -hw;
  cam.right = hw;
  cam.top = hh;
  cam.bottom = -hh;
  cam.near = 10;
  cam.far = CAMERA_DISTANCE * 2;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

/** Smallest scale that shows the whole bounds, for "fit" / Home. */
export function fitScale(vp: Viewport, azimuth: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const probe: ViewState = { tx: cx, ty: cy, scale: 1, azimuth };
  let maxR = 0;
  let maxU = 0;
  for (const [x, y] of [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.maxY],
  ]) {
    const [sx, sy] = worldToScreen(probe, { width: 0, height: 0 }, x, y);
    maxR = Math.max(maxR, Math.abs(sx));
    maxU = Math.max(maxU, Math.abs(sy));
  }
  return Math.min(vp.width / 2 / maxR, vp.height / 2 / maxU);
}
