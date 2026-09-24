import { useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Popover,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import { HeartIcon, TrashIcon } from '@phosphor-icons/react';
import { ImageViewerModal } from './ImageViewerModal';
import type { DocumentImage } from '../types/document';
import { useTranslation } from 'react-i18next';

// Grows with the viewport so the images use the wider card on large screens.
const GALLERY_HEIGHT = { base: 240, sm: 360, lg: 480 };

interface DocumentImageGalleryProps {
  images: DocumentImage[];
  documentName: string;
  canDelete: boolean;
  onDelete: (imageId: string) => void;
  deletingImageId: string | null;
  /**
   * Spec 07: an Owner picks the image that leads the Document (and so its
   * card). Omitted for a viewer who may not - the heart is then not shown.
   */
  onSetFavorite?: (imageId: string) => void;
  settingFavoriteId?: string | null;
}

/**
 * A Document's images as a carousel, favorite first; clicking one opens the
 * fullscreen viewer. Deleting and choosing the favorite are shown only when the
 * caller allows them (Owners). Renders nothing without images.
 */
export function DocumentImageGallery({
  images,
  documentName,
  canDelete,
  onDelete,
  deletingImageId,
  onSetFavorite,
  settingFavoriteId = null,
}: DocumentImageGalleryProps) {
  const { t } = useTranslation();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  const renderSlide = (image: DocumentImage, index: number) => (
    <GalleryImage
      image={image}
      alt={t('images.numbered', { name: documentName, index: index + 1 })}
      onOpen={() => setViewerIndex(index)}
      canDelete={canDelete}
      onDelete={() => onDelete(image.id)}
      deleting={deletingImageId === image.id}
      onSetFavorite={onSetFavorite}
      settingFavorite={settingFavoriteId === image.id}
    />
  );

  return (
    <>
      {images.length === 1 ? (
        renderSlide(images[0], 0)
      ) : (
        <Box h={GALLERY_HEIGHT}>
          <Carousel
            height="100%"
            withIndicators
            emblaOptions={{ loop: true }}
            styles={{ indicator: { width: 12, height: 4 } }}
          >
            {images.map((image, index) => (
              <Carousel.Slide key={image.id}>{renderSlide(image, index)}</Carousel.Slide>
            ))}
          </Carousel>
        </Box>
      )}

      <ImageViewerModal
        images={images}
        index={viewerIndex !== null && viewerIndex < images.length ? viewerIndex : null}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
        alt={documentName}
      />
    </>
  );
}

function GalleryImage({
  image,
  alt,
  onOpen,
  canDelete,
  onDelete,
  deleting,
  onSetFavorite,
  settingFavorite,
}: {
  image: DocumentImage;
  alt: string;
  onOpen: () => void;
  canDelete: boolean;
  onDelete: () => void;
  deleting: boolean;
  onSetFavorite?: (imageId: string) => void;
  settingFavorite: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box
      pos="relative"
      h={GALLERY_HEIGHT}
      bg="var(--bg-base)"
      style={{ borderRadius: 'var(--mantine-radius-md)', overflow: 'hidden' }}
    >
      <UnstyledButton
        onClick={onOpen}
        w="100%"
        h="100%"
        aria-label={t('images.open')}
        style={{ cursor: 'zoom-in' }}
      >
        <img
          src={image.url}
          alt={alt}
          loading="lazy"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </UnstyledButton>

      {canDelete && (
        <Box pos="absolute" top={8} right={8}>
          <DeleteImageButton onConfirm={onDelete} loading={deleting} />
        </Box>
      )}

      {onSetFavorite && (
        <Box pos="absolute" bottom={8} right={8}>
          <FavoriteButton
            isFavorite={image.isFavorite}
            loading={settingFavorite}
            onClick={() => onSetFavorite(image.id)}
          />
        </Box>
      )}
    </Box>
  );
}

function FavoriteButton({
  isFavorite,
  loading,
  onClick,
}: {
  isFavorite: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  // No confirmation: unlike deleting, picking a different favorite is
  // undone by picking the old one again.
  return (
    <Tooltip label={isFavorite ? t('images.favorite') : t('images.setFavorite')}>
      <ActionIcon
        variant="default"
        loading={loading}
        onClick={onClick}
        disabled={isFavorite}
        aria-label={t('images.setFavorite')}
        aria-pressed={isFavorite}
      >
        <HeartIcon
          size={16}
          weight={isFavorite ? 'fill' : 'regular'}
          color={isFavorite ? 'var(--accent-primary)' : undefined}
        />
      </ActionIcon>
    </Tooltip>
  );
}

function DeleteImageButton({ onConfirm, loading }: { onConfirm: () => void; loading: boolean }) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="default"
          color="red"
          loading={loading}
          onClick={() => setOpened((current) => !current)}
          aria-label={t('images.delete')}
        >
          <TrashIcon size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm">{t('images.deleteConfirm')}</Text>
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setOpened(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={() => {
                setOpened(false);
                onConfirm();
              }}
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
