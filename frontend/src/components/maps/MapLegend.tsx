import { useState } from 'react';
import { ActionIcon, Box, Drawer, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { CaretDownIcon, CaretUpIcon, PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { colorValue, legendRows, storeLegendFolded, storedLegendFolded } from '../../lib/maps';
import type { GeoMapDetail } from '../../types/geoMap';
import type { ColorMeanings, LegendKind, MapColor, RelationshipMapDetail } from '../../types/map';

/** What a board needs to show a map's color legend (spec 68). */
export interface LegendSetup {
  mapId: string;
  /** What the colors mean now (the preset's when linked). */
  meanings: ColorMeanings;
  /** The linked preset's name, if any. */
  presetName: string | null;
  /** Opens the legend dialog; only for who edits the board. */
  onEdit?: () => void;
  /** A phone or a small board: only a chip, opening a drawer (Decisions 8, 16). */
  compact?: boolean;
}

interface MapLegendProps extends LegendSetup {
  /** The relations (or areas, spec 77b) the viewer sees: only their colors show (Decision 4). */
  colored: readonly { color: MapColor }[];
  /** `areas` on a geographic map: an area swatch per row and its own title (spec 77b Decisions 4, 8). */
  kind?: LegendKind;
  highlight: MapColor | null;
  onHighlight: (color: MapColor | null) => void;
}

/**
 * A short line in a relation's color, drawn like one (Decision 7), or for an
 * area (spec 77b Decision 4) a small filled square with the area's outline.
 * The color goes through `colorValue` and the fill is an opacity, so a
 * color-blind palette (ticket 78) recolors it too.
 */
export function LegendSample({
  color,
  width = 28,
  kind = 'relations',
}: {
  color: MapColor;
  width?: number;
  kind?: LegendKind;
}) {
  if (kind === 'areas') {
    return (
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden style={{ flex: 'none' }} data-testid="area-sample">
        <rect
          x={1.5}
          y={1.5}
          width={13}
          height={13}
          rx={2}
          fill={colorValue(color)}
          fillOpacity={0.35}
          stroke={colorValue(color)}
          strokeWidth={2}
        />
      </svg>
    );
  }
  return (
    <svg width={width} height={10} viewBox={`0 0 ${width} 10`} aria-hidden style={{ flex: 'none' }}>
      <path
        d={`M1 7 Q ${width / 2} 1 ${width - 1} 7`}
        fill="none"
        stroke={colorValue(color)}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The legend on a map's board (spec 68 Decisions 4, 7-9, 12, 16): a panel of
 * the colors in use with a meaning, foldable to a chip and remembered per map;
 * on a phone or a small board a chip opening a drawer. A row highlights its
 * color's relations. Nothing for a viewer when no row would show; for an
 * editor a chip opening the legend dialog.
 */
export function MapLegend({
  mapId,
  meanings,
  presetName,
  onEdit,
  compact = false,
  colored,
  kind = 'relations',
  highlight,
  onHighlight,
}: MapLegendProps) {
  const { t } = useTranslation();
  const rows = legendRows(meanings, colored);
  const areas = kind === 'areas';
  const title = areas ? t('maps.legend.areasTitle') : t('maps.legend.title');
  const chip = areas
    ? t('maps.legend.areasChip', { number: rows.length })
    : t('maps.legend.chip', { count: rows.length });
  const [folded, setFolded] = useState(() => storedLegendFolded(mapId));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fold = (value: boolean) => {
    setFolded(value);
    storeLegendFolded(mapId, value);
  };

  if (rows.length === 0) {
    if (!onEdit || compact) return null;
    return <Chip onClick={onEdit} label={title} icon={<PlusIcon size={14} />} />;
  }

  const list = (large: boolean) => (
    <Stack gap={2} role="list" aria-label={title}>
      {rows.map(([color, meaning]) => {
        const on = highlight === color;
        return (
          <UnstyledButton
            key={color}
            role="listitem"
            aria-pressed={on}
            title={`${t(`maps.colors.${color}`)}: ${meaning}`}
            aria-label={`${t(`maps.colors.${color}`)}: ${meaning}`}
            onClick={() => onHighlight(on ? null : color)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: large ? '10px 8px' : '4px 6px',
              minHeight: large ? 44 : undefined,
              borderRadius: 'var(--mantine-radius-sm)',
              background: on ? 'var(--mantine-color-dark-5)' : undefined,
              opacity: highlight && !on ? 0.45 : 1,
            }}
          >
            <LegendSample color={color} width={large ? 32 : 28} kind={kind} />
            <Text size={large ? 'md' : 'sm'} style={{ flex: 1 }}>
              {meaning}
            </Text>
            {large && (
              <Text size="xs" c="dimmed">
                {t(`maps.colors.${color}`)}
              </Text>
            )}
          </UnstyledButton>
        );
      })}
    </Stack>
  );
  const preset = presetName && (
    <Text size="xs" c="dimmed">
      {t('maps.legend.presetLine', { name: presetName })}
    </Text>
  );

  if (compact) {
    return (
      <>
        <Chip
          onClick={() => setDrawerOpen(true)}
          label={chip}
          icon={<Dots colors={rows.map(([color]) => color)} />}
        />
        <Drawer
          opened={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          position="bottom"
          size="auto"
          title={title}
        >
          <Stack gap="xs" pb="md">
            {preset}
            {list(true)}
            <Text size="xs" c="dimmed">
              {areas ? t('maps.legend.areasTapHint') : t('maps.legend.tapHint')}
            </Text>
          </Stack>
        </Drawer>
      </>
    );
  }

  if (folded) {
    return (
      <Chip
        onClick={() => fold(false)}
        label={chip}
        icon={<Dots colors={rows.map(([color]) => color)} />}
        trailing={<CaretUpIcon size={14} />}
      />
    );
  }

  return (
    <Paper
      withBorder
      shadow="md"
      p={0}
      w={250}
      aria-label={title}
      style={{ background: 'var(--bg-raised)' }}
    >
      <Group gap={4} px="sm" py={6} wrap="nowrap" style={{ borderBottom: '1px solid var(--border-default)' }}>
        <Text fw={600} size="sm" style={{ flex: 1 }}>
          {title}
        </Text>
        {onEdit && (
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('maps.legend.edit')} onClick={onEdit}>
            <PencilSimpleIcon size={16} />
          </ActionIcon>
        )}
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('maps.legend.fold')} onClick={() => fold(true)}>
          <CaretDownIcon size={16} />
        </ActionIcon>
      </Group>
      <Box px="xs" py={6} mah={240} style={{ overflowY: 'auto' }}>
        {presetName && (
          <Box px={6} pb={4}>
            {preset}
          </Box>
        )}
        {list(false)}
        {highlight && (
          <Text size="xs" c="dimmed" px={6} pt={4}>
            {areas ? t('maps.legend.areasHighlightHint') : t('maps.legend.highlightHint')}
          </Text>
        )}
      </Box>
    </Paper>
  );
}

function Dots({ colors }: { colors: MapColor[] }) {
  return (
    <Group gap={3} wrap="nowrap" aria-hidden>
      {colors.slice(0, 5).map((color) => (
        <Box key={color} w={8} h={8} style={{ borderRadius: '50%', background: colorValue(color) }} />
      ))}
    </Group>
  );
}

function Chip({
  onClick,
  label,
  icon,
  trailing,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 14px',
        minHeight: 36,
        borderRadius: 999,
        border: '1px solid var(--mantine-color-dark-4)',
        background: 'var(--bg-raised)',
        boxShadow: 'var(--mantine-shadow-md)',
        fontWeight: 600,
        fontSize: 'var(--mantine-font-size-sm)',
      }}
    >
      {icon}
      {label}
      {trailing}
    </UnstyledButton>
  );
}

/** What a map's detail gives its legend: its meanings and its preset's name. */
// oxlint-disable-next-line react/only-export-components
export function legendOf(
  map: RelationshipMapDetail | GeoMapDetail,
): Pick<LegendSetup, 'mapId' | 'meanings' | 'presetName'> {
  return { mapId: map.id, meanings: map.colorLegend, presetName: map.legendPreset?.name ?? null };
}
