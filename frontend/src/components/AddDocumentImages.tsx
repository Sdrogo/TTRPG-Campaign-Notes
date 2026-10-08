import { useRef, useState } from 'react';
import { Button, FileButton, Group, Popover, Stack, Text, TextInput, Tooltip } from '@mantine/core';
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
 * An Owner's controls for adding images to a Document, as a compact row of the
 * info panel shaped like the PDFs' "File" row: upload files from the computer,
 * or import one from a URL in a popover. Unlike a Comment's images, these are
 * sent right away.
 */
export function AddDocumentImages({
  onUploadFiles,
  uploading,
  onImportUrl,
  importing,
}: AddDocumentImagesProps) {
  const { t } = useTranslation();
  const [urlOpened, setUrlOpened] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedUrl = url.trim();
  const urlError = trimmedUrl && !isHttpUrl(trimmedUrl) ? t('images.invalidUrl') : null;

  // The field is cleared (and the popover closed) by the callback, not on
  // click: it must survive a failed import so the user can retry.
  const submitUrl = () => {
    if (trimmedUrl && !urlError) {
      onImportUrl(trimmedUrl, () => {
        setUrl('');
        setUrlOpened(false);
      });
    }
  };

  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {t('images.rowTitle')}
      </Text>
      <Group gap={4} wrap="nowrap">
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
            <Tooltip label={t('images.resizeHint')} withArrow multiline w={260}>
              <Button
                {...props}
                variant="subtle"
                size="compact-xs"
                loading={uploading}
                leftSection={<UploadSimpleIcon size={12} />}
              >
                {t('images.upload')}
              </Button>
            </Tooltip>
          )}
        </FileButton>
        <Popover
          opened={urlOpened}
          onChange={setUrlOpened}
          position="bottom-end"
          withArrow
          shadow="md"
          // See ImageUrlPopover: `autoFocus` would scroll the page before the
          // dropdown is positioned.
          onOpen={() => requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))}
        >
          <Popover.Target>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<LinkIcon size={12} />}
              onClick={() => setUrlOpened((current) => !current)}
            >
              {t('images.fromUrlShort')}
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="xs" w={280}>
              <TextInput
                size="xs"
                aria-label={t('images.urlLabel')}
                placeholder={t('images.urlPlaceholder')}
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitUrl();
                  }
                }}
                error={urlError}
                ref={inputRef}
              />
              <Button
                size="xs"
                loading={importing}
                disabled={!trimmedUrl || urlError !== null}
                onClick={submitUrl}
              >
                {t('images.addFromUrl')}
              </Button>
            </Stack>
          </Popover.Dropdown>
        </Popover>
      </Group>
    </Group>
  );
}
