import * as THREE from 'three';
import type { PlaceBuilding } from './buildings.ts';

const SIZE_PX = 16; // half-height of the heart on screen
const LIFT_PX = 30; // gap between roof and heart on screen
const COS_EL = Math.cos(Math.PI / 6);

/** Upright puffy heart, about 2 units tall and centered on the origin, facing -y. */
export function heartGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(new THREE.Vector2(x, y));
  }
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: 4,
    bevelEnabled: true,
    bevelThickness: 2.5,
    bevelSize: 1.6,
    bevelSegments: 4,
    curveSegments: 8,
  });
  geo.center();
  geo.scale(1 / 16, 1 / 16, 1 / 16); // the curve spans about 32 x 30 units
  geo.rotateX(Math.PI / 2); // stand it up: the shape's up becomes +z and its front faces -y
  geo.computeVertexNormals();
  return geo;
}

/** Bobbing red hearts above each place, turned toward the camera and kept a constant size on screen. */
export function buildMarkers(buildings: PlaceBuilding[]) {
  const geo = heartGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: '#ee4a5e', emissive: '#5e1020' });
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
    /** Call every frame with the current zoom (px per meter) and camera azimuth. */
    update(now: number, scale: number, azimuth: number) {
      const s = SIZE_PX / scale;
      for (const { m, b, phase } of items) {
        const bob = Math.sin(now / 450 + phase) * 3;
        m.scale.setScalar(s);
        m.position.set(b.centroid[0], b.centroid[1], b.height + (LIFT_PX + SIZE_PX + bob) / (scale * COS_EL));
        // Face the camera, with a gentle sway so it feels alive.
        m.rotation.z = azimuth - Math.PI / 2 + Math.sin(now / 900 + phase) * 0.35;
      }
    },
    /** Center of a building's heart (without the bob), for hit-testing taps. */
    center(b: PlaceBuilding, scale: number): THREE.Vector3 {
      return new THREE.Vector3(b.centroid[0], b.centroid[1], b.height + (LIFT_PX + SIZE_PX) / (scale * COS_EL));
    },
    /** World point just above the heart, for anchoring HTML labels. */
    labelAnchor(b: PlaceBuilding, scale: number): THREE.Vector3 {
      return new THREE.Vector3(b.centroid[0], b.centroid[1], b.height + (LIFT_PX + 2 * SIZE_PX + 6) / (scale * COS_EL));
    },
  };
}
