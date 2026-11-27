import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'ttrpg.glossaryHighlight';
const listeners = new Set<() => void>();

/** Whether this device highlights Glossary terms in texts (on unless switched off). */
function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Remembers the choice on this device and tells every reader. */
export function setGlossaryHighlight(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts only until the next reload.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** The per-user switch of Decision 12, read where texts are shown and on the Account page. */
export function useGlossaryHighlight(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
