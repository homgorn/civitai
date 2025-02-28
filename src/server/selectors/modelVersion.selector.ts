import { Prisma } from '@prisma/client';

import { imageSelectWithoutId } from '~/server/selectors/image.selector';

export const getModelVersionDetailsSelect = Prisma.validator<Prisma.ModelVersionSelect>()({
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  trainedWords: true,
  baseModel: true,
  earlyAccessTimeFrame: true,
  images: {
    orderBy: {
      index: 'asc',
    },
    select: {
      image: {
        select: imageSelectWithoutId,
      },
    },
    take: 20,
  },
  files: {
    select: {
      name: true,
      id: true,
      sizeKB: true,
      type: true,
      format: true,
      pickleScanResult: true,
      pickleScanMessage: true,
      virusScanResult: true,
      scannedAt: true,
      hashes: {
        select: {
          type: true,
          hash: true,
        },
      },
    },
  },
});

export const getModelVersionApiSelect = Prisma.validator<Prisma.ModelVersionSelect>()({
  ...getModelVersionDetailsSelect,
  modelId: true,
  model: {
    select: { name: true, type: true, nsfw: true, poi: true },
  },
});
const modelVersionApi = Prisma.validator<Prisma.ModelVersionArgs>()({
  select: getModelVersionApiSelect,
});
export type ModelVersionApiReturn = Prisma.ModelVersionGetPayload<typeof modelVersionApi>;
