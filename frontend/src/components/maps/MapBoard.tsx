import { useRef, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeMarker,
  type NodeChange,
  type OnBeforeDelete,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box, Button, Group, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { BoundingBoxIcon, FileTextIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_CARD_SIZE,
  absolutePosition,
  addArrow,
  parallelShift,
  addDocumentCards,
  addTextCard,
  cardImage,
  colorValue,
  dropCard,
  endId,
  endOf,
  groupCards,
  removeArrow,
  removeCards,
  removeGroup,
  updateArrow,
  updateCard,
  updateGroup,
  type Point,
} from '../../lib/maps';
import type { Document } from '../../types/document';
import type { Board, MapArrow as Arrow } from '../../types/map';
import type { MapEdge, MapNode } from '../../types/mapNodes';
import type { Tag } from '../../types/tag';
import { AddDocumentsPanel } from './AddDocumentsPanel';
import { ArrowDialog } from './ArrowDialog';
import { CardColorDialog } from './CardColorDialog';
import { CardDialog } from './CardDialog';
import { DocumentCardNode } from './DocumentCardNode';
import { GroupDialog } from './GroupDialog';
import { GroupNode } from './GroupNode';
import { MapArrow } from './MapArrow';
import { TextCardNode } from './TextCardNode';

// Defined once, outside any render: React Flow warns about new objects.
const NODE_TYPES = {
  documentCard: DocumentCardNode,
  textCard: TextCardNode,
  mapGroup: GroupNode,
};
const EDGE_TYPES = { mapArrow: MapArrow };

export interface MapBoardProps {
  roomId: string;
  board: Board;
  /** False on a phone, for a member who can't change the map, and in "View as". */
  editable: boolean;
  isMaster: boolean;
  /** The Room's Documents the viewer sees, for the picker. */
  documents: Document[];
  tags: Tag[];
  onChange: (board: Board) => void;
  /**
   * `mention`: a Document's mention map (spec 36 Decision 9), whose Documents
   * and relations come from the mentions: editing only moves and recolors
   * cards. `free` (the default): a spec 28 map.
   */
  mode?: 'free' | 'mention';
  /**
   * Given while the split pane follows the selected card (spec 37): clicking
   * a Document card selects it, even on a read-only board, and reports it.
   */
  onSelectDocument?: (documentId: string) => void;
  /** The board's height; the full page's by default. */
  height?: string | number;
}

type Editing =
  | { kind: 'card' | 'group' | 'arrow'; id: string }
  | { kind: 'newText' }
  | null;

/**
 * The board of a map (spec 28 Decision 9), on React Flow: pan and zoom for
 * everyone; while editing, drag cards and groups, draw an arrow by dragging
 * from a card's handle onto another, click an arrow to edit it, select cards
 * to frame them in a group, Delete to remove what is selected. Every change
 * goes out through `onChange` as the whole board.
 */
export function MapBoard(props: MapBoardProps) {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  );
}

function marker(arrow: Arrow): EdgeMarker {
  return {
    type: MarkerType.ArrowClosed,
    color: colorValue(arrow.color),
    width: 18,
    height: 18,
  };
}

function BoardCanvas({
  roomId,
  board,
  editable,
  isMaster,
  documents,
  tags,
  onChange,
  mode = 'free',
  onSelectDocument,
  height = 'calc(100dvh - 190px)',
}: MapBoardProps) {
  const { t } = useTranslation();
  const flow = useReactFlow<MapNode, MapEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [addOpened, setAddOpened] = useState(false);
  // A finger has no middle button or Space to pan with, so on touch a drag on
  // empty canvas keeps panning and there is no selection box.
  const touch = useMediaQuery('(pointer: coarse)');
  const free = mode === 'free';
  // What a mention map can't change: its cards and relations themselves.
  const shaping = editable && free;
  const boxSelect = shaping && !touch;

  const toNodes = (current: MapNode[]): MapNode[] => {
    const previous = new Map(current.map((node) => [node.id, node]));
    // What React Flow measured and which nodes are selected survive a rebuild.
    const kept = (id: string) => {
      const node = previous.get(id);
      return { selected: node?.selected, measured: node?.measured };
    };
    const onEdit = (kind: 'card' | 'group') => (id: string) => setEditing({ kind, id });
    const groupIds = new Set(board.groups.map((group) => group.id));
    return [
      // Parents first: React Flow needs a group before the cards inside it.
      ...board.groups.map(
        (group): MapNode => ({
          id: group.id,
          type: 'mapGroup',
          position: { x: group.x, y: group.y },
          width: group.width,
          height: group.height,
          zIndex: -1,
          draggable: editable,
          data: {
            group,
            editable,
            onEdit: onEdit('group'),
            onResized: (id, frame) => onChange(updateGroup(board, id, frame)),
          },
          ...kept(group.id),
        }),
      ),
      ...board.cards.map(
        (card): MapNode =>
          card.documentId
            ? {
                id: card.id,
                type: 'documentCard',
                position: { x: card.x, y: card.y },
                parentId: card.groupId && groupIds.has(card.groupId) ? card.groupId : undefined,
                draggable: editable,
                data: { card, roomId, editable, connectable: free, onEdit: onEdit('card'), onSelect: onSelectDocument },
                ...kept(card.id),
              }
            : {
                id: card.id,
                type: 'textCard',
                position: { x: card.x, y: card.y },
                parentId: card.groupId && groupIds.has(card.groupId) ? card.groupId : undefined,
                draggable: editable,
                data: { card, editable, onEdit: onEdit('card') },
                ...kept(card.id),
              },
      ),
    ];
  };

  const [nodes, setNodes] = useState<MapNode[]>(() => toNodes([]));
  // The board is the truth: the nodes are rebuilt, during render, whenever it
  // (or what the nodes show of it) changes.
  const [drawn, setDrawn] = useState({ board, editable, roomId });
  if (drawn.board !== board || drawn.editable !== editable || drawn.roomId !== roomId) {
    setDrawn({ board, editable, roomId });
    setNodes(toNodes(nodes));
  }

  const edges: MapEdge[] = board.arrows.map((arrow) => ({
    id: arrow.id,
    source: endId(arrow.from),
    target: endId(arrow.to),
    type: 'mapArrow',
    markerEnd: arrow.direction === 'none' ? undefined : marker(arrow),
    markerStart: arrow.direction === 'both' ? marker(arrow) : undefined,
    data: {
      arrow,
      shift: parallelShift(board.arrows, arrow),
      editable: shaping,
      onEdit: (id) => setEditing({ kind: 'arrow', id }),
      onMoveLabel: (id, which, position, offset) =>
        onChange(
          updateArrow(
            board,
            id,
            which === 'label'
              ? { labelPosition: position, labelOffset: offset }
              : { reverseLabelPosition: position, reverseLabelOffset: offset },
          ),
        ),
    },
  }));

  const viewCenter = (): Point => {
    const rect = wrapper.current!.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  const sizeOf = (id: string) => {
    const measured = flow.getNode(id)?.measured;
    return measured?.width && measured.height
      ? { width: measured.width, height: measured.height }
      : DEFAULT_CARD_SIZE;
  };

  const handleDragStop = (dragged: MapNode[]) => {
    let next = board;
    // Groups first, so a card dragged with its group lands in the moved frame.
    for (const node of dragged) {
      if (node.type === 'mapGroup') {
        next = updateGroup(next, node.id, {
          x: node.position.x,
          y: node.position.y,
        });
      }
    }
    for (const node of dragged) {
      if (node.type === 'mapGroup') continue;
      const card = next.cards.find((candidate) => candidate.id === node.id)!;
      const position = absolutePosition(next, { ...card, ...node.position });
      next = dropCard(next, node.id, position, sizeOf(node.id));
    }
    onChange(next);
  };

  const handleConnect = (connection: Connection) => {
    if (connection.source === connection.target) return;
    const [next, arrowId] = addArrow(board, endOf(board, connection.source), endOf(board, connection.target));
    onChange(next);
    setEditing({ kind: 'arrow', id: arrowId });
  };

  // Deleting a group with the keyboard removes the frame, not the cards in it
  // that weren't selected themselves, nor their arrows.
  const handleBeforeDelete: OnBeforeDelete<MapNode, MapEdge> = async ({ nodes: chosen, edges: touched }) => {
    const keptNodes = chosen.filter((node) => node.selected);
    const removed = new Set(keptNodes.map((node) => node.id));
    return {
      nodes: keptNodes,
      edges: touched.filter((edge) => edge.selected || removed.has(edge.source) || removed.has(edge.target)),
    };
  };

  const handleDelete = ({ nodes: gone, edges: goneEdges }: { nodes: MapNode[]; edges: MapEdge[] }) => {
    let next = board;
    for (const edge of goneEdges) next = removeArrow(next, edge.id);
    next = removeCards(next, gone.filter((node) => node.type !== 'mapGroup').map((node) => node.id));
    for (const node of gone) if (node.type === 'mapGroup') next = removeGroup(next, node.id);
    onChange(next);
  };

  const selectedCardIds = nodes
    .filter((node) => node.selected && node.type !== 'mapGroup')
    .map((node) => node.id);

  const handleGroup = () => {
    const sizes = Object.fromEntries(selectedCardIds.map((id) => [id, sizeOf(id)]));
    const [next, groupId] = groupCards(board, selectedCardIds, sizes);
    onChange(next);
    setEditing({ kind: 'group', id: groupId! });
  };

  const nameOf = (end: Arrow['from']) => {
    const card = board.cards.find((candidate) => candidate.id === end.cardId);
    if (card) return card.document?.name ?? card.text!;
    return board.groups.find((group) => group.id === end.groupId)?.title ?? t('maps.group.untitled');
  };

  const editedCard = editing?.kind === 'card' ? board.cards.find((c) => c.id === editing.id) : undefined;
  // The edited Document card's Document images, for its choice of image.
  const editedImages = documents.find((d) => d.id === editedCard?.documentId)?.images ?? [];
  const editedGroup = editing?.kind === 'group' ? board.groups.find((g) => g.id === editing.id) : undefined;
  const editedArrow = editing?.kind === 'arrow' ? board.arrows.find((a) => a.id === editing.id) : undefined;
  const close = () => setEditing(null);

  return (
    <Box
      ref={wrapper}
      h={height}
      mih={free ? 420 : undefined}
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--mantine-radius-lg)',
      }}
    >
      <ReactFlow<MapNode, MapEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={(changes: NodeChange<MapNode>[]) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onNodeDragStop={(_, __, dragged) => handleDragStop(dragged)}
        onSelectionDragStop={(_, dragged) => handleDragStop(dragged)}
        onConnect={handleConnect}
        onEdgeClick={(_, edge) => shaping && setEditing({ kind: 'arrow', id: edge.id })}
        onBeforeDelete={handleBeforeDelete}
        onDelete={handleDelete}
        nodesDraggable={editable}
        // With a mouse, dragging on empty space draws a selection box (any
        // card it touches is selected); the board is then moved with the
        // middle or right button, or with Space held.
        selectionOnDrag={boxSelect}
        selectionMode={SelectionMode.Partial}
        panOnDrag={boxSelect ? [1, 2] : true}
        nodesConnectable={shaping}
        elementsSelectable={editable || !!onSelectDocument}
        onNodeClick={(_, node) => {
          if (node.type === 'documentCard') node.data.onSelect?.(node.data.card.documentId!);
        }}
        deleteKeyCode={shaping ? ['Backspace', 'Delete'] : null}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        colorMode="dark"
        minZoom={0.2}
        fitView
      >
        <Background gap={24} color="var(--border-default)" />
        <Controls showInteractive={false} />
        {shaping && (
          <Panel position="top-left">
            <Group gap="xs">
              <Button size="xs" leftSection={<PlusIcon size={16} />} onClick={() => setAddOpened(true)}>
                {t('maps.addDocuments')}
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<FileTextIcon size={16} />}
                onClick={() => setEditing({ kind: 'newText' })}
              >
                {t('maps.addText')}
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<BoundingBoxIcon size={16} />}
                disabled={selectedCardIds.length === 0}
                onClick={handleGroup}
              >
                {t('maps.groupSelected')}
              </Button>
            </Group>
          </Panel>
        )}
        {boxSelect && (
          <Panel position="bottom-center">
            <Text size="xs" c="dimmed">
              {t('maps.selectHint')}
            </Text>
          </Panel>
        )}
      </ReactFlow>
      {shaping && (
        <AddDocumentsPanel
          opened={addOpened}
          onClose={() => setAddOpened(false)}
          documents={documents}
          tags={tags}
          onMapIds={new Set(board.cards.flatMap((card) => (card.documentId ? [card.documentId] : [])))}
          onAdd={(chosen) => onChange(addDocumentCards(board, chosen, viewCenter()))}
        />
      )}
      {editing?.kind === 'newText' && (
        <CardDialog
          isMaster={isMaster}
          onClose={close}
          onSave={(values) => {
            onChange(addTextCard(board, values, viewCenter())[0]);
            close();
          }}
        />
      )}
      {editedCard && !free && (
        <CardColorDialog
          key={editedCard.id}
          card={editedCard}
          onClose={close}
          onSave={(color) => {
            onChange(updateCard(board, editedCard.id, { color }));
            close();
          }}
        />
      )}
      {editedCard && free && (
        <CardDialog
          key={editedCard.id}
          card={editedCard}
          images={editedImages}
          isMaster={isMaster}
          onClose={close}
          onSave={({ text, caption, imageId, ...look }) => {
            onChange(
              updateCard(
                board,
                editedCard.id,
                editedCard.documentId
                  ? {
                      caption,
                      imageId,
                      document: {
                        ...editedCard.document!,
                        image: cardImage(editedImages, imageId) ?? editedCard.document!.image,
                      },
                      ...look,
                      size: 'normal',
                      masterOnly: false,
                    }
                  : { text, ...look },
              ),
            );
            close();
          }}
          onDelete={() => {
            onChange(removeCards(board, [editedCard.id]));
            close();
          }}
        />
      )}
      {editedGroup && (
        <GroupDialog
          key={editedGroup.id}
          group={editedGroup}
          onClose={close}
          onSave={(patch) => {
            onChange(updateGroup(board, editedGroup.id, patch));
            close();
          }}
          onDelete={() => {
            onChange(removeGroup(board, editedGroup.id));
            close();
          }}
        />
      )}
      {editedArrow && (
        <ArrowDialog
          key={editedArrow.id}
          arrow={editedArrow}
          fromName={nameOf(editedArrow.from)}
          toName={nameOf(editedArrow.to)}
          isMaster={isMaster}
          onClose={close}
          onSave={(patch) => {
            onChange(updateArrow(board, editedArrow.id, patch));
            close();
          }}
          onDelete={() => {
            onChange(removeArrow(board, editedArrow.id));
            close();
          }}
        />
      )}
    </Box>
  );
}
