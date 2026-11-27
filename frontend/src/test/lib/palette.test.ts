import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_COLORS } from '../../lib/maps';
import {
  applyPalette,
  COLOR_PALETTES,
  currentPalette,
  PALETTES,
  paletteFromApi,
  paletteToApi,
  readStoredPalette,
  type ColorPalette,
} from '../../lib/palette';
import type { MapColor } from '../../types/map';

afterEach(() => {
  applyPalette('standard');
  localStorage.clear();
});

// --- Color science for the checks below (sRGB -> CIELAB -> CIEDE2000) -----

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (c: number) => Math.min(1, Math.max(0, c));

/** Machado et al. 2009, severity 1.0, applied in linear RGB. */
const MACHADO: Record<'protan' | 'deutan' | 'tritan', number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulate(rgb: Rgb, kind: keyof typeof MACHADO): Rgb {
  const lin = rgb.map(linear);
  const m = MACHADO[kind];
  return m.map((row) => gamma(clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))) as Rgb;
}

function toLab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(linear);
  const xyz = [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883,
  ].map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

function deltaE2000([L1, a1, b1]: Rgb, [L2, a2, b2]: Rgb): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * rad) +
    0.24 * Math.cos(2 * hpm * rad) +
    0.32 * Math.cos((3 * hpm + 6) * rad) -
    0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const BOARD = hexToRgb('#0d0a0f'); // --bg-base
const COLORED: MapColor[] = MAP_COLORS.filter((color) => color !== 'default');

function closestPair(palette: ColorPalette, kind?: keyof typeof MACHADO): number {
  const labs = COLORED.map((color) => {
    const rgb = hexToRgb(PALETTES[palette][color]);
    return toLab(kind ? simulate(rgb, kind) : rgb);
  });
  let min = Infinity;
  for (let i = 0; i < labs.length; i++)
    for (let j = i + 1; j < labs.length; j++) min = Math.min(min, deltaE2000(labs[i], labs[j]));
  return min;
}

describe('currentPalette', () => {
  it('is standard before any palette is applied', () => {
    expect(currentPalette()).toBe('standard');
  });
});

describe('palettes (spec 78)', () => {
  it('give every palette all 17 colors, with the text color as default', () => {
    for (const palette of COLOR_PALETTES) {
      expect(Object.keys(PALETTES[palette]).sort()).toEqual([...MAP_COLORS].sort());
      expect(PALETTES[palette].default).toBe('var(--text-primary)');
      for (const color of COLORED) expect(PALETTES[palette][color]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keep every color at 3:1 or more on the board', () => {
    const board = luminance(BOARD);
    for (const palette of COLOR_PALETTES)
      for (const color of COLORED) {
        const contrast = (luminance(hexToRgb(PALETTES[palette][color])) + 0.05) / (board + 0.05);
        expect(contrast, `${palette} ${color}`).toBeGreaterThanOrEqual(2.95);
      }
  });

  it('keep each palette distinct for the vision it is made for, and for normal vision', () => {
    for (const kind of ['protan', 'deutan', 'tritan'] as const) {
      expect(closestPair(kind, kind), kind).toBeGreaterThan(10);
      expect(closestPair(kind), `${kind} normal`).toBeGreaterThan(10);
    }
    expect(closestPair('standard')).toBeGreaterThan(10);
  });
});

describe('applyPalette', () => {
  it('fills the palette variables on <html> and remembers the choice', () => {
    applyPalette('deutan');

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--palette-red')).toBe(PALETTES.deutan.red);
    expect(root.dataset.palette).toBe('deutan');
    expect(currentPalette()).toBe('deutan');
    expect(readStoredPalette()).toBe('deutan');

    applyPalette('standard');
    expect(root.style.getPropertyValue('--palette-red')).toBe(PALETTES.standard.red);
    expect(root.dataset.palette).toBeUndefined();
    expect(readStoredPalette()).toBe('standard');
  });

  it('still draws the palette when the browser blocks storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    applyPalette('protan');

    expect(currentPalette()).toBe('protan');
    expect(readStoredPalette()).toBe('standard');
    get.mockRestore();
    set.mockRestore();
  });

  it('reads an unknown stored or API value as standard', () => {
    localStorage.setItem('ttrpg.palette', 'sepia');
    expect(readStoredPalette()).toBe('standard');
    expect(paletteFromApi('sepia')).toBe('standard');
    expect(paletteFromApi(null)).toBe('standard');
    expect(paletteFromApi('tritan')).toBe('tritan');
    expect(paletteToApi('standard')).toBeNull();
    expect(paletteToApi('protan')).toBe('protan');
  });
});
