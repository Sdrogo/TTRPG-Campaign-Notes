import { useEffect, useRef, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { applyChanges, diffBoard, isUnchanged } from '../lib/boardChanges';
import type { BoardBody, BoardShape, ChangesSave } from '../types/boardChanges';

/** How long the board waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** Where the page's copy of a board stands with the server. */
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** A board the server sent, at the revision it was sent at. */
interface Known<B> {
  board: B;
  revision: number;
}

/** True while a finger or a mouse button is down anywhere on the page. */
function usePointerHeld() {
  const held = useRef(false);
  const [released, setReleased] = useState(0);
  useEffect(() => {
    const press = () => {
      held.current = true;
    };
    const release = () => {
      held.current = false;
      setReleased((count) => count + 1);
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);
  return { held, released };
}

/**
 * The page's own copy of a map's board (spec 43), saved `SAVE_DELAY_MS` after
 * the last change. A save sends only what changed since the board the copy is
 * based on (`diffBoard`), so it never touches what someone else did. Whenever
 * a newer board arrives, in a save's answer or from the stored map (refreshed
 * every few seconds, 43_2), the copy is rebased on it: the editor's own
 * unsaved changes laid over it (`applyChanges`). Rebasing waits while a
 * pointer is down, so nothing moves under a drag; a save sent meanwhile may
 * repeat changes already saved, which the server takes again harmlessly.
 */
export function useBoardAutosave<B extends BoardShape<B>, S extends { revision: number }>(
  stored: B,
  storedRevision: number,
  saver: UseMutationResult<S, Error, ChangesSave<B>>,
  toBody: (board: B) => BoardBody<B>,
  boardOf: (saved: S) => B,
) {
  const [value, setValue] = useState<B>(stored);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const drawn = useRef(stored);
  const base = useRef<Known<B>>({ board: stored, revision: storedRevision });
  const latest = useRef<Known<B>>(base.current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const pointer = usePointerHeld();
  useEffect(() => () => clearTimeout(timer.current), []);

  const draw = (next: B) => {
    drawn.current = next;
    setValue(next);
  };

  // Rebases the copy on the newest board known, unless a pointer is down.
  const sync = () => {
    if (pointer.held.current || latest.current.revision <= base.current.revision) return;
    const own = diffBoard(base.current.board, drawn.current, toBody);
    base.current = latest.current;
    draw(applyChanges(latest.current.board, own));
  };

  const learn = (board: B, revision: number) => {
    if (revision > latest.current.revision) latest.current = { board, revision };
    sync();
  };

  useEffect(() => {
    learn(stored, storedRevision);
    // `learn` reads refs only; it runs again when a pointer is released.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, storedRevision, pointer.released]);

  const save = () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    const changes = diffBoard(base.current.board, drawn.current, toBody);
    if (isUnchanged(changes)) {
      setSaveState('saved');
      return;
    }
    inFlight.current = true;
    setSaveState('saving');
    saver.mutate(
      { changes, baseRevision: latest.current.revision },
      {
        onSuccess: (saved) => {
          inFlight.current = false;
          learn(boardOf(saved), saved.revision);
          if (queued.current) {
            queued.current = false;
            save();
          } else {
            setSaveState(timer.current === undefined ? 'saved' : 'pending');
          }
        },
        onError: () => {
          inFlight.current = false;
          queued.current = false;
          setSaveState('error');
        },
      },
    );
  };

  const change = (next: B) => {
    draw(next);
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      save();
    }, SAVE_DELAY_MS);
  };

  return { value, saveState, change, retry: save, error: saver.error };
}
