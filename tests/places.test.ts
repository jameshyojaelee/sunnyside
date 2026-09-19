import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatePlaces, type Place } from '../src/places.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/places.json', import.meta.url), 'utf8')) as Place[];
const real = JSON.parse(readFileSync(new URL('../src/data/places.json', import.meta.url), 'utf8')) as unknown;

describe('validatePlaces', () => {
  it('accepts the fixtures', () => {
    expect(validatePlaces(fixtures)).toEqual([]);
  });

  it('accepts the real places.json', () => {
    expect(validatePlaces(real)).toEqual([]);
  });

  const broken = (patch: Partial<Place> | ((p: Place) => void)) => {
    const p = structuredClone(fixtures[0]);
    if (typeof patch === 'function') patch(p);
    else Object.assign(p, patch);
    return validatePlaces([p]);
  };

  it.each([
    ['bad id', { id: 'Not A Slug' }, 'id'],
    ['missing name', { name: '  ' }, 'name'],
    ['unknown category', { category: 'pizza' as Place['category'] }, 'category'],
    ['bad date', { visited: '9/19/2026' }, 'visited'],
    ['bad link', { link: 'example.com' }, 'link'],
    ['bad photo path', { photos: ['../../etc/passwd'] }, 'photos'],
    ['height out of range', { height: 0 }, 'height'],
    ['facade index out of range', { facadeEdge: 99 }, 'facadeEdge'],
  ])('rejects %s', (_label, patch, field) => {
    const errs = broken(patch as Partial<Place>);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain(field);
  });

  it('rejects a clockwise footprint', () => {
    expect(broken((p) => p.footprint.reverse()).join()).toContain('counter-clockwise');
  });

  it('rejects a storefront far outside the building', () => {
    expect(broken((p) => (p.storefront = [p.storefront[0] + 0.001, p.storefront[1]])).join()).toContain('storefront');
  });

  it('rejects duplicate ids', () => {
    expect(validatePlaces([fixtures[0], fixtures[0]]).join()).toContain('duplicate');
  });
});

describe('validatePlaces: style and lot', () => {
  const base = () => structuredClone(fixtures[0]);
  it('accepts a fast-food place with a lot', () => {
    const p = base();
    const [lon, lat] = p.storefront;
    p.style = 'fast-food';
    p.lot = {
      paved: [
        [
          [lon, lat],
          [lon + 0.0002, lat],
          [lon, lat + 0.0002],
        ],
      ],
      driveThru: [
        [lon, lat],
        [lon + 0.0001, lat],
      ],
      poleSign: [lon + 0.0001, lat + 0.0001],
    };
    expect(validatePlaces([p])).toEqual([]);
  });
  it('rejects an unknown style and a malformed lot', () => {
    const p = base();
    (p as unknown as { style: string }).style = 'castle';
    p.lot = { driveThru: [[0, 0]] as Array<[number, number]> };
    const errs = validatePlaces([p]).join('\n');
    expect(errs).toContain('style');
    expect(errs).toContain('driveThru');
  });
});

describe('place color', () => {
  it('uses the place color when set, else the category color', async () => {
    const { placeColor } = await import('../src/places.ts');
    const { CATEGORIES } = await import('../src/data/categories.ts');
    expect(placeColor({ category: 'restaurant' })).toBe(CATEGORIES.restaurant.color);
    expect(placeColor({ category: 'restaurant', color: '#2f8a4f' })).toBe('#2f8a4f');
  });
  it('rejects a malformed color', () => {
    const p = structuredClone(fixtures[0]);
    p.color = 'green';
    expect(validatePlaces([p]).join()).toContain('color');
  });
});

describe('validatePlaces: facade', () => {
  it('accepts a full facade and rejects bad colors or a too-tall shop window', () => {
    const p = structuredClone(fixtures[0]);
    p.facade = {
      wall: '#e3e4e1',
      finish: 'smooth',
      shopGlass: 3.6,
      canopy: '#8b9096',
      band: { color: '#c62a45', text: 'MARKETPLACE', textColor: '#ffffff' },
      letters: { text: 'FRESH', color: '#2f9e44' },
      corner: { lines: ['OPEN', '24', 'HOURS'], color: '#ffffff', bg: '#16181b' },
    };
    expect(validatePlaces([p])).toEqual([]);
    p.facade = { wall: 'white', shopGlass: 99 };
    const errs = validatePlaces([p]).join('\n');
    expect(errs).toContain('colors');
    expect(errs).toContain('shopGlass');
  });
});
