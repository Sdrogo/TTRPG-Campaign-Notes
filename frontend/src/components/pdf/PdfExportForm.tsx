import { Checkbox, Select, SegmentedControl, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  coverChoices,
  ROOM_COVER,
  PDF_PAGE_SIZES,
  type PdfExportOptions,
  type PdfPageSize,
} from '../../lib/pdfExport';
import type { Document } from '../../types/document';
import { PdfStylePicker } from './PdfStylePicker';

/** The choices of the form: every option but the Tag filter, which the dialog shares across formats. */
export type PdfFormValue = Omit<PdfExportOptions, 'tagIds'>;

interface PdfExportFormProps {
  value: PdfFormValue;
  onChange: (value: PdfFormValue) => void;
  /** The Documents the cover can come from; only those with an image are offered. */
  documents: Document[];
  /** Whether the Room has an image (spec 26): then it is offered first, and is the default. */
  hasRoomImage: boolean;
}

/**
 * The PDF options (spec 23b Frontend): style with previews, page size,
 * Comments and PDF Attachments (both off by default), and the cover: the
 * Room's image when it has one (spec 26, the default), the favorite image of a
 * Document, or none (the field cleared).
 */
export function PdfExportForm({ value, onChange, documents, hasRoomImage }: PdfExportFormProps) {
  const { t } = useTranslation();
  const covers = [
    ...(hasRoomImage ? [{ value: ROOM_COVER, label: t('export.pdf.coverRoom') }] : []),
    ...coverChoices(documents),
  ];
  const cover = value.coverDocumentId ?? (hasRoomImage && value.roomCover ? ROOM_COVER : null);
  return (
    <Stack gap="md">
      <PdfStylePicker value={value.style} onChange={(style) => onChange({ ...value, style })} />
      <SegmentedControl
        fullWidth
        aria-label={t('export.pdf.pageSize')}
        value={value.pageSize}
        onChange={(pageSize) => onChange({ ...value, pageSize: pageSize as PdfPageSize })}
        data={PDF_PAGE_SIZES.map((size) => ({ value: size, label: size }))}
      />
      <Checkbox
        label={t('export.pdf.comments')}
        checked={value.includeComments}
        onChange={(event) => onChange({ ...value, includeComments: event.currentTarget.checked })}
      />
      <Checkbox
        label={t('export.pdf.attachments')}
        checked={value.includeAttachments}
        onChange={(event) =>
          onChange({ ...value, includeAttachments: event.currentTarget.checked })
        }
      />
      <Select
        label={t('export.pdf.cover')}
        placeholder={t('export.pdf.coverNone')}
        data={covers}
        value={cover}
        onChange={(choice) =>
          onChange({
            ...value,
            coverDocumentId: choice === ROOM_COVER ? null : choice,
            // A Document the PDF can't show falls back to the Room's image.
            roomCover: choice !== null,
          })
        }
        clearable
        clearButtonProps={{ 'aria-label': t('export.pdf.coverClear') }}
        searchable
        nothingFoundMessage={t('export.pdf.coverNothing')}
      />
      <Text size="xs" c="dimmed">
        {t(hasRoomImage ? 'export.pdf.coverHintRoom' : 'export.pdf.coverHint')}
      </Text>
    </Stack>
  );
}
