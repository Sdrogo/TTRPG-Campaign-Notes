import { useState } from 'react';
import { ActionIcon, Box, Button, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import { TrashIcon } from '@phosphor-icons/react';
import { ImageViewerModal } from './ImageViewerModal';
import type { DocumentImage } from '../types/document';

// Grows with the viewport so the images use the wider card on large screens.
const GALLERY_HEIGHT = { base: 240, sm: 360, lg: 480 };

interface DocumentImageGalleryProps {
  images: DocumentImage[];
  documentName: string;
  canDelete: boolean;
  onDelete: (imageId: string) => void;
  deletingImageId: string | null;
}

export function DocumentImageGallery({
  images,
  documentName,
  canDelete,
  onDelete,
  deletingImageId,
}: DocumentImageGalleryProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  const renderSlide = (image: DocumentImage, index: number) => (
    <GalleryImage
      image={image}
      alt={`${documentName} (${index + 1})`}
      onOpen={() => setViewerIndex(index)}
      canDelete={canDelete}
      onDelete={() => onDelete(image.id)}
      deleting={deletingImageId === image.id}
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
}: {
  image: DocumentImage;
  alt: string;
  onOpen: () => void;
  canDelete: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
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
        aria-label="Apri immagine"
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
    </Box>
  );
}

function DeleteImageButton({ onConfirm, loading }: { onConfirm: () => void; loading: boolean }) {
  const [opened, setOpened] = useState(false);

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="default"
          color="red"
          loading={loading}
          onClick={() => setOpened((current) => !current)}
          aria-label="Elimina immagine"
        >
          <TrashIcon size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm">Eliminare questa immagine?</Text>
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setOpened(false)}>
              Annulla
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={() => {
                setOpened(false);
                onConfirm();
              }}
            >
              Elimina
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
