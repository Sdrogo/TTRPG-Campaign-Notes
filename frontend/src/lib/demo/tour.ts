import { useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VIEW_AS_PARAM } from '../viewAs';
import { DEMO_START_PATH } from './demoMode';

// The Demo's guided tour (spec 45_3): which step is open, kept in
// `sessionStorage` beside the Demo flag, so it survives the full page loads
// the Demo makes (switching viewer) and ends with the tab.

const TOUR_KEY = 'exlibris.demo.tour';

/** The tour's steps by name: their texts are `tour.steps.<id>.title` / `.body`. */
export type TourStepId =
  | 'room'
  | 'roomIndex'
  | 'documentCard'
  | 'document'
  | 'documentText'
  | 'mentionMap'
  | 'comments'
  | 'visibility'
  | 'viewAs'
  | 'search'
  | 'freeMap'
  | 'geoMap'
  | 'end';

/** One stop of the tour: the page it opens and the element it points at. */
export interface TourStep {
  /** Names its texts and its landing page link (`/demo?step=<id>`). */
  id: TourStepId;
  /** The page the step is shown on. */
  path: string;
  /** The `data-tour` value of the element it points at; null for a card alone. */
  target: string | null;
}

const doc = (n: number) => `${DEMO_START_PATH}/d3e0c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;
const map = (n: number) => `/rooms/demo/maps/d3e0c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The steps, in order (spec 45 Decision 16, as built). */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'room', path: DEMO_START_PATH, target: 'room' },
  { id: 'roomIndex', path: DEMO_START_PATH, target: 'room-index' },
  { id: 'documentCard', path: DEMO_START_PATH, target: 'document-card' },
  { id: 'document', path: doc(201), target: 'document' },
  { id: 'documentText', path: doc(201), target: 'document-text' },
  { id: 'mentionMap', path: doc(201), target: 'mention-map' },
  { id: 'comments', path: doc(209), target: 'comments' },
  { id: 'visibility', path: doc(203), target: 'document-visibility' },
  { id: 'viewAs', path: DEMO_START_PATH, target: 'view-as' },
  { id: 'search', path: DEMO_START_PATH, target: 'search' },
  { id: 'freeMap', path: map(501), target: 'map' },
  { id: 'geoMap', path: map(502), target: 'map' },
  { id: 'end', path: DEMO_START_PATH, target: null },
];

const listeners = new Set<() => void>();

/** The open step's index, or null when the tour is closed. Storage errors read as closed. */
export function tourStep(): number | null {
  try {
    const value = sessionStorage.getItem(TOUR_KEY);
    return value === null ? null : Math.min(Math.max(Number(value) || 0, 0), TOUR_STEPS.length - 1);
  } catch {
    return null;
  }
}

/** Opens the tour at a step, or closes it with null. */
export function setTourStep(step: number | null): void {
  try {
    if (step === null) sessionStorage.removeItem(TOUR_KEY);
    else sessionStorage.setItem(TOUR_KEY, String(step));
  } catch {
    // Blocked storage: the Demo itself cannot start then.
  }
  listeners.forEach((listener) => listener());
}

/** The index of a step by its id (a landing page link), or 0 for an unknown one. */
export function stepIndex(id: string | null): number {
  return Math.max(
    TOUR_STEPS.findIndex((step) => step.id === id),
    0,
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The open step's index, re-rendering when the tour moves. */
export function useTourStep(): number | null {
  return useSyncExternalStore(subscribe, tourStep);
}

/**
 * Opens a step: its page in place, or with a full page load when leaving a
 * Player's preview, since an open page's queries stay bound to the preview's
 * cache (the same reason the banner's switch reloads).
 */
export function useGoToTourStep(): (index: number) => void {
  const location = useLocation();
  const navigate = useNavigate();
  return (index: number) => {
    setTourStep(index);
    const { path } = TOUR_STEPS[index];
    if (new URLSearchParams(location.search).has(VIEW_AS_PARAM)) window.location.assign(path);
    else if (location.pathname !== path) void navigate(path);
  };
}
