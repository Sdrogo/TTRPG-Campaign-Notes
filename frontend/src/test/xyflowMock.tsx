// A stand-in for React Flow's components and hooks, for the map tests. jsdom
// lays nothing out, so the real canvas renders no node it can't measure and
// no gesture can be simulated. This one renders every node and edge through
// the board's own `nodeTypes` and `edgeTypes`, and keeps the props the board
// gave `ReactFlow`, so a test can call its handlers (a drag stop, a
// connection, a deletion) the way React Flow would.
//
// Use: vi.mock('@xyflow/react', async (original) => ({ ...(await original()), ...xyflowMock }))
import type { ComponentType, ReactNode } from 'react';

interface FakeNode {
  id: string;
  type: string;
  data: unknown;
  selected?: boolean;
  measured?: { width?: number; height?: number };
}

interface FakeEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  data: unknown;
  markerEnd?: unknown;
  markerStart?: unknown;
}

/** What the test controls and reads. */
export const flow = {
  /** The props the board last passed to `ReactFlow`. */
  props: {} as Record<string, unknown> & { nodes: FakeNode[]; edges: FakeEdge[] },
  /** What `useInternalNode` answers per node id; absent ids get a 100x50 box at the origin. */
  internal: {} as Record<string, unknown>,
  /** Measured sizes `useReactFlow().getNode` reports. */
  measured: {} as Record<string, { width?: number; height?: number }>,
  /** Whether an arrow is being drawn (`useConnection`). */
  connecting: false,
  reset() {
    this.props = { nodes: [], edges: [] };
    this.internal = {};
    this.measured = {};
    this.connecting = false;
  },
};

// eslint-disable-next-line react/only-export-components
function ReactFlow(props: {
  nodes: FakeNode[];
  edges: FakeEdge[];
  nodeTypes: Record<string, ComponentType<Record<string, unknown>>>;
  edgeTypes: Record<string, ComponentType<Record<string, unknown>>>;
  children?: ReactNode;
}) {
  // A test double: it hands the props to the test on purpose.
  // oxlint-disable-next-line react/immutability
  flow.props = props as typeof flow.props;
  return (
    <div data-testid="flow">
      {props.nodes.map((node) => {
        const Node = props.nodeTypes[node.type];
        return (
          <div key={node.id} data-testid={`node-${node.id}`}>
            <Node id={node.id} data={node.data} selected={Boolean(node.selected)} />
          </div>
        );
      })}
      {props.edges.map((edge) => {
        const Edge = props.edgeTypes[edge.type];
        return (
          <div key={edge.id} data-testid={`edge-${edge.id}`}>
            <Edge {...edge} />
          </div>
        );
      })}
      {props.children}
    </div>
  );
}

export const xyflowMock = {
  ReactFlow,
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Handle: ({ type }: { type: string }) => <div data-handle={type} />,
  NodeResizer: ({
    onResizeEnd,
  }: {
    onResizeEnd: (event: unknown, frame: { x: number; y: number; width: number; height: number }) => void;
  }) => (
    <button type="button" onClick={() => onResizeEnd(null, { x: 5, y: 6, width: 400, height: 300 })}>
      resize
    </button>
  ),
  BaseEdge: ({ id, path, style }: { id: string; path: string; style: { strokeDasharray?: string } }) => (
    <svg>
      <path data-testid={`path-${id}`} d={path} strokeDasharray={style.strokeDasharray} />
    </svg>
  ),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  useInternalNode: (id: string) =>
    id in flow.internal
      ? flow.internal[id]
      : { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 50 } },
  useConnection: (select: (connection: { inProgress: boolean }) => unknown) =>
    select({ inProgress: flow.connecting }),
  useReactFlow: () => ({
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    getNode: (id: string) => (id in flow.measured ? { measured: flow.measured[id] } : undefined),
  }),
};
