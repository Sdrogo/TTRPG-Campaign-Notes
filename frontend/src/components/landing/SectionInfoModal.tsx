import { useState } from 'react';
import { Button, FileButton, Group, Image, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { LinkIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ImageUrlPopover } from '../ImageUrlPopover';
import { useSectionImage, useUpdateSection } from '../../hooks/useLanding';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/images';
import { sectionTitle } from '../../lib/landingText';
import { notifyError } from '../../lib/notify';
import type { LandingSection } from '../../types/landing';

/**
 * "Modifica info" (spec 55 Decision 12): only the card's own fields, the
 * title, the description and the image (upload, from a URL, remove: the
 * Room image's pipeline). The image is saved as soon as it is picked; the
 * text on "Salva". A page card's blank title goes back to its default name.
 */
export function SectionInfoModal({ roomId, section, onClose }: { roomId: string; section: LandingSection; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateSection(roomId);
  const image = useSectionImage(roomId, section.id);
  const [title, setTitle] = useState(section.title ?? '');
  const [description, setDescription] = useState(section.description);
  const [imageUrl, setImageUrl] = useState(section.imageUrl);
  const busy = image.upload.isPending || image.fromUrl.isPending || image.remove.isPending;
  const custom = section.kind === 'custom';
  const onImage = { onSuccess: (saved: LandingSection) => setImageUrl(saved.imageUrl), onError: notifyError };

  return (
    <Modal opened onClose={onClose} title={t('roomLanding.edit.info')} centered>
      <Stack gap="sm">
        <TextInput
          label={t('roomLanding.edit.titleLabel')}
          placeholder={custom ? undefined : sectionTitle({ kind: section.kind, title: null })}
          value={title}
          maxLength={100}
          required={custom}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Textarea
          label={t('common.description')}
          value={description}
          maxLength={2000}
          autosize
          minRows={2}
          maxRows={8}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {t('roomLanding.edit.image')}
          </Text>
          {imageUrl && <Image src={imageUrl} alt="" h={120} w="auto" fit="contain" radius="sm" />}
          <Group gap="xs" wrap="wrap">
            <FileButton onChange={(file) => file && image.upload.mutate(file, onImage)} accept={ACCEPTED_IMAGE_TYPES} disabled={busy}>
              {(props) => (
                <Button {...props} variant="light" size="xs" loading={image.upload.isPending} leftSection={<UploadSimpleIcon size={16} />}>
                  {t('setup.roomImage.upload')}
                </Button>
              )}
            </FileButton>
            <ImageUrlPopover onAddUrl={(url) => image.fromUrl.mutate(url, onImage)} position="bottom-start" submitLabel={t('account.avatar.useImage')}>
              {(toggle) => (
                <Button variant="subtle" size="xs" disabled={busy} loading={image.fromUrl.isPending} onClick={toggle} leftSection={<LinkIcon size={16} />}>
                  {t('account.avatar.fromUrl')}
                </Button>
              )}
            </ImageUrlPopover>
            {imageUrl && (
              <Button
                variant="subtle"
                color="danger"
                size="xs"
                disabled={busy}
                loading={image.remove.isPending}
                onClick={() => image.remove.mutate(undefined, onImage)}
                leftSection={<TrashIcon size={16} />}
              >
                {t('common.remove')}
              </Button>
            )}
          </Group>
        </Stack>
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={update.isPending}
            disabled={custom && !title.trim()}
            onClick={() => update.mutate({ id: section.id, title, description }, { onSuccess: onClose, onError: notifyError })}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
