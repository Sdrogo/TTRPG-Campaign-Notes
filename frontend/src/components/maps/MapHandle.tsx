import { Handle, Position, useConnection } from '@xyflow/react';

/**
 * A card's or group's handles. Arrows are drawn by dragging from the small
 * dot at the right edge (Decision 9), which shows only while editing; while
 * an arrow is being drawn, the whole card becomes the place to drop it, so it
 * needn't land on a dot. Arrows are drawn edge to edge whatever side the dot
 * is on (`MapArrow`).
 */
export function MapHandle({ visible }: { visible: boolean }) {
  const drawing = useConnection((connection) => connection.inProgress);
  return (
    <>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          // Above the card's image and text, which are laid over it.
          zIndex: 1,
          width: 12,
          height: 12,
          background: 'var(--accent-primary)',
          border: '2px solid var(--bg-base)',
          visibility: visible ? undefined : 'hidden',
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          transform: 'none',
          borderRadius: 0,
          opacity: 0,
          zIndex: 1,
          pointerEvents: drawing ? 'all' : 'none',
        }}
      />
    </>
  );
}
