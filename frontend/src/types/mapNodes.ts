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
export type MapArrowData = { arrow: MapArrow; onEdit: (id: string) => void; editable: boolean };

export type DocumentCardNodeType = Node<DocumentCardNodeData, 'documentCard'>;
export type TextCardNodeType = Node<TextCardNodeData, 'textCard'>;
export type GroupNodeType = Node<GroupNodeData, 'mapGroup'>;
export type MapNode = DocumentCardNodeType | TextCardNodeType | GroupNodeType;
export type MapEdge = Edge<MapArrowData, 'mapArrow'>;
