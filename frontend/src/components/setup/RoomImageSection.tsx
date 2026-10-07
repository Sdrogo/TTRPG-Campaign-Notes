import { Button, FileButton, Group, Stack, Text, Title } from '@mantine/core';
import { LinkIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useImportRoomImage, useRemoveRoomImage, useUploadRoomImage } from '../../hooks/useRooms';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/images';
import { notifyError } from '../../lib/notify';
import { ImageUrlPopover } from '../ImageUrlPopover';
import { RoomImage } from '../RoomImage';

interface RoomImageSectionProps {
  roomId: string;
  imageUrl: string | null;
}

/**
 * The Room's image on the setup page (spec 26), for Administrators: upload a
 * file, import from a URL or remove it, each saved at once like the avatar.
 * It is the default cover of the Room PDF.
 */
export function RoomImageSection({ roomId, imageUrl }: RoomImageSectionProps) {
  const { t } = useTranslation();
  const upload = useUploadRoomImage(roomId);
  const importUrl = useImportRoomImage(roomId);
  const remove = useRemoveRoomImage(roomId);
  const busy = upload.isPending || importUrl.isPending || remove.isPending;

  return (
    <Stack gap="sm">
      <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
        {t('setup.roomImage.title')}
      </Title>
      <Text size="sm" c="dimmed">
        {t('setup.roomImage.description')}
      </Text>
      <Group gap="md" align="flex-end" wrap="nowrap">
        <RoomImage url={imageUrl} />
        <Stack gap="xs">
          <Group gap="xs" wrap="wrap">
            <FileButton
              onChange={(file) => file && upload.mutate(file, { onError: notifyError })}
              accept={ACCEPTED_IMAGE_TYPES}
              disabled={busy}
            >
              {(props) => (
                <Button
                  {...props}
                  variant="light"
                  size="xs"
                  loading={upload.isPending}
                  leftSection={<UploadSimpleIcon size={16} />}
                >
                  {t('setup.roomImage.upload')}
                </Button>
              )}
            </FileButton>
            <ImageUrlPopover
              onAddUrl={(url) => importUrl.mutate(url, { onError: notifyError })}
              position="bottom-start"
              submitLabel={t('account.avatar.useImage')}
            >
              {(toggle) => (
                <Button
                  variant="subtle"
                  size="xs"
                  disabled={busy}
                  loading={importUrl.isPending}
                  onClick={toggle}
                  leftSection={<LinkIcon size={16} />}
                >
                  {t('account.avatar.fromUrl')}
                </Button>
              )}
            </ImageUrlPopover>
            {imageUrl && (
              <Button
                variant="subtle"
                color="red"
                size="xs"
                disabled={busy}
                loading={remove.isPending}
                onClick={() => remove.mutate(undefined, { onError: notifyError })}
                leftSection={<TrashIcon size={16} />}
              >
                {t('common.remove')}
              </Button>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {t('setup.roomImage.hint')}
          </Text>
        </Stack>
      </Group>
    </Stack>
  );
}
