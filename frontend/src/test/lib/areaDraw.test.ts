import { describe, expect, it } from 'vitest';
import { canClose, clickDraft, startDraft, undoCorner } from '../../lib/areaDraw';
import { MAX_AREA_POINTS } from '../../lib/geoMaps';
import type { Corner } from '../../types/geoMap';

describe('drawing an area (spec 38 Decision 9)', () => {
  it('adds a rounded corner per click', () => {
    let step = clickDraft(startDraft(), { x: 10.4, y: 10.6 }, 5);
    expect(step).toEqual({ draft: { corners: [[10, 11]] }, closed: null });
    step = clickDraft(step.draft!, { x: 100, y: 10 }, 5);
    expect(step.draft?.corners).toHaveLength(2);
  });

  it('closes on the first corner once the shape has three corners and a surface', () => {
    const triangle = { corners: [[0, 0], [100, 0], [50, 80]] as Corner[] };
    expect(canClose(triangle)).toBe(true);
    expect(clickDraft(triangle, { x: 3, y: 2 }, 5)).toEqual({ draft: null, closed: triangle.corners });
    // Two corners, or three in a line, can't close: the click adds a corner.
    const two = { corners: [[0, 0], [100, 0]] as Corner[] };
    expect(clickDraft(two, { x: 1, y: 1 }, 5).draft?.corners).toHaveLength(3);
    const line = { corners: [[0, 0], [50, 0], [100, 0]] as Corner[] };
    expect(canClose(line)).toBe(false);
    expect(clickDraft(line, { x: 0, y: 0 }, 5).closed).toBeNull();
  });

  it('adds no corner past the most an area takes', () => {
    const full = { corners: Array.from({ length: MAX_AREA_POINTS }, (_, i): Corner => [i * 10, (i % 2) * 10]) };
    const step = clickDraft(full, { x: 900, y: 900 }, 5);
    expect(step.draft).toBe(full);
  });

  it('takes back the last corner', () => {
    expect(undoCorner({ corners: [[0, 0], [1, 1]] })).toEqual({ corners: [[0, 0]] });
  });
});
