import { act } from '@testing-library/react';
import { useMutation } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_DELAY_MS, useBoardAutosave } from '../../hooks/useBoardAutosave';
import type { ChangesSave } from '../../types/boardChanges';
import { renderHookWithProviders } from '../utils';

interface Item {
  id: string;
  x: number;
}
interface Toy {
  items: Item[];
}
interface Saved {
  revision: number;
  items: Item[];
}

const body = (board: Toy) => ({ items: board.items.map((item) => ({ ...item })) });
const a = { id: 'a', x: 1 };
const b = { id: 'b', x: 2 };

let send: ReturnType<typeof vi.fn<(save: ChangesSave<Toy>) => Promise<Saved>>>;

/** What the page passes in: the stored board and its revision. */
let props: { stored: Toy; revision: number };

function setup(stored: Toy = { items: [a] }, revision = 1) {
  props = { stored, revision };
  const rendered = renderHookWithProviders(() =>
    useBoardAutosave<Toy, Saved>(
      props.stored,
      props.revision,
      useMutation({ mutationFn: (save: ChangesSave<Toy>) => send(save) }),
      body,
      (saved) => ({ items: saved.items }),
    ),
  );
  /** The stored board moves on (a refresh, spec 43_2). */
  const store = (next: Toy, nextRevision: number) => {
    props = { stored: next, revision: nextRevision };
    rendered.rerender();
  };
  return { ...rendered, store };
}

/** Lets the save delay pass and the save's answer land. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  send = vi.fn((save: ChangesSave<Toy>) =>
    Promise.resolve({ revision: save.baseRevision + 1, items: [a, ...save.changes.items.changed] }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBoardAutosave (spec 43)', () => {
  it('saves only what changed, then takes the answer', async () => {
    send.mockResolvedValueOnce({ revision: 2, items: [a, b, { id: 'z', x: 0 }] });
    const { result } = setup();
    act(() => result.current.change({ items: [a, b] }));
    expect(result.current.saveState).toBe('pending');
    await settle();

    expect(send).toHaveBeenCalledWith({
      changes: { items: { changed: [b], createdIds: ['b'], deletedIds: [] } },
      baseRevision: 1,
    });
    expect(result.current.saveState).toBe('saved');
    // Someone else's item, in the answer, is drawn too.
    expect(result.current.value.items.map((item) => item.id)).toEqual(['a', 'b', 'z']);
  });

  it('lays unsaved changes over a newer stored board, and ignores an older one', async () => {
    const { result, store } = setup();
    act(() => result.current.change({ items: [{ ...a, x: 5 }] }));
    store({ items: [a, b] }, 3);
    expect(result.current.value).toEqual({ items: [{ ...a, x: 5 }, b] });
    store({ items: [] }, 2);
    expect(result.current.value).toEqual({ items: [{ ...a, x: 5 }, b] });

    await settle();
    expect(send).toHaveBeenCalledWith({
      changes: { items: { changed: [{ ...a, x: 5 }], createdIds: [], deletedIds: [] } },
      baseRevision: 3,
    });
  });

  it('takes other content at the same revision, but not the same lists again', () => {
    const initial = { items: [a] };
    const { result, store } = setup(initial, 1);
    act(() => result.current.change({ items: [{ ...a, x: 5 }] }));
    // A mention map following the mentions: same revision, another card.
    const followed = { items: [a, b] };
    store(followed, 1);
    expect(result.current.value).toEqual({ items: [{ ...a, x: 5 }, b] });
    // Read again unchanged: the query keeps the same list, nothing moves.
    const drawn = result.current.value;
    store({ items: followed.items }, 1);
    expect(result.current.value).toBe(drawn);
  });

  it('waits for a released pointer before redrawing a newer board', () => {
    const { result, store } = setup();
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    store({ items: [a, b] }, 2);
    expect(result.current.value).toEqual({ items: [a] });
    act(() => {
      window.dispatchEvent(new Event('pointercancel'));
    });
    expect(result.current.value).toEqual({ items: [a, b] });
  });

  it('sends a change made during a save once the save answers', async () => {
    let answer: (saved: Saved) => void = () => {};
    send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { result } = setup();
    act(() => result.current.change({ items: [a, b] }));
    await settle();
    expect(result.current.saveState).toBe('saving');

    act(() => result.current.change({ items: [b] }));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ revision: 2, items: [a, b] });
    });
    await settle();
    expect(send).toHaveBeenLastCalledWith({
      changes: { items: { changed: [], createdIds: [], deletedIds: ['a'] } },
      baseRevision: 2,
    });
    expect(result.current.saveState).toBe('saved');
  });

  it('says it is still pending when a change waits after an answer', async () => {
    let answer: (saved: Saved) => void = () => {};
    send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { result } = setup();
    act(() => result.current.change({ items: [a, b] }));
    await settle();
    act(() => result.current.change({ items: [b] }));
    await act(async () => {
      answer({ revision: 2, items: [a, b] });
    });
    expect(result.current.saveState).toBe('pending');
  });

  it('reports a failed save, retries it, and has nothing to save when nothing changed', async () => {
    send.mockRejectedValueOnce(new Error('Troppe carte'));
    const { result } = setup();
    act(() => result.current.change({ items: [a, b] }));
    await settle();
    expect(result.current.saveState).toBe('error');

    await act(async () => {
      result.current.retry();
    });
    expect(result.current.saveState).toBe('saved');
    expect(send).toHaveBeenCalledTimes(2);

    act(() => result.current.change(result.current.value));
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe('saved');
  });
});
