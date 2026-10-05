import { Checkbox, Select, SegmentedControl, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  coverChoices,
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
}

/**
 * The PDF options (spec 23b Frontend): style with previews, page size,
 * Comments and PDF Attachments (both off by default), and the Document whose
 * favorite image is the cover.
 */
export function PdfExportForm({ value, onChange, documents }: PdfExportFormProps) {
  const { t } = useTranslation();
  const covers = coverChoices(documents);
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
        value={value.coverDocumentId}
        onChange={(coverDocumentId) => onChange({ ...value, coverDocumentId })}
        clearable
        clearButtonProps={{ 'aria-label': t('export.pdf.coverClear') }}
        searchable
        nothingFoundMessage={t('export.pdf.coverNothing')}
      />
      <Text size="xs" c="dimmed">
        {t('export.pdf.coverHint')}
      </Text>
    </Stack>
  );
}
