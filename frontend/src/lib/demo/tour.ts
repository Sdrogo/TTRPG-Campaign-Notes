import { useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VIEW_AS_PARAM } from '../viewAs';
import { DEMO_DOCUMENTS_PATH, DEMO_START_PATH } from './demoMode';


// The Demo's guided tour (spec 45_3): which step is open, kept in
// `sessionStorage` beside the Demo flag, so it survives the full page loads
// the Demo makes (switching viewer) and ends with the tab.

const TOUR_KEY = 'exlibris.demo.tour';

/** The tour's steps by name: their texts are `tour.steps.<id>.title` / `.body`. */
export type TourStepId =
  | 'roomLanding'
  | 'sections'
  | 'sectionPage'
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
  | 'splitView'
  | 'linkNote'
  | 'geoMap'
  | 'sessionZero'
  | 'poll'
  | 'clocks'
  | 'versions'
  | 'alsoThere'
  | 'playerDocuments'
  | 'playerDocument'
  | 'playerMap'
  | 'end';

/** The tour's chapters (spec 64 Decision 8): the basics, more as the Master, and the Player's side. */
export type TourChapter = 'basics' | 'more' | 'player';

/** The chapters in order; their texts are `tour.chapters.<chapter>`. */
export const TOUR_CHAPTERS: readonly TourChapter[] = ['basics', 'more', 'player'];

/** One stop of the tour: the page it opens and the element it points at. */
export interface TourStep {
  /** Names its texts and its landing page link (`/demo?step=<id>`). */
  id: TourStepId;
  /** The chapter it belongs to; the last step has none. */
  chapter: TourChapter | null;
  /** The page the step is shown on, with its query when the page reads one. */
  path: string;
  /** The `data-tour` value of the element it points at; null for a card alone. */
  target: string | null;
  /** Seen as the Player Marco (spec 22b's preview), else as the Master. A Player step has no query of its own. */
  viewer?: 'player';
  /** Opens with a full page load: the page reads its query only when it mounts. */
  reload?: boolean;
}

const uidN = (n: number) => `d3e0c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** The Player the tour previews: Marco, who plays Jun (`demoData.ts`). */
const MARCO_ID = uidN(2);
const doc = (n: number) => `${DEMO_DOCUMENTS_PATH}/${uidN(n)}`;
const map = (n: number) => `/rooms/demo/maps/${uidN(n)}`;
const SESSION_ZERO = '/rooms/demo/session-zero';

/** The steps, in order (spec 45 Decision 16, extended by spec 64 Decision 8). */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'roomLanding', chapter: 'basics', path: DEMO_START_PATH, target: 'room-landing' },
  { id: 'sections', chapter: 'basics', path: DEMO_START_PATH, target: 'sections' },
  { id: 'sectionPage', chapter: 'basics', path: `/rooms/demo/sections/${uidN(641)}`, target: 'section-blocks' },
  { id: 'roomIndex', chapter: 'basics', path: DEMO_DOCUMENTS_PATH, target: 'room-index' },
  { id: 'documentCard', chapter: 'basics', path: DEMO_DOCUMENTS_PATH, target: 'document-card' },
  { id: 'document', chapter: 'basics', path: doc(201), target: 'document' },
  { id: 'documentText', chapter: 'basics', path: doc(201), target: 'document-text' },
  { id: 'mentionMap', chapter: 'basics', path: doc(201), target: 'mention-map' },
  { id: 'comments', chapter: 'basics', path: doc(209), target: 'comments' },
  { id: 'visibility', chapter: 'basics', path: doc(203), target: 'document-visibility' },
  { id: 'viewAs', chapter: 'basics', path: DEMO_DOCUMENTS_PATH, target: 'view-as' },
  { id: 'search', chapter: 'basics', path: DEMO_DOCUMENTS_PATH, target: 'search' },
  { id: 'freeMap', chapter: 'more', path: map(501), target: 'map' },
  { id: 'splitView', chapter: 'more', path: map(501), target: 'split-view' },
  { id: 'linkNote', chapter: 'more', path: doc(201), target: 'link-note' },
  { id: 'geoMap', chapter: 'more', path: map(502), target: 'map' },
  { id: 'sessionZero', chapter: 'more', path: `${SESSION_ZERO}?step=${uidN(712)}`, target: 'session-zero' },
  { id: 'poll', chapter: 'more', path: `${SESSION_ZERO}?step=${uidN(713)}`, target: 'poll', reload: true },
  { id: 'clocks', chapter: 'more', path: '/rooms/demo/clocks', target: 'clocks' },
  { id: 'versions', chapter: 'more', path: doc(201), target: 'versions' },
  { id: 'alsoThere', chapter: 'more', path: DEMO_START_PATH, target: null },
  { id: 'playerDocuments', chapter: 'player', path: DEMO_DOCUMENTS_PATH, target: 'document-card', viewer: 'player' },
  { id: 'playerDocument', chapter: 'player', path: doc(211), target: 'document', viewer: 'player' },
  { id: 'playerMap', chapter: 'player', path: map(501), target: 'map', viewer: 'player' },
  { id: 'end', chapter: null, path: DEMO_START_PATH, target: null },
];

/** The index of a chapter's first step. */
export function chapterStart(chapter: TourChapter): number {
  return TOUR_STEPS.findIndex((step) => step.chapter === chapter);
}

/** The address a step opens: its page, with the Player preview's parameter on a Player's step. */
export function stepUrl(step: TourStep): string {
  if (step.viewer !== 'player') return step.path;
  return `${step.path}?${VIEW_AS_PARAM}=${MARCO_ID}`;
}

/** A step's page without its query: what the router's pathname is compared with. */
export function stepPathname(step: TourStep): string {
  return step.path.split('?')[0];
}

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
 * Opens a step: its page in place, or with a full page load when the viewer
 * changes (an open page's queries stay bound to the preview's cache, the same
 * reason the banner's switch reloads) or the page reads its query only on
 * mount.
 */
export function useGoToTourStep(): (index: number) => void {
  const location = useLocation();
  const navigate = useNavigate();
  return (index: number) => {
    setTourStep(index);
    const step = TOUR_STEPS[index];
    const asPlayer = step.viewer === 'player';
    const url = stepUrl(step);
    const previewing = new URLSearchParams(location.search).has(VIEW_AS_PARAM);
    const query = step.path.split('?')[1];
    const here = location.pathname === stepPathname(step) && (!query || location.search.includes(query));
    if (previewing !== asPlayer || step.reload) window.location.assign(url);
    else if (!here) void navigate(url);
  };
}
