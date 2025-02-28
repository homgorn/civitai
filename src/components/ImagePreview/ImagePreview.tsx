import {
  ActionIcon,
  AspectRatio,
  Center,
  createStyles,
  MantineNumberSize,
  Box,
  BoxProps,
} from '@mantine/core';
import { MediaHash } from '~/components/ImageHash/ImageHash';
import { ImageModel } from '~/server/selectors/image.selector';
// import { useImageLightbox } from '~/hooks/useImageLightbox';
import { EdgeImage, EdgeImageProps } from '~/components/EdgeImage/EdgeImage';
import { ImageMetaProps } from '~/server/schema/image.schema';
import { IconInfoCircle } from '@tabler/icons';
import { ImageMetaPopover } from '~/components/ImageMeta/ImageMeta';
import { getClampedSize } from '~/utils/blurhash';
import { CSSProperties } from 'react';

type ImagePreviewProps = {
  nsfw?: boolean;
  aspectRatio?: number;
  // lightboxImages?: ImageModel[];
  image: ImageModel;
  edgeImageProps?: Omit<EdgeImageProps, 'src'>;
  withMeta?: boolean;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  radius?: MantineNumberSize;
} & Omit<BoxProps, 'component'>;

export function ImagePreview({
  image: { url, name, width, height, hash, meta },
  edgeImageProps = {},
  nsfw,
  aspectRatio,
  withMeta,
  style,
  onClick,
  className,
  radius = 0,
  ...props
}: ImagePreviewProps) {
  const { classes, cx } = useStyles({ radius });
  aspectRatio ??= (width ?? 16) / (height ?? 9);

  if (!edgeImageProps.width && !edgeImageProps.height) {
    if (!edgeImageProps.height && width) edgeImageProps.width = width;
    else if (!edgeImageProps.width && height) edgeImageProps.height = height;
  }

  if (!width || !height) return null;
  const { width: cw, height: ch } = getClampedSize(
    width,
    height,
    edgeImageProps.height ?? edgeImageProps.width ?? 500,
    edgeImageProps.height ? 'height' : edgeImageProps.width ? 'width' : 'all'
  );

  const Meta = !nsfw && withMeta && meta && (
    <ImageMetaPopover meta={meta as ImageMetaProps}>
      <ActionIcon
        variant="transparent"
        style={{ position: 'absolute', bottom: '5px', right: '5px' }}
        size="lg"
      >
        <IconInfoCircle color="white" />
      </ActionIcon>
    </ImageMetaPopover>
  );

  const edgeImageStyle: CSSProperties = {
    maxHeight: '100%',
    maxWidth: '100%',
  };
  if (onClick) edgeImageStyle.cursor = 'pointer';
  if (style?.height || style?.maxHeight) edgeImageStyle.maxHeight = '100%';
  const Image = nsfw ? (
    <Center style={{ width: cw, height: ch, maxWidth: '100%' }}>
      <MediaHash hash={hash} width={width} height={height} />
    </Center>
  ) : (
    <EdgeImage
      src={url}
      alt={name ?? undefined}
      {...edgeImageProps}
      onClick={onClick}
      style={edgeImageStyle}
    />
  );

  return (
    <Box className={cx(classes.root, className)} style={{ ...style }} {...props}>
      {aspectRatio === 0 ? Image : <AspectRatio ratio={aspectRatio}>{Image}</AspectRatio>}
      {Meta}
    </Box>
  );
}

const useStyles = createStyles((theme, { radius }: { radius?: MantineNumberSize }) => ({
  root: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: theme.fn.radius(radius),
  },
}));
