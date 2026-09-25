import { useState } from 'react';
import { ActionIcon, Box, Group, Modal, Text, Tooltip } from '@mantine/core';
import {
  ArrowsInIcon,
  CaretLeftIcon,
  CaretRightIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from '@phosphor-icons/react';
import type { DocumentImage } from '../types/document';
import { useTranslation } from 'react-i18next';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

interface ImageViewerModalProps {
  images: DocumentImage[];
  /** Index of the open image, or null when the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  alt: string;
}

/**
 * Fullscreen viewer for a set of images, with zoom and previous/next
 * navigation. Open while `index` is set.
 */
export function ImageViewerModal({
  images,
  index,
  onIndexChange,
  onClose,
  alt,
}: ImageViewerModalProps) {
  const image = index !== null ? images[index] : undefined;

  return (
    <Modal
      opened={image !== undefined}
      onClose={onClose}
      fullScreen
      padding="md"
      title={
        images.length > 1 && index !== null ? (
          <Text size="sm" c="dimmed">
            {index + 1} / {images.length}
          </Text>
        ) : undefined
      }
      styles={{ body: { height: 'calc(100svh - 72px)' } }}
    >
      {image && index !== null && (
        // Keyed by image so zoom resets whenever the viewed image changes.
        <ZoomableImage
          key={image.id}
          image={image}
          alt={alt}
          onPrevious={
            images.length > 1
              ? () => onIndexChange((index - 1 + images.length) % images.length)
              : undefined
          }
          onNext={images.length > 1 ? () => onIndexChange((index + 1) % images.length) : undefined}
        />
      )}
    </Modal>
  );
}

function ZoomableImage({
  image,
  alt,
  onPrevious,
  onNext,
}: {
  image: DocumentImage;
  alt: string;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(MIN_ZOOM);
  // Size the image renders at when fitted to the viewport (zoom 1). Zooming
  // scales from this, so the scroll container can pan over the enlarged image.
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  const zoomed = zoom > MIN_ZOOM && fitSize !== null;

  return (
    <Box pos="relative" h="100%">
      <Box
        h="100%"
        style={{
          overflow: 'auto',
          display: 'flex',
          // `safe` keeps the top-left edge reachable when the zoomed image overflows.
          alignItems: 'safe center',
          justifyContent: 'safe center',
        }}
      >
        <img
          src={image.url}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const { clientWidth, clientHeight } = event.currentTarget;
            setFitSize({ width: clientWidth, height: clientHeight });
          }}
          onDoubleClick={() => setZoom((current) => (current > MIN_ZOOM ? MIN_ZOOM : 2))}
          style={
            zoomed
              ? {
                  width: fitSize.width * zoom,
                  height: fitSize.height * zoom,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  cursor: 'zoom-out',
                }
              : {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  cursor: 'zoom-in',
                }
          }
        />
      </Box>

      {onPrevious && (
        <ActionIcon
          variant="default"
          size="xl"
          pos="absolute"
          left={0}
          top="50%"
          style={{ transform: 'translateY(-50%)' }}
          onClick={onPrevious}
          aria-label={t('images.viewer.previous')}
        >
          <CaretLeftIcon size={20} weight="bold" />
        </ActionIcon>
      )}
      {onNext && (
        <ActionIcon
          variant="default"
          size="xl"
          pos="absolute"
          right={0}
          top="50%"
          style={{ transform: 'translateY(-50%)' }}
          onClick={onNext}
          aria-label={t('images.viewer.next')}
        >
          <CaretRightIcon size={20} weight="bold" />
        </ActionIcon>
      )}

      <Group
        gap="xs"
        pos="absolute"
        bottom={0}
        left="50%"
        p={4}
        bg="var(--bg-raised)"
        style={{
          transform: 'translateX(-50%)',
          borderRadius: 'var(--mantine-radius-lg)',
          border: '1px solid var(--border-default)',
        }}
      >
        <Tooltip label={t('images.viewer.zoomOut')}>
          <ActionIcon
            variant="default"
            size="lg"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
            aria-label={t('images.viewer.zoomOut')}
          >
            <MagnifyingGlassMinusIcon size={20} weight="bold" />
          </ActionIcon>
        </Tooltip>
        <Text size="sm" c="dimmed" w={48} ta="center">
          {Math.round(zoom * 100)}%
        </Text>
        <Tooltip label={t('images.viewer.zoomIn')}>
          <ActionIcon
            variant="default"
            size="lg"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
            aria-label={t('images.viewer.zoomIn')}
          >
            <MagnifyingGlassPlusIcon size={20} weight="bold" />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('images.viewer.fit')}>
          <ActionIcon
            variant="default"
            size="lg"
            disabled={zoom === MIN_ZOOM}
            onClick={() => setZoom(MIN_ZOOM)}
            aria-label={t('images.viewer.fit')}
          >
            <ArrowsInIcon size={20} weight="bold" />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
