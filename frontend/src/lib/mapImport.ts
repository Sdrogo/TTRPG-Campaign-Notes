import type { MapFormValues } from '../types/map';
import { toMapBody } from './maps';
import { exportFileName } from './roomExport';

/**
 * What importing a map file will create (spec 38_3, Decision 10): the map's
 * name and plane, how many areas, pins and links, how many are bound to a
 * Document, and the names from the file that will stay plain labels.
 */
export interface MapImportReport {
  name: string;
  description: string;
  planeWidth: number;
  planeHeight: number;
  areas: number;
  pins: number;
  links: number;
  matched: number;
  notFound: string[];
  ambiguous: string[];
  repeated: string[];
}

export interface RawMapImportReport {
  name: string;
  description: string;
  plane_width: number;
  plane_height: number;
  areas: number;
  pins: number;
  links: number;
  matched: number;
  not_found: string[];
  ambiguous: string[];
  repeated: string[];
}

export function toMapImportReport(raw: RawMapImportReport): MapImportReport {
  return {
    name: raw.name,
    description: raw.description,
    planeWidth: raw.plane_width,
    planeHeight: raw.plane_height,
    areas: raw.areas,
    pins: raw.pins,
    links: raw.links,
    matched: raw.matched,
    notFound: raw.not_found,
    ambiguous: raw.ambiguous,
    repeated: raw.repeated,
  };
}

/**
 * The map file's content as JSON, for the backend to check; null for a file
 * that isn't a JSON object, the one thing refused here.
 */
export async function readMapFile(file: File): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** The import request: the file, and the new map's own name, description and visibility. */
export function toImportBody(map: Record<string, unknown>, values: MapFormValues) {
  const { name, description, visibility, selective_user_ids } = toMapBody(values);
  return { map, name, description, visibility, selective_user_ids };
}

/** `<map>-<date>.json`, by the Room export's rule; `map` when the name has no ASCII letter. */
export function mapExportFileName(mapName: string, date: Date): string {
  return exportFileName(mapName, date, 'json', 'map');
}
