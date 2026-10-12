import { CheckIcon, ColorSwatch, Group, Input, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAP_COLORS, colorValue } from '../../lib/maps';
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
  return (
    <Input.Wrapper label={t('maps.color')}>
      <Group gap="xs" mt={4} role="radiogroup" aria-label={t('maps.color')}>
        {MAP_COLORS.map((color) => (
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
    </Input.Wrapper>
  );
}
