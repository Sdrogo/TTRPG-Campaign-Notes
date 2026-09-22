import { Button, FileButton, Group, Stack, Text } from '@mantine/core';
import { LinkIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { UserAvatar } from '../UserAvatar';
import { ImageUrlPopover } from '../ImageUrlPopover';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/images';
import type { UserIdentity } from '../../types/profile';

export type AvatarAction = 'upload' | 'import' | 'remove';

interface AvatarEditorProps {
  user: UserIdentity;
  onUpload: (file: File) => void;
  onImportUrl: (url: string) => void;
  onRemove: () => void;
  // The action in flight, if any: it shows a spinner, the others disable.
  pending: AvatarAction | null;
}

// The avatar with its controls: upload a file, import from a URL, or remove
// it. Each takes effect immediately - an avatar isn't part of the profile
// form's "save".
export function AvatarEditor({ user, onUpload, onImportUrl, onRemove, pending }: AvatarEditorProps) {
  const busy = pending !== null;

  return (
    <Group gap="lg" align="center" wrap="wrap">
      <UserAvatar user={user} size={112} />
      <Stack gap="xs" style={{ flex: 1, minWidth: 220 }}>
        <Group gap="xs" wrap="wrap">
          <FileButton
            onChange={(file) => file && onUpload(file)}
            accept={ACCEPTED_IMAGE_TYPES}
            disabled={busy}
          >
            {(props) => (
              <Button
                {...props}
                variant="light"
                size="xs"
                loading={pending === 'upload'}
                leftSection={<UploadSimpleIcon size={16} />}
              >
                Carica foto
              </Button>
            )}
          </FileButton>
          <ImageUrlPopover onAddUrl={onImportUrl} position="bottom-start" submitLabel="Usa immagine">
            {(toggle) => (
              <Button
                variant="subtle"
                size="xs"
                disabled={busy}
                loading={pending === 'import'}
                onClick={toggle}
                leftSection={<LinkIcon size={16} />}
              >
                Da URL
              </Button>
            )}
          </ImageUrlPopover>
          {user.avatarUrl && (
            <Button
              variant="subtle"
              color="red"
              size="xs"
              disabled={busy}
              loading={pending === 'remove'}
              onClick={onRemove}
              leftSection={<TrashIcon size={16} />}
            >
              Rimuovi
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          PNG, JPEG, WebP o GIF. L&apos;immagine viene ritagliata al centro e ridimensionata
          automaticamente.
        </Text>
      </Stack>
    </Group>
  );
}
