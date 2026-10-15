import { Anchor, CheckIcon, ColorSwatch, Group, Input, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAP_COLORS, MAP_COLORS_VISIBLE, colorValue } from '../../lib/maps';
import type { MapColor } from '../../types/map';

/** Picks one of the map's theme colors (spec 28 Decision 8): no free picker. */
export function MapColorPicker({
  value,
  onChange,
}: {
  value: MapColor;
  onChange: (color: MapColor) => void;
}) {
  const { t } = useTranslation();
  // The row stays short; a color picked from the hidden part opens it.
  const [expanded, setExpanded] = useState(MAP_COLORS.indexOf(value) >= MAP_COLORS_VISIBLE);
  const colors = expanded ? MAP_COLORS : MAP_COLORS.slice(0, MAP_COLORS_VISIBLE);
  return (
    <Input.Wrapper label={t('maps.color')}>
      <Group gap="xs" mt={4} role="radiogroup" aria-label={t('maps.color')}>
        {colors.map((color) => (
          <UnstyledButton
            key={color}
            role="radio"
            aria-checked={value === color}
            aria-label={t(`maps.colors.${color}`)}
            onClick={() => onChange(color)}
          >
            <ColorSwatch color={colorValue(color)} size={24}>
              {value === color && <CheckIcon size={12} color="var(--bg-base)" />}
            </ColorSwatch>
          </UnstyledButton>
        ))}
      </Group>
      <Anchor component="button" type="button" size="xs" mt={4} onClick={() => setExpanded((e) => !e)}>
        {expanded ? t('maps.colorsLess') : t('maps.colorsMore')}
      </Anchor>
    </Input.Wrapper>
  );
}
