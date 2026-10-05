import { Box, Group, Radio, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { PDF_STYLE_PREVIEW, PDF_STYLES, type PdfStyle } from '../../lib/pdfExport';

interface PdfStylePickerProps {
  value: PdfStyle;
  onChange: (style: PdfStyle) => void;
}

/** A miniature page in the colors of `style`: its cover band, an accent rule and lines of text. */
function Thumbnail({ style }: { style: PdfStyle }) {
  const colors = PDF_STYLE_PREVIEW[style];
  return (
    <Box
      aria-hidden="true"
      w={54}
      h={72}
      style={{
        background: colors.page,
        border: `1px solid ${colors.accent}`,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box h={30} style={{ background: colors.cover }} />
      <Box h={3} style={{ background: colors.accent }} />
      <Stack gap={4} p={5}>
        {[1, 2, 3].map((line) => (
          <Box key={line} h={2} style={{ background: colors.accent, opacity: 0.35 }} />
        ))}
      </Stack>
    </Box>
  );
}

/**
 * The PDF's style as cards with a miniature of each (spec 23b Frontend): Gothic
 * first, then Modern and Print. Each card is one radio of a group.
 */
export function PdfStylePicker({ value, onChange }: PdfStylePickerProps) {
  const { t } = useTranslation();
  return (
    <Radio.Group
      value={value}
      onChange={(next) => onChange(next as PdfStyle)}
      label={t('export.pdf.style')}
    >
      <Group gap="xs" mt="xs" wrap="nowrap" align="stretch">
        {PDF_STYLES.map((style) => (
          <Radio.Card key={style} value={style} radius="md" p="xs" style={{ flex: 1 }}>
            <Stack gap={4} align="center" ta="center">
              <Thumbnail style={style} />
              <Text size="sm" fw={500}>
                {t(`export.pdf.styles.${style}`)}
              </Text>
              <Text size="xs" c="dimmed">
                {t(`export.pdf.styleHints.${style}`)}
              </Text>
            </Stack>
          </Radio.Card>
        ))}
      </Group>
    </Radio.Group>
  );
}
