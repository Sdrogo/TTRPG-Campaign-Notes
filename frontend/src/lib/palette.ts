import type { MapColor } from '../types/map';

/**
 * The map palettes (spec 78): the standard one and one per kind of color
 * blindness. Every palette has the same 17 color names, so a stored color
 * ('red') is the same color for everyone; only the shade drawn changes, and
 * each user sees the palette they picked on the Account page.
 */
export type ColorPalette = 'standard' | 'protan' | 'deutan' | 'tritan';

/** In the order the Account page offers them. */
export const COLOR_PALETTES: ColorPalette[] = ['standard', 'protan', 'deutan', 'tritan'];

/**
 * The shades. Standard keeps the colors the product owner chose (spec 28),
 * with midnight lightened to 3.9:1 on the board (it was 2.8:1). The others
 * were fitted so that, seen with that kind of color blindness, no two colors
 * are closer than ΔE00 ~12 (the standard one had pairs at 1.3-5), while
 * staying within ΔE00 12 of the standard shade so the name still fits.
 * `default` is the theme's text color in every palette.
 */
export const PALETTES: Record<ColorPalette, Record<MapColor, string>> = {
  standard: {
    default: 'var(--text-primary)',
    red: '#f75555',
    green: '#51cf66',
    purple: '#cc5de8',
    blue: '#339af0',
    gold: '#fcc419',
    orange: '#ff9500',
    midnight: '#5566c8',
    silver: '#b5b5ac',
    champagne: '#c1a470',
    rose: '#ee86a7',
    pink: '#e85298',
    cobalt: '#0079c2',
    violet: '#8f76d6',
    emerald: '#00ac9b',
    brown: '#9c5e31',
    lime: '#9acd32',
  },
  protan: {
    default: 'var(--text-primary)',
    red: '#dd204a',
    green: '#75ffa8',
    purple: '#c476b4',
    blue: '#25a8ff',
    gold: '#ffe741',
    orange: '#d87f35',
    midnight: '#7140c1',
    silver: '#a3967c',
    champagne: '#c6bd88',
    rose: '#ffa2d0',
    pink: '#f05880',
    cobalt: '#266b88',
    violet: '#9e51ff',
    emerald: '#30bdae',
    brown: '#ab540f',
    lime: '#afb530',
  },
  deutan: {
    default: 'var(--text-primary)',
    red: '#e9094f',
    green: '#51f8ad',
    purple: '#a073b3',
    blue: '#40b6ff',
    gold: '#ffe80f',
    orange: '#d37c03',
    midnight: '#6546df',
    silver: '#9bb9a9',
    champagne: '#b39f7d',
    rose: '#f3a2dd',
    pink: '#ff05a3',
    cobalt: '#2d6986',
    violet: '#8c66ff',
    emerald: '#0f9170',
    brown: '#815c3c',
    lime: '#92d661',
  },
  tritan: {
    default: 'var(--text-primary)',
    red: '#ff0007',
    green: '#44ff6e',
    purple: '#d31eff',
    blue: '#8bbdf3',
    gold: '#ffdd42',
    orange: '#f67f1a',
    midnight: '#684ab2',
    silver: '#92a0a5',
    champagne: '#aaab75',
    rose: '#ff9de1',
    pink: '#d01d8e',
    cobalt: '#246483',
    violet: '#9975c4',
    emerald: '#009688',
    brown: '#7f654d',
    lime: '#bfee0f',
  },
};

/** The CSS variable a map color is drawn with: `colorValue` returns it. */
export function paletteVariable(color: MapColor): string {
  return `--palette-${color}`;
}

const STORAGE_KEY = 'ttrpg.palette';

function isPalette(value: unknown): value is ColorPalette {
  return typeof value === 'string' && (COLOR_PALETTES as string[]).includes(value);
}

/** The API's value (null is standard) as a palette; an unknown one is standard. */
export function paletteFromApi(value: string | null | undefined): ColorPalette {
  return isPalette(value) ? value : 'standard';
}

/** The palette as the API stores it: null for standard. */
export function paletteToApi(palette: ColorPalette): string | null {
  return palette === 'standard' ? null : palette;
}

/**
 * The palette last used in this browser, so the first paint already has it
 * while the account loads (and for the demo, signed out). Standard when none.
 */
export function readStoredPalette(): ColorPalette {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPalette(stored) ? stored : 'standard';
  } catch {
    return 'standard';
  }
}

let current: ColorPalette | null = null;

/** The palette being drawn now. */
export function currentPalette(): ColorPalette {
  return current ?? 'standard';
}

/**
 * Draws every map color with `palette`'s shades: sets the `--palette-*`
 * variables on `<html>` (so nothing needs to re-render) and remembers the
 * choice in this browser.
 */
export function applyPalette(palette: ColorPalette): void {
  const root = document.documentElement;
  for (const [color, value] of Object.entries(PALETTES[palette])) {
    root.style.setProperty(paletteVariable(color as MapColor), value);
  }
  if (palette === 'standard') delete root.dataset.palette;
  else root.dataset.palette = palette;
  current = palette;
  try {
    if (palette === 'standard') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, palette);
  } catch {
    // Storage blocked: the choice still holds for this page.
  }
}
