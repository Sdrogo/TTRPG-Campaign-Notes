import { useState } from 'react';
import { Box } from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import { imageOrientation, type ImageOrientation } from '../lib/images';
import type { DocumentImage } from '../types/document';

// Half the card's width (spec 07), so this stays short enough that the
// description beside it still reads as the main content. A landscape image
// is usually shorter than this; a portrait one is exactly this tall.
const CARD_IMAGE_MAX_HEIGHT = { base: 160, sm: 200 };

// The whole card is a link (see `DocumentCard`), which sits above the images
// so clicking one opens the Document. The carousel's own controls have to
// come back out on top of it, or they'd just navigate too.
const ABOVE_CARD_LINK = 2;

const centered = { display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

interface DocumentCardImagesProps {
  images: DocumentImage[];
  documentName: string;
}

/** The Document's images on its card, favorite first. Read-only: managing
 *  them (adding, deleting, moving the favorite) stays on the detail page. */
export function DocumentCardImages({ images, documentName }: DocumentCardImagesProps) {
  if (images.length === 0) {
    return null;
  }

  if (images.length === 1) {
    return (
      <Box style={centered}>
        <CardImage image={images[0]} alt={documentName} />
      </Box>
    );
  }

  return (
    <Box h={CARD_IMAGE_MAX_HEIGHT}>
      <Carousel
        height="100%"
        withIndicators
        // Dragging would fight the card's link overlay, so the arrows - kept
        // visible rather than shown on hover, since a touch screen has none -
        // are the way through the images.
        emblaOptions={{ loop: true, watchDrag: false }}
        styles={{
          controls: { zIndex: ABOVE_CARD_LINK, opacity: 1 },
          indicators: { zIndex: ABOVE_CARD_LINK },
          indicator: { width: 10, height: 3 },
        }}
      >
        {images.map((image, index) => (
          <Carousel.Slide key={image.id} style={centered}>
            <CardImage image={image} alt={`${documentName} (${index + 1})`} />
          </Carousel.Slide>
        ))}
      </Carousel>
    </Box>
  );
}

// Framed the way the image itself is (spec 07.1), never cropped: a landscape
// image fills the width, a portrait one the height. Its orientation is only
// known once it has loaded; until then it holds a landscape placeholder.
function sizeFor(orientation: ImageOrientation | null) {
  switch (orientation) {
    case 'landscape':
      return { w: '100%', h: 'auto', mah: CARD_IMAGE_MAX_HEIGHT };
    case 'portrait':
      return { w: 'auto', h: CARD_IMAGE_MAX_HEIGHT };
    case null:
      return { w: '100%', h: CARD_IMAGE_MAX_HEIGHT, bg: 'var(--bg-base)' };
  }
}

function CardImage({ image, alt }: { image: DocumentImage; alt: string }) {
  const [orientation, setOrientation] = useState<ImageOrientation | null>(null);

  return (
    <Box
      component="img"
      src={image.url}
      alt={alt}
      loading="lazy"
      draggable={false}
      data-orientation={orientation ?? undefined}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        setOrientation(imageOrientation(naturalWidth, naturalHeight));
      }}
      {...sizeFor(orientation)}
      maw="100%"
      style={{
        display: 'block',
        objectFit: 'contain',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    />
  );
}
