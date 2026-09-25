import { useState } from 'react';
import { Button, FileButton, Group, Stack, Text, TextInput } from '@mantine/core';
import { LinkIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { ACCEPTED_IMAGE_TYPES, isHttpUrl } from '../lib/images';
import { useTranslation } from 'react-i18next';

interface AddDocumentImagesProps {
  onUploadFiles: (files: File[]) => void;
  uploading: boolean;
  onImportUrl: (url: string, onDone: () => void) => void;
  importing: boolean;
}

/**
 * An Owner's controls for adding images to a Document: upload files from the
 * computer, or import one from a URL. Unlike a Comment's images, these are sent
 * right away.
 */
export function AddDocumentImages({
  onUploadFiles,
  uploading,
  onImportUrl,
  importing,
}: AddDocumentImagesProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const trimmedUrl = url.trim();
  const urlError = trimmedUrl && !isHttpUrl(trimmedUrl) ? t('images.invalidUrl') : null;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        {t('images.addTitle')}
      </Text>
      <Group gap="xs" align="flex-start" wrap="wrap">
        <FileButton
          onChange={(files) => {
            if (files.length > 0) {
              onUploadFiles(files);
            }
          }}
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
        >
          {(props) => (
            <Button
              {...props}
              variant="light"
              loading={uploading}
              leftSection={<UploadSimpleIcon size={16} />}
            >
              {t('images.fromComputer')}
            </Button>
          )}
        </FileButton>
        <TextInput
          placeholder={t('images.urlPlaceholder')}
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          error={urlError}
          leftSection={<LinkIcon size={16} />}
          style={{ flex: 1, minWidth: 220 }}
        />
        <Button
          variant="light"
          loading={importing}
          disabled={!trimmedUrl || urlError !== null}
          onClick={() => onImportUrl(trimmedUrl, () => setUrl(''))}
        >
          {t('images.addFromUrl')}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {t('images.resizeHint')}
      </Text>
    </Stack>
  );
}
