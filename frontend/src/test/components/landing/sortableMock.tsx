// A stand-in for `components/landing/Sortable` in the editors' tests: jsdom
// has no layout for dnd-kit to drag in, so each list gets a "Riordina" button
// that drops its items in reverse order, and the handles are plain buttons.
// Sortable itself is tested on its own (Sortable.test.tsx).
import type { CSSProperties, ReactNode } from 'react';

export function SortableList({ ids, onMove, children }: { ids: string[]; onMove: (ids: string[]) => void; children: ReactNode }) {
  return (
    <>
      {children}
      <button type="button" aria-label={`Riordina ${ids.join(',')}`} onClick={() => onMove([...ids].reverse())} />
    </>
  );
}

export function SortableItem({
  children,
}: {
  id: string;
  children: (props: { ref: (node: HTMLElement | null) => void; style: CSSProperties; dragging: boolean }) => ReactNode;
}) {
  return <>{children({ ref: () => {}, style: {}, dragging: false })}</>;
}

export function DragHandle({ label }: { label: string }) {
  return <button type="button" aria-label={label} />;
}
