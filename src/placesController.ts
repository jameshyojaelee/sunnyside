import * as THREE from 'three';
import type { MapApp } from './app.ts';
import { applyToCamera } from './camera.ts';
import { CATEGORIES } from './data/categories.ts';
import type { Projection } from './geo.ts';
import type { Place } from './places.ts';
import type { Arch } from './render/arch.ts';
import { buildPlaceBuildings, nearAnyBuilding, type PlaceBuilding } from './render/buildings.ts';
import { buildMarkers } from './render/markers.ts';
import type { CardInfo, PlaceCard } from './ui/card.ts';

const MARKER_HIT_PX = 18;

export interface Landmark {
  id: string;
  name: string;
  description: string;
  link?: string;
  arch: Arch;
}

/** Anything on the map that can be hovered, labeled and opened in the card. */
interface Target {
  id: string;
  name: string;
  label: string;
  highlight(on: boolean): void;
  anchor(scale: number): THREE.Vector3;
  focus: THREE.Vector3;
  info(): CardInfo;
}

/** Owns the place buildings and landmarks: rendering, hover highlight + label, picking, and the card. */
export class PlacesController {
  buildings: PlaceBuilding[] = [];
  places: Place[] = [];
  onChange?: (places: Place[]) => void;

  private app: MapApp;
  private proj: Projection;
  private card: PlaceCard;
  private group: THREE.Group | null = null;
  private markers: ReturnType<typeof buildMarkers> | null = null;
  private landmarks: Landmark[] = [];
  private hovered: Target | null = null;
  private selected: Target | null = null;
  private label: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private tick = (now: number) => {
    this.markers?.update(this.reducedMotion ? 0 : now, this.app.view.scale, this.app.view.azimuth);
    this.placeLabel();
  };

  constructor(app: MapApp, proj: Projection, card: PlaceCard, ui: HTMLElement) {
    this.app = app;
    this.proj = proj;
    this.card = card;
    this.label = document.createElement('div');
    this.label.className = 'panel hover-label';
    this.label.hidden = true;
    ui.append(this.label);
    app.onViewChange(() => this.placeLabel());
  }

  setLandmarks(landmarks: Landmark[]) {
    this.landmarks = landmarks;
    for (const l of landmarks) this.app.scene.add(l.arch.group);
    this.hideTrees();
  }

  setPlaces(places: Place[]) {
    const selectedId = this.selected?.id;
    if (this.group) {
      this.app.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.app.removeTicker(this.tick);
    this.hovered = this.selected = null;

    this.places = places;
    const { group, buildings } = buildPlaceBuildings(places, {
      proj: this.proj,
      fade: this.app.fade,
      lotOrder: this.app.lotOrder,
      shadowMaterial: this.app.shadowMaterial,
      sunOffset: this.app.sunOffset,
      roads: this.app.data.roads.filter((r) => r.l === 0 && r.n),
    });
    this.buildings = buildings;
    this.group = group;
    this.markers = buildMarkers(buildings);
    group.add(this.markers.group);
    this.app.scene.add(group);
    this.hideTrees();
    this.app.addTicker(this.tick);

    const again = selectedId ? this.targetById(selectedId) : null;
    if (again) this.select(again, false);
    else if (this.card.isOpen) this.card.close();
    this.onChange?.(places);
    this.app.requestRender();
  }

  /** The place under a screen point, if any (Build mode uses this to edit). */
  placeAt(sx: number, sy: number): Place | null {
    const t = this.pickAt(sx, sy);
    return t ? (this.places.find((p) => p.id === t.id) ?? null) : null;
  }

  /** Select a place by id (from the places list). */
  selectPlace(id: string) {
    const t = this.targetById(id);
    if (t) this.select(t);
  }

  private hideTrees() {
    const nearBuilding = nearAnyBuilding(this.buildings, 2);
    const posts = this.landmarks.flatMap((l) => l.arch.posts);
    this.app.trees.setHidden((x, y) => nearBuilding(x, y) || posts.some(([px, py]) => Math.hypot(x - px, y - py) < 3));
  }

  private placeTarget(building: PlaceBuilding, place: Place): Target {
    return {
      id: place.id,
      name: place.name,
      label: CATEGORIES[place.category].label,
      highlight: (on) => building.setHighlight(on),
      anchor: (scale) => this.markers!.labelAnchor(building, scale),
      focus: new THREE.Vector3(building.centroid[0], building.centroid[1], building.height / 2),
      info: () => ({
        name: place.name,
        label: CATEGORIES[place.category].label,
        color: CATEGORIES[place.category].color,
        description: place.description,
        address: place.address,
        visited: place.visited,
        link: place.link,
        photos: place.photos,
        neighbors: building.places.filter((p) => p.id !== place.id).map((p) => ({ name: p.name, open: () => this.select(this.placeTarget(building, p), false) })),
      }),
    };
  }

  private landmarkTarget(l: Landmark): Target {
    return {
      id: l.id,
      name: l.name,
      label: 'Landmark',
      highlight: (on) => l.arch.setHighlight(on),
      anchor: () => l.arch.anchor,
      focus: l.arch.anchor.clone().setZ(4),
      info: () => ({ name: l.name, label: 'Landmark', color: '#3b8fd0', description: l.description, link: l.link }),
    };
  }

  private targetById(id: string): Target | null {
    for (const b of this.buildings) {
      const p = b.places.find((q) => q.id === id);
      if (p) return this.placeTarget(b, p);
    }
    const l = this.landmarks.find((q) => q.id === id);
    return l ? this.landmarkTarget(l) : null;
  }

  /** What is under a screen point: a heart first (easy to hit when zoomed out), then buildings and landmarks. */
  private pickAt(sx: number, sy: number): Target | null {
    const app = this.app;
    if (this.markers) {
      let best: PlaceBuilding | null = null;
      let bestD = MARKER_HIT_PX;
      for (const b of this.buildings) {
        const c = this.markers.center(b, app.view.scale);
        const [mx, my] = app.worldToScreen(c.x, c.y, c.z);
        const d = Math.hypot(mx - sx, my - sy);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best) return this.placeTarget(best, best.places[0]);
    }
    applyToCamera(app.camera, app.view, app.vp);
    this.raycaster.setFromCamera(new THREE.Vector2((sx / app.vp.width) * 2 - 1, 1 - (sy / app.vp.height) * 2), app.camera);
    const targets = [
      ...this.buildings.flatMap((b) => b.group.children.filter((c) => c instanceof THREE.Mesh && !c.userData.noPick)),
      ...this.landmarks.flatMap((l) => l.arch.group.children),
    ];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const landmark = this.landmarks.find((l) => l.arch.group === hit.object.parent);
    if (landmark) return this.landmarkTarget(landmark);
    const building = this.buildings.find((b) => b.group === hit.object.parent);
    if (!building) return null;
    // Shared building: the storefront nearest to where the ray hit.
    const nearest = building.storefronts.reduce((a, b) => (a.point.distanceTo(hit.point) <= b.point.distanceTo(hit.point) ? a : b));
    return this.placeTarget(building, nearest.place);
  }

  hover(sx: number, sy: number) {
    const hit = this.pickAt(sx, sy);
    if (hit?.id === this.hovered?.id) return;
    this.setHovered(hit);
  }

  clearHover() {
    this.setHovered(null);
  }

  private setHovered(t: Target | null) {
    if (this.hovered && this.hovered.id !== this.selected?.id) this.hovered.highlight(false);
    this.hovered = t;
    t?.highlight(true);
    this.app.renderer.domElement.classList.toggle('pointing', !!t);
    this.placeLabel();
    this.app.requestRender();
  }

  /** Returns true if the tap hit something. */
  tap(sx: number, sy: number): boolean {
    const hit = this.pickAt(sx, sy);
    if (hit) this.select(hit);
    else this.deselect();
    return !!hit;
  }

  private select(t: Target, glide = true) {
    if (this.selected && this.selected.id !== t.id) this.selected.highlight(false);
    // Re-assert the highlight of a shared building after switching between its places.
    this.selected = t;
    t.highlight(true);
    this.card.open(t.info());
    if (glide) this.glideTo(t.focus);
    this.placeLabel();
    this.app.requestRender();
  }

  deselect() {
    this.card.close();
  }

  /** Card closed (button, Escape, or deselect). */
  onCardClosed() {
    if (this.selected && this.selected.id !== this.hovered?.id) this.selected.highlight(false);
    if (this.hovered) this.hovered.highlight(true);
    this.selected = null;
    this.placeLabel();
    this.app.requestRender();
  }

  /** Glide so the target sits in the middle of the area the card leaves free. */
  private glideTo(p: THREE.Vector3) {
    const app = this.app;
    const cov = this.card.coverage();
    const scale = Math.max(app.view.scale, 4.5);
    const sx = (app.vp.width - cov.right) / 2;
    const sy = (app.vp.height - cov.bottom) / 2 + 30;
    app.animateTo({ ...app.targetFor(p.x, p.y, p.z, scale, sx, sy), scale }, 700);
  }

  private placeLabel() {
    const target = this.hovered ?? this.selected;
    if (!target) {
      this.label.hidden = true;
      return;
    }
    const a = target.anchor(this.app.view.scale);
    const [x, y] = this.app.worldToScreen(a.x, a.y, a.z);
    if (this.label.dataset.id !== target.id) {
      this.label.dataset.id = target.id;
      this.label.replaceChildren(document.createTextNode(target.name));
      const small = document.createElement('small');
      small.textContent = target.label;
      this.label.append(small);
    }
    this.label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    this.label.hidden = false;
  }
}
