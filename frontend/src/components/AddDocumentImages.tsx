import { useState } from 'react';
import { Button, FileButton, Group, Stack, Text, TextInput } from '@mantine/core';
import { LinkIcon, UploadSimpleIcon } from '@phosphor-icons/react';

// Mirrors the backend's accepted formats (app/domain/images.py). The backend
// re-validates the actual bytes and scales large images down, so this is
// only a convenience filter for the file picker.
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

interface AddDocumentImagesProps {
  onUploadFiles: (files: File[]) => void;
  uploading: boolean;
  onImportUrl: (url: string, onDone: () => void) => void;
  importing: boolean;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AddDocumentImages({
  onUploadFiles,
  uploading,
  onImportUrl,
  importing,
}: AddDocumentImagesProps) {
  const [url, setUrl] = useState('');
  const trimmedUrl = url.trim();
  const urlError = trimmedUrl && !isHttpUrl(trimmedUrl) ? 'Inserisci un URL http(s) valido' : null;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Aggiungi immagini
      </Text>
      <Group gap="xs" align="flex-start" wrap="wrap">
        <FileButton
          onChange={(files) => {
            if (files.length > 0) {
              onUploadFiles(files);
            }
          }}
          accept={ACCEPTED_TYPES}
          multiple
        >
          {(props) => (
            <Button
              {...props}
              variant="light"
              loading={uploading}
              leftSection={<UploadSimpleIcon size={16} />}
            >
              Dal computer
            </Button>
          )}
        </FileButton>
        <TextInput
          placeholder="https://… URL dell'immagine"
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
          Aggiungi da URL
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        PNG, JPEG, WebP o GIF. Le immagini grandi vengono ridimensionate automaticamente.
      </Text>
    </Stack>
  );
}
