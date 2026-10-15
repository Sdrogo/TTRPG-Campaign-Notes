import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentCardNode } from '../../../components/maps/DocumentCardNode';
import { GroupNode } from '../../../components/maps/GroupNode';
import { MapArrow } from '../../../components/maps/MapArrow';
import { MapHandle } from '../../../components/maps/MapHandle';
import { TextCardNode } from '../../../components/maps/TextCardNode';
import type { MapArrow as Arrow, MapCard, MapGroup } from '../../../types/map';
import { flow } from '../../xyflowMock';
import { renderWithProviders } from '../../utils';
import { DocumentMentionsContext, type DocumentMentionsValue } from '../../../hooks/useDocumentMentions';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  ...(await import('../../xyflowMock')).xyflowMock,
}));

// The preview is replaced by a stand-in that shows whether it was told to stay shut.
vi.mock('../../../components/mentions/DocumentMentionPreview', () => ({
  DocumentMentionPreview: ({ disabled, children }: { disabled?: boolean; children: ReactNode }) => (
    <div data-testid="preview" data-disabled={String(Boolean(disabled))}>
      {children}
    </div>
  ),
}));

const documentCard: MapCard = {
  id: 'card-1',
  documentId: 'doc-1',
  text: null,
  groupId: null,
  caption: null,
  imageId: null,
  size: 'normal',
  masterOnly: false,
  color: 'red',
  struck: false,
  x: 0,
  y: 0,
  document: {
    id: 'doc-1',
    name: 'Hoshino Mirai',
    subtitle: 'La Idol',
    image: null,
    tagIds: [],
  },
};

const textCard: MapCard = {
  ...documentCard,
  id: 'card-2',
  documentId: null,
  text: 'Sire\nignoto',
  document: null,
};

const group: MapGroup = {
  id: 'group-1',
  title: 'Avversari e nemici',
  color: 'default',
  struck: true,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
};

// The node components only read these from React Flow's props.
function nodeProps<Props extends object>(id: string, data: unknown, selected = false) {
  return { id, data, selected } as unknown as Props;
}

beforeEach(() => {
  flow.reset();
});

const mentions: DocumentMentionsValue = {
  roomId: 'room-1',
  documents: [{ id: 'doc-1', roomId: 'room-1', name: 'Hoshino Mirai' } as DocumentMentionsValue['documents'][number]],
  tags: [],
  canCreateDocument: false,
  canCreateTag: false,
  create: vi.fn(),
};

function renderCardWithPreview() {
  return renderWithProviders(
    <DocumentMentionsContext value={mentions}>
      <DocumentCardNode
        {...nodeProps<ComponentProps<typeof DocumentCardNode>>('card-1', {
          card: documentCard,
          roomId: 'room-1',
          editable: false,
          onEdit: vi.fn(),
        })}
      />
    </DocumentMentionsContext>,
  );
}

describe('DocumentCardNode', () => {
  it('previews the Document on hover when no arrow is being drawn', () => {
    renderCardWithPreview();

    expect(screen.getByTestId('preview')).toHaveAttribute('data-disabled', 'false');
  });

  it('does not preview while an arrow is being drawn', () => {
    flow.connecting = true;
    renderCardWithPreview();

    expect(screen.getByTestId('preview')).toHaveAttribute('data-disabled', 'true');
  });

  it('shows the name linking to the Document and the subtitle as caption', () => {
    renderWithProviders(
      <DocumentCardNode {...nodeProps<ComponentProps<typeof DocumentCardNode>>('card-1', { card: documentCard, roomId: 'room-1', editable: false, onEdit: vi.fn() })} />,
    );
    expect(screen.getByRole('link', { name: 'Hoshino Mirai' })).toHaveAttribute('href', '/rooms/room-1/documents/doc-1');
    expect(screen.getByText('La Idol')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('prefers the map caption, shows the image, strikes and offers editing', async () => {
    const onEdit = vi.fn();
    const card = {
      ...documentCard,
      caption: 'Neonata',
      struck: true,
      document: {
        ...documentCard.document!,
        image: { id: 'i', url: 'http://img', isFavorite: true },
      },
    };
    const { container } = renderWithProviders(
      <DocumentCardNode {...nodeProps<ComponentProps<typeof DocumentCardNode>>('card-1', { card, roomId: 'room-1', editable: true, onEdit }, true)} />,
    );
    expect(screen.getByText('Neonata')).toBeInTheDocument();
    expect(screen.queryByText('La Idol')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', 'http://img');

    await userEvent.click(screen.getByRole('button', { name: 'Modifica la carta: Hoshino Mirai' }));
    expect(onEdit).toHaveBeenCalledWith('card-1');
  });

  it('fades the image into the card, and draws no fade without one', () => {
    const withImage = {
      ...documentCard,
      document: {
        ...documentCard.document!,
        image: { id: 'i', url: 'http://img', isFavorite: true },
      },
    };
    const { unmount } = renderWithProviders(
      <DocumentCardNode
        {...nodeProps<ComponentProps<typeof DocumentCardNode>>('card-1', {
          card: withImage,
          roomId: 'room-1',
          editable: false,
          onEdit: vi.fn(),
        })}
      />,
    );
    expect(screen.getByTestId('map-card-fade')).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <DocumentCardNode
        {...nodeProps<ComponentProps<typeof DocumentCardNode>>('card-1', {
          card: documentCard,
          roomId: 'room-1',
          editable: false,
          onEdit: vi.fn(),
        })}
      />,
    );
    expect(screen.queryByTestId('map-card-fade')).not.toBeInTheDocument();
  });

  it('shows no caption when there is neither a caption nor a subtitle', () => {
    const card = {
      ...documentCard,
      document: { ...documentCard.document!, subtitle: null },
    };
    renderWithProviders(
      <DocumentCardNode {...nodeProps<ComponentProps<typeof DocumentCardNode>>('card-1', { card, roomId: 'room-1', editable: false, onEdit: vi.fn() })} />,
    );
    expect(screen.getByText('Hoshino Mirai').parentElement?.children).toHaveLength(1);
  });
});

describe('TextCardNode', () => {
  it('shows the text, marks a Master-only card and offers editing', async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <TextCardNode
        {...nodeProps<ComponentProps<typeof TextCardNode>>(
          'card-2',
          {
            card: {
              ...textCard,
              masterOnly: true,
              struck: true,
              size: 'large',
            },
            editable: true,
            onEdit,
          },
          true,
        )}
      />,
    );
    expect(screen.getByText(/Sire/)).toBeInTheDocument();
    expect(screen.getByLabelText('Solo Master')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Modifica il testo' }));
    expect(onEdit).toHaveBeenCalledWith('card-2');
  });

  it('draws a title without a frame or edit button when read-only', () => {
    renderWithProviders(
      <TextCardNode {...nodeProps<ComponentProps<typeof TextCardNode>>('card-2', { card: { ...textCard, size: 'title' }, editable: false, onEdit: vi.fn() })} />,
    );
    expect(screen.queryByLabelText('Solo Master')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('GroupNode', () => {
  it('shows its title and, while editing, its resize and edit controls', async () => {
    const onEdit = vi.fn();
    const onResized = vi.fn();
    renderWithProviders(
      <GroupNode {...nodeProps<ComponentProps<typeof GroupNode>>('group-1', { group, editable: true, onEdit, onResized }, true)} />,
    );
    expect(screen.getByText('Avversari e nemici')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'resize' }));
    expect(onResized).toHaveBeenCalledWith('group-1', {
      x: 5,
      y: 6,
      width: 400,
      height: 300,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Modifica il gruppo' }));
    expect(onEdit).toHaveBeenCalledWith('group-1');
  });

  it('shows an untitled colored group without controls when read-only', () => {
    renderWithProviders(
      <GroupNode
        {...nodeProps<ComponentProps<typeof GroupNode>>('group-1', { group: { ...group, title: null, color: 'blue' }, editable: false, onEdit: vi.fn(), onResized: vi.fn() })}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Avversari e nemici')).not.toBeInTheDocument();
  });
});

describe('MapHandle', () => {
  it('turns the whole card into a drop target only while an arrow is drawn', () => {
    const { container, rerender } = renderWithProviders(<MapHandle visible />);
    expect(container.querySelectorAll('[data-handle]')).toHaveLength(2);
    flow.connecting = true;
    rerender(<MapHandle visible={false} />);
    expect(container.querySelector('[data-handle="target"]')).toBeInTheDocument();
  });

  it('keeps the arrow dot above the card image and text so it can be grabbed', () => {
    const { container } = renderWithProviders(<MapHandle visible />);
    expect(container.querySelector<HTMLElement>('[data-handle="source"]')?.style.zIndex).toBe('1');
  });
});

describe('MapArrow', () => {
  const arrow: Arrow = {
    id: 'arrow-1',
    from: { cardId: 'a', groupId: null },
    to: { cardId: 'b', groupId: null },
    direction: 'both',
    label: 'alleata',
    reverseLabel: 'alleato',
    labelPosition: null,
    reverseLabelPosition: null,
    labelOffset: null,
    reverseLabelOffset: null,
    color: 'green',
    masterOnly: true,
  };

  const edgeClick = vi.fn();

  beforeEach(() => edgeClick.mockClear());

  function renderArrow(
    value: Arrow | undefined,
    editable = true,
    onEdit = vi.fn(),
    onMoveLabel = vi.fn(),
  ) {
    flow.internal.b = {
      internals: { positionAbsolute: { x: 300, y: 0 } },
      measured: { width: 100, height: 50 },
    };
    const props = {
      id: 'arrow-1',
      source: 'a',
      target: 'b',
      data: value && { arrow: value, shift: 0, editable, onEdit, onMoveLabel },
    };
    // React Flow listens for clicks on the whole edge, and a label's click bubbles to it.
    renderWithProviders(
      <div onClick={edgeClick}>
        <MapArrow {...(props as unknown as ComponentProps<typeof MapArrow>)} />
      </div>,
    );
    return onEdit;
  }

  const labelButton = (name: string) => screen.getByRole('button', { name: `Modifica la relazione: ${name}` });

  it('draws a two-way arrow edge to edge with a label near each end', async () => {
    const onEdit = renderArrow(arrow);
    expect(screen.getByTestId('path-arrow-1')).toHaveAttribute('d', 'M 100,25 L 300,25');
    expect(screen.getByTestId('path-arrow-1')).toHaveAttribute('stroke-dasharray', '6 4');
    await userEvent.click(screen.getByRole('button', { name: 'Modifica la relazione: alleato' }));
    expect(onEdit).toHaveBeenCalledWith('arrow-1');
    expect(screen.getByText('alleata')).toBeInTheDocument();
  });

  it('slides a label along the arrow when it is dragged, without opening it', () => {
    const onEdit = vi.fn();
    const onMoveLabel = vi.fn();
    renderArrow({ ...arrow, direction: 'forward', reverseLabel: null }, true, onEdit, onMoveLabel);
    const button = labelButton('alleata');
    // The arrow runs from x=100 to x=300 on y=25: a drop at x=250 is 75% along it.
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 200, clientY: 25 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 250, clientY: 60 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 250, clientY: 60 });
    fireEvent.click(button);
    expect(onMoveLabel).toHaveBeenCalledWith('arrow-1', 'label', 0.75, 35);
    expect(onEdit).not.toHaveBeenCalled();
    expect(edgeClick).not.toHaveBeenCalled();
  });

  it('does not open a label after a drag even if the click comes late, and a cancelled drag moves nothing', () => {
    const onEdit = vi.fn();
    const onMoveLabel = vi.fn();
    renderArrow({ ...arrow, direction: 'forward', reverseLabel: null }, true, onEdit, onMoveLabel);
    const button = labelButton('alleata');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 200, clientY: 25 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 250, clientY: 60 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 250, clientY: 60 });
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        fireEvent.click(button);
        expect(onEdit).not.toHaveBeenCalled();
        fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 200, clientY: 25 });
        fireEvent.pointerMove(button, { pointerId: 1, clientX: 260, clientY: 60 });
        fireEvent.pointerCancel(button, { pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });
        expect(onMoveLabel).toHaveBeenCalledTimes(1);
        resolve();
      }, 10),
    );
  });

  it('ignores moves without a press and presses with another button', () => {
    const onEdit = vi.fn();
    const onMoveLabel = vi.fn();
    renderArrow({ ...arrow, direction: 'forward', reverseLabel: null }, true, onEdit, onMoveLabel);
    const button = labelButton('alleata');
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 250, clientY: 60 });
    fireEvent.pointerDown(button, { button: 2, pointerId: 1, clientX: 200, clientY: 25 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 250, clientY: 60 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    // A jitter of a pixel or two is still a click, not a drag.
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 200, clientY: 25 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 201, clientY: 26 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onMoveLabel).not.toHaveBeenCalled();
  });

  it('keeps a dragged label where it was dropped, and a press that does not move is a click', async () => {
    const onEdit = vi.fn();
    const onMoveLabel = vi.fn();
    renderArrow({ ...arrow, labelPosition: 0.9, labelOffset: -20 }, true, onEdit, onMoveLabel);
    const button = labelButton('alleata');
    // 90% along the arrow (x=280) and 20px to its left, which is up here.
    expect(button.style.transform).toContain('translate(280px, 5px)');
    await userEvent.click(button);
    expect(onEdit).toHaveBeenCalledWith('arrow-1');
    expect(onMoveLabel).not.toHaveBeenCalled();
  });

  it('keeps a label saved with a place but no distance on the arrow', () => {
    renderArrow({ ...arrow, labelPosition: 0.9, labelOffset: null });
    expect(labelButton('alleata').style.transform).toContain('translate(280px, 25px)');
  });

  it('puts a one-way label in the middle and none when there is none', () => {
    renderArrow({
      ...arrow,
      direction: 'forward',
      masterOnly: false,
      reverseLabel: null,
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('path-arrow-1')).not.toHaveAttribute('stroke-dasharray');
  });

  it('draws a two-way arrow without labels, and a read-only label is not a control', () => {
    renderArrow({ ...arrow, label: null, reverseLabel: null });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has a read-only label without a name', () => {
    renderArrow({ ...arrow, direction: 'none', reverseLabel: null }, false);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('draws nothing until both ends are measured, or without data', () => {
    flow.internal.a = null;
    renderArrow(arrow);
    expect(screen.queryByTestId('path-arrow-1')).not.toBeInTheDocument();
    flow.internal.a = {
      internals: { positionAbsolute: { x: 0, y: 0 } },
      measured: {},
    };
    renderArrow(undefined);
    expect(screen.queryByTestId('path-arrow-1')).not.toBeInTheDocument();
  });
});
