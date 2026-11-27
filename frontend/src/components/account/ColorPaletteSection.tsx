import { Box, Group, Radio, SimpleGrid, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { AccountSection } from './AccountSection';
import { useUpdateColorPalette } from '../../hooks/useAccount';
import { MAP_COLORS } from '../../lib/maps';
import { notifyError } from '../../lib/notify';
import { COLOR_PALETTES, PALETTES, type ColorPalette } from '../../lib/palette';
import type { MapColor } from '../../types/map';

// The swatches leave out `default`, the text color, the same in every palette.
const SWATCHES: MapColor[] = MAP_COLORS.filter((color) => color !== 'default');

/**
 * "Colori delle mappe" on the Account page (spec 78): the palette this user
 * sees maps, legends, clocks and Session 0 in. Saved on the account and
 * drawn at once; the others in a Room keep their own palette, and a color
 * keeps its name in every palette.
 */
export function ColorPaletteSection({ value }: { value: ColorPalette }) {
  const { t } = useTranslation();
  const update = useUpdateColorPalette();
  // While saving, the card shows the pick (it is already drawn).
  const selected = update.isPending ? update.variables : value;

  return (
    <AccountSection
      title={t('account.palette.title')}
      description={t('account.palette.description')}
    >
      <Radio.Group
        value={selected}
        onChange={(next) => update.mutate(next as ColorPalette, { onError: notifyError })}
        aria-label={t('account.palette.title')}
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {COLOR_PALETTES.map((palette) => (
            <Radio.Card key={palette} value={palette} radius="md" p="sm" className="palette-card">
              <Stack gap={6}>
                <Group gap="xs" wrap="nowrap">
                  <Radio.Indicator />
                  <Stack gap={0}>
                    <Text size="sm" fw={600}>
                      {t(`account.palette.names.${palette}`)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t(`account.palette.hints.${palette}`)}
                    </Text>
                  </Stack>
                </Group>
                <Group gap={4} aria-hidden="true">
                  {SWATCHES.map((color) => (
                    <Box
                      key={color}
                      w={14}
                      h={14}
                      title={t(`maps.colors.${color}`)}
                      style={{ borderRadius: 3, background: PALETTES[palette][color] }}
                    />
                  ))}
                </Group>
              </Stack>
            </Radio.Card>
          ))}
        </SimpleGrid>
      </Radio.Group>
      <Text size="xs" c="dimmed">
        {t('account.palette.note')}
      </Text>
    </AccountSection>
  );
}
