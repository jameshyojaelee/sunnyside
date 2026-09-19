import * as THREE from 'three';
import type { PlaceBuilding } from './buildings.ts';

const SIZE_PX = 16; // half-height of the diamond on screen
const LIFT_PX = 30; // gap between roof and diamond on screen
const COS_EL = Math.cos(Math.PI / 6);

/** Spinning, bobbing green diamonds above each place, kept a constant size on screen. */
export function buildMarkers(buildings: PlaceBuilding[]) {
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(0.6, 0.6, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#3fd957', emissive: '#135f22', flatShading: true });
  const group = new THREE.Group();
  group.name = 'markers';
  const items = buildings.map((b, i) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData.noPick = true;
    group.add(m);
    return { m, b, phase: i * 1.7 };
  });
  return {
    group,
    /** Call every frame with the current zoom (px per meter). */
    update(now: number, scale: number) {
      const s = SIZE_PX / scale;
      for (const { m, b, phase } of items) {
        const bob = Math.sin(now / 450 + phase) * 3;
        m.scale.setScalar(s);
        m.position.set(b.centroid[0], b.centroid[1], b.height + (LIFT_PX + SIZE_PX + bob) / (scale * COS_EL));
        m.rotation.z = now / 700 + phase;
      }
    },
    /** Center of a building's diamond (without the bob), for hit-testing taps. */
    center(b: PlaceBuilding, scale: number): THREE.Vector3 {
      return new THREE.Vector3(b.centroid[0], b.centroid[1], b.height + (LIFT_PX + SIZE_PX) / (scale * COS_EL));
    },
    /** World point just above the diamond, for anchoring HTML labels. */
    labelAnchor(b: PlaceBuilding, scale: number): THREE.Vector3 {
      return new THREE.Vector3(b.centroid[0], b.centroid[1], b.height + (LIFT_PX + 2 * SIZE_PX + 6) / (scale * COS_EL));
    },
  };
}
