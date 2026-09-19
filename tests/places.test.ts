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
