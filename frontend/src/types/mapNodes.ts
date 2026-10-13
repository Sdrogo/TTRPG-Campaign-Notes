import type { Edge, Node } from '@xyflow/react';
import type { MapArrow, MapCard, MapGroup } from './map';

/** What every card and group node gets besides its own item. */
export type NodeActions = {
  /** Whether the board can be edited here (Decision 13: not on a phone). */
  editable: boolean;
  /** Opens the item's edit dialog. */
  onEdit: (id: string) => void;
};

export type DocumentCardNodeData = NodeActions & { card: MapCard; roomId: string };
export type TextCardNodeData = NodeActions & { card: MapCard };
export type GroupNodeData = NodeActions & {
  group: MapGroup;
  onResized: (id: string, frame: { x: number; y: number; width: number; height: number }) => void;
};
export type MapArrowData = {
  arrow: MapArrow;
  /** Pixels to the side of the straight line, for plain lines sharing both ends (see `parallelShift`). */
  shift: number;
  onEdit: (id: string) => void;
  /**
   * A label was dragged to a place along the arrow (0 at `from`, 1 at `to`)
   * and a distance to the side of it, in board pixels.
   */
  onMoveLabel: (id: string, which: 'label' | 'reverse', position: number, offset: number) => void;
  editable: boolean;
};

export type DocumentCardNodeType = Node<DocumentCardNodeData, 'documentCard'>;
export type TextCardNodeType = Node<TextCardNodeData, 'textCard'>;
export type GroupNodeType = Node<GroupNodeData, 'mapGroup'>;
export type MapNode = DocumentCardNodeType | TextCardNodeType | GroupNodeType;
export type MapEdge = Edge<MapArrowData, 'mapArrow'>;
