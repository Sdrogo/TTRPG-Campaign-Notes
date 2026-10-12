import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentCardNode } from '../../../components/maps/DocumentCardNode';
import { GroupNode } from '../../../components/maps/GroupNode';
import { MapArrow } from '../../../components/maps/MapArrow';
import { MapHandle } from '../../../components/maps/MapHandle';
import { TextCardNode } from '../../../components/maps/TextCardNode';
import type { MapArrow as Arrow, MapCard, MapGroup } from '../../../types/map';
import { flow } from '../../xyflowMock';
import { renderWithProviders } from '../../utils';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  ...(await import('../../xyflowMock')).xyflowMock,
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

describe('DocumentCardNode', () => {
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
    color: 'green',
    masterOnly: true,
  };

  function renderArrow(value: Arrow | undefined, editable = true, onEdit = vi.fn()) {
    flow.internal.b = {
      internals: { positionAbsolute: { x: 300, y: 0 } },
      measured: { width: 100, height: 50 },
    };
    const props = {
      id: 'arrow-1',
      source: 'a',
      target: 'b',
      data: value && { arrow: value, editable, onEdit },
    };
    renderWithProviders(<MapArrow {...(props as unknown as ComponentProps<typeof MapArrow>)} />);
    return onEdit;
  }

  it('draws a two-way arrow edge to edge with a label near each end', async () => {
    const onEdit = renderArrow(arrow);
    expect(screen.getByTestId('path-arrow-1')).toHaveAttribute('d', 'M 100,25 L 300,25');
    expect(screen.getByTestId('path-arrow-1')).toHaveAttribute('stroke-dasharray', '6 4');
    await userEvent.click(screen.getByRole('button', { name: 'Modifica la freccia: alleato' }));
    expect(onEdit).toHaveBeenCalledWith('arrow-1');
    expect(screen.getByText('alleata')).toBeInTheDocument();
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
