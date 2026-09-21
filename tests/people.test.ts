import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rng } from '../src/geo.ts';
import type { MapData } from '../src/mapdata.ts';
import { buildGraph, HOME, HOME_RADIUS, SPAWN_RADIUS, Walker } from '../src/render/people.ts';

const data = JSON.parse(readFileSync(new URL('../public/data/sunnyside.json', import.meta.url), 'utf8')) as MapData;
const graph = buildGraph(data);

const distHome = (x: number, y: number) => Math.hypot(x - HOME[0], y - HOME[1]);

describe('the sidewalk graph', () => {
  it('is one connected piece, so nowhere is a dead end you cannot leave', () => {
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const v = stack.pop()!;
      for (const e of graph.edges[v])
        if (!seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
    }
    expect(seen.size).toBe(graph.xy.length);
    expect(graph.xy.length).toBeGreaterThan(300);
  });

  it('has plenty of corners to turn at', () => {
    expect(graph.edges.filter((e) => e.length > 2).length).toBeGreaterThan(50);
  });
});

describe('where we walk', () => {
  it('starts near the middle of the neighborhood', () => {
    for (let trial = 0; trial < 20; trial++) {
      const w = new Walker(graph, rng(trial * 977 + 3));
      expect(graph.toHome[w.from]).toBeLessThan(SPAWN_RADIUS);
    }
  });

  it('heads home from wherever it starts, and turns corners on the way', () => {
    const everywhere = new Set<number>();
    for (let trial = 0; trial < 12; trial++) {
      const w = new Walker(graph, rng(trial * 31 + 7));
      const corners = new Set<number>();
      let closest = Infinity;
      // Ten minutes of walking at 1.25 m/s.
      for (let i = 0; i < 600; i++) {
        w.step(1);
        const p = w.at();
        closest = Math.min(closest, distHome(p.x, p.y));
        corners.add(w.from);
      }
      expect(closest).toBeLessThan(HOME_RADIUS);
      // Not pacing one block: every walk turns onto other streets.
      expect(corners.size).toBeGreaterThan(3);
      for (const c of corners) everywhere.add(c);
    }
    // And the walks differ from each other, rather than all tracing one loop.
    expect(everywhere.size).toBeGreaterThan(15);
  });

  it('never steps outside the neighborhood', () => {
    const w = new Walker(graph, rng(12345));
    for (let i = 0; i < 3000; i++) {
      w.step(1);
      const p = w.at();
      expect(graph.inside(p.x, p.y)).toBe(true);
    }
  });
});
