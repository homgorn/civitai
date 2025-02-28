import { MetricTimeframe, ModelStatus, Prisma, TagTarget } from '@prisma/client';
import isEqual from 'lodash/isEqual';
import { SessionUser } from 'next-auth';

import { ModelSort } from '~/server/common/enums';
import { prisma } from '~/server/db/client';
import { GetByIdInput } from '~/server/schema/base.schema';
import { GetAllModelsOutput, ModelInput } from '~/server/schema/model.schema';
import { prepareFile } from '~/utils/file-helpers';
import { env } from '~/env/server.mjs';
import { isNotTag, isTag } from '~/server/schema/tag.schema';
import { TRPCError } from '@trpc/server';

export const getModel = async <TSelect extends Prisma.ModelSelect>({
  input: { id },
  user,
  select,
}: {
  input: GetByIdInput;
  user?: SessionUser;
  select: TSelect;
}) => {
  return await prisma.model.findFirst({
    where: {
      id,
      OR: !user?.isModerator
        ? [{ status: ModelStatus.Published }, { user: { id: user?.id } }]
        : undefined,
    },
    select,
  });
};

export const getModels = async <TSelect extends Prisma.ModelSelect>({
  input: {
    take,
    skip,
    cursor,
    query,
    tag,
    tagname,
    user,
    username,
    baseModels,
    types,
    sort,
    period = MetricTimeframe.AllTime,
    rating,
    favorites,
    hidden,
    hideNSFW,
    excludedTagIds,
    excludedIds,
  },
  select,
  user: sessionUser,
  count = false,
}: {
  input: Omit<GetAllModelsOutput, 'limit' | 'page'> & { take?: number; skip?: number };
  select: TSelect;
  user?: SessionUser;
  count?: boolean;
}) => {
  const canViewNsfw = sessionUser?.showNsfw ?? env.UNAUTHENTICATE_LIST_NSFW;
  const AND: Prisma.Enumerable<Prisma.ModelWhereInput> = [];
  if (!sessionUser?.isModerator) {
    AND.push({ OR: [{ status: ModelStatus.Published }, { user: { id: sessionUser?.id } }] });
  }
  if (query) {
    AND.push({
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        {
          modelVersions: {
            some: {
              files: query
                ? {
                    some: {
                      hashes: { some: { hash: { equals: query, mode: 'insensitive' } } },
                    },
                  }
                : undefined,
            },
          },
        },
      ],
    });
  }
  if (excludedTagIds && !username) {
    AND.push({
      tagsOnModels: { every: { tagId: { notIn: excludedTagIds } } },
    });
  }
  if (excludedIds) {
    AND.push({ id: { notIn: excludedIds } });
  }

  const where: Prisma.ModelWhereInput = {
    tagsOnModels:
      tagname ?? tag
        ? { some: { tag: { name: { equals: tagname ?? tag, mode: 'insensitive' } } } }
        : undefined,
    user: username ?? user ? { username: username ?? user } : undefined,
    type: types?.length ? { in: types } : undefined,
    nsfw: !canViewNsfw || hideNSFW ? { equals: false } : undefined,
    rank: rating
      ? {
          AND: [{ ratingAllTime: { gte: rating } }, { ratingAllTime: { lt: rating + 1 } }],
        }
      : undefined,
    engagements: favorites
      ? { some: { userId: sessionUser?.id, type: 'Favorite' } }
      : hidden
      ? { some: { userId: sessionUser?.id, type: 'Hide' } }
      : undefined,
    AND: AND.length ? AND : undefined,
    modelVersions: baseModels?.length ? { some: { baseModel: { in: baseModels } } } : undefined,
  };

  const items = await prisma.model.findMany({
    take,
    skip,
    where,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [
      ...(sort === ModelSort.HighestRated ? [{ rank: { [`rating${period}Rank`]: 'asc' } }] : []),
      ...(sort === ModelSort.MostLiked
        ? [{ rank: { [`favoriteCount${period}Rank`]: 'asc' } }]
        : []),
      ...(sort === ModelSort.MostDownloaded
        ? [{ rank: { [`downloadCount${period}Rank`]: 'asc' } }]
        : []),
      ...(sort === ModelSort.MostDiscussed
        ? [{ rank: { [`commentCount${period}Rank`]: 'asc' } }]
        : []),
      { rank: { newRank: 'asc' } },
    ],
    select,
  });

  if (count) {
    const count = await prisma.model.count({ where });
    return { items, count };
  }

  return { items };
};

export const getModelVersionsMicro = ({ id }: { id: number }) => {
  return prisma.modelVersion.findMany({
    where: { modelId: id },
    orderBy: { index: 'asc' },
    select: { id: true, name: true },
  });
};

export const updateModelById = ({ id, data }: { id: number; data: Prisma.ModelUpdateInput }) => {
  return prisma.model.update({
    where: { id },
    data,
  });
};

export const deleteModelById = ({ id }: GetByIdInput) => {
  return prisma.model.delete({ where: { id } });
};

const prepareModelVersions = (versions: ModelInput['modelVersions']) => {
  return versions.map(({ files, ...version }) => {
    // Keep tab whether there's a file format-type conflict.
    // We needed to manually check for this because Prisma doesn't do
    // error handling all too well
    const fileConflicts: Record<string, boolean> = {};

    return {
      ...version,
      files: files.map((file) => {
        const preparedFile = prepareFile(file);

        if (fileConflicts[`${preparedFile.type}-${preparedFile.format}`])
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Only 1 ${preparedFile.format} ${preparedFile.type} file can be attached to a version, please review your uploads and try again`,
          });
        else fileConflicts[`${preparedFile.type}-${preparedFile.format}`] = true;

        return preparedFile;
      }),
    };
  });
};

export const createModel = async ({
  modelVersions,
  userId,
  tagsOnModels,
  ...data
}: ModelInput & { userId: number }) => {
  // TODO Cleaning: Merge Add & Update + Transaction
  // Create prisma transaction
  // Upsert Model: separate function
  // Upsert ModelVersions: separate function
  // Upsert Tags: separate function
  // Upsert Images: separate function
  // Upsert ImagesOnModels: separate function
  // Upsert ModelFiles: separate function
  // 👆 Ideally the whole thing will only be this many lines
  //    All of the logic would be in the separate functions

  const parsedModelVersions = prepareModelVersions(modelVersions);
  const allImagesNSFW = parsedModelVersions
    .flatMap((version) => version.images)
    .every((image) => image.nsfw);

  return prisma.model.create({
    data: {
      ...data,
      //TODO - if all images are nsfw and !data.nsfw, then data.nsfw needs to be true
      // nsfw:
      //   modelVersions.flatMap((version) => version.images).every((image) => image.nsfw) ??
      //   data.nsfw,
      publishedAt: data.status === ModelStatus.Published ? new Date() : null,
      lastVersionAt: new Date(),
      nsfw: data.nsfw || (allImagesNSFW && data.status === ModelStatus.Published),
      userId,
      modelVersions: {
        create: parsedModelVersions.map(({ images, files, ...version }, versionIndex) => ({
          ...version,
          index: versionIndex,
          status: data.status,
          files: files.length > 0 ? { create: files } : undefined,
          images: {
            create: images.map((image, index) => ({
              index,
              image: {
                create: {
                  ...image,
                  userId,
                  meta: (image.meta as Prisma.JsonObject) ?? Prisma.JsonNull,
                },
              },
            })),
          },
        })),
      },
      tagsOnModels: {
        create: tagsOnModels?.map((tag) => {
          const name = tag.name.toLowerCase().trim();
          return {
            tag: {
              connectOrCreate: {
                where: { name_target: { name, target: TagTarget.Model } },
                create: { name, target: TagTarget.Model },
              },
            },
          };
        }),
      },
    },
  });
};

export const updateModel = async ({
  id,
  tagsOnModels,
  modelVersions,
  userId,
  ...data
}: ModelInput & { id: number; userId: number }) => {
  const parsedModelVersions = prepareModelVersions(modelVersions);
  const currentModel = await prisma.model.findUnique({
    where: { id },
    select: { status: true, publishedAt: true },
  });
  if (!currentModel) return currentModel;

  // Get currentVersions to compare files and images
  const currentVersions = await prisma.modelVersion.findMany({
    where: { modelId: id },
    orderBy: { index: 'asc' },
    select: {
      id: true,
      name: true,
      baseModel: true,
      description: true,
      steps: true,
      epochs: true,
      images: {
        orderBy: { index: 'asc' },
        select: {
          image: {
            select: {
              id: true,
              meta: true,
              name: true,
              width: true,
              height: true,
              hash: true,
              url: true,
              nsfw: true,
            },
          },
        },
      },
      trainedWords: true,
      files: {
        select: { id: true, type: true, url: true, name: true, sizeKB: true },
      },
    },
  });
  // Transform currentVersions to payload structure for easy compare
  const existingVersions = currentVersions.map(({ images, ...version }) => ({
    ...version,
    images: images.map(({ image }) => image),
  }));

  // Determine which version to create/update
  type PayloadVersion = typeof modelVersions[number] & { index: number };
  const { versionsToCreate, versionsToUpdate } = parsedModelVersions.reduce(
    (acc, current, index) => {
      if (!current.id) acc.versionsToCreate.push({ ...current, index });
      else {
        const matched = existingVersions.findIndex((version) => version.id === current.id);
        const different = !isEqual(existingVersions[matched], parsedModelVersions[matched]);
        if (different) acc.versionsToUpdate.push({ ...current, index });
      }

      return acc;
    },
    { versionsToCreate: [] as PayloadVersion[], versionsToUpdate: [] as PayloadVersion[] }
  );

  const versionIds = parsedModelVersions.map((version) => version.id).filter(Boolean) as number[];
  const hasNewVersions = parsedModelVersions.some((x) => !x.id);

  const allImagesNSFW = parsedModelVersions
    .flatMap((version) => version.images)
    .every((image) => image.nsfw);

  const model = await prisma.model.update({
    where: { id },
    data: {
      ...data,
      nsfw: data.nsfw || (allImagesNSFW && data.status === ModelStatus.Published),
      status: data.status,
      publishedAt:
        data.status === ModelStatus.Published && currentModel.status !== ModelStatus.Published
          ? new Date()
          : currentModel.publishedAt,
      lastVersionAt: hasNewVersions ? new Date() : undefined,
      modelVersions: {
        deleteMany: versionIds.length > 0 ? { id: { notIn: versionIds } } : undefined,
        create: versionsToCreate.map(({ images, files, ...version }) => ({
          ...version,
          files: { create: files },
          images: {
            create: images.map(({ id, meta, ...image }, index) => ({
              index,
              image: {
                create: {
                  ...image,
                  userId,
                  meta: (meta as Prisma.JsonObject) ?? Prisma.JsonNull,
                },
              },
            })),
          },
        })),
        update: versionsToUpdate.map(({ id = -1, images, files, ...version }) => {
          const fileIds = files.map((file) => file.id).filter(Boolean) as number[];
          const currentVersion = existingVersions.find((x) => x.id === id);

          // Determine which files to create/update
          const { filesToCreate, filesToUpdate } = files.reduce(
            (acc, current) => {
              if (!current.id) acc.filesToCreate.push(current);
              else {
                const existingFiles = currentVersion?.files ?? [];
                const matched = existingFiles.findIndex((file) => file.id === current.id);
                const different = !isEqual(existingFiles[matched], files[matched]);
                if (different) acc.filesToUpdate.push(current);
              }

              return acc;
            },
            { filesToCreate: [] as typeof files, filesToUpdate: [] as typeof files }
          );

          // Determine which images to create/update
          type PayloadImage = typeof images[number] & {
            index: number;
            userId: number;
            meta: Prisma.JsonObject;
          };
          const { imagesToCreate, imagesToUpdate } = images.reduce(
            (acc, current, index) => {
              if (!current.id)
                acc.imagesToCreate.push({
                  ...current,
                  index,
                  userId,
                  meta: (current.meta as Prisma.JsonObject) ?? Prisma.JsonNull,
                });
              else {
                const existingImages = currentVersion?.images ?? [];
                const matched = existingImages.findIndex((image) => image.id === current.id);
                const different = !isEqual(existingImages[matched], images[matched]);
                if (different)
                  acc.imagesToUpdate.push({
                    ...current,
                    index,
                    userId,
                    meta: (current.meta as Prisma.JsonObject) ?? Prisma.JsonNull,
                  });
              }

              return acc;
            },
            { imagesToCreate: [] as PayloadImage[], imagesToUpdate: [] as PayloadImage[] }
          );

          return {
            where: { id },
            data: {
              ...version,
              status: data.status,
              files: {
                deleteMany: fileIds.length > 0 ? { id: { notIn: fileIds } } : undefined,
                create: filesToCreate,
                update: filesToUpdate.map(({ id, ...fileData }) => ({
                  where: { id: id ?? -1 },
                  data: { ...fileData },
                })),
              },
              images: {
                deleteMany: {
                  NOT: images.map((image) => ({ imageId: image.id })),
                },
                create: imagesToCreate.map(({ index, ...image }) => ({
                  index,
                  image: { create: image },
                })),
                update: imagesToUpdate.map(({ index, meta, nsfw, ...image }) => ({
                  where: {
                    imageId_modelVersionId: {
                      imageId: image.id as number,
                      modelVersionId: id,
                    },
                  },
                  data: {
                    index,
                    image: {
                      update: {
                        nsfw,
                        meta,
                      },
                    },
                  },
                })),
              },
            },
          };
        }),
      },
      tagsOnModels: tagsOnModels
        ? {
            deleteMany: {
              tagId: {
                notIn: tagsOnModels.filter(isTag).map((x) => x.id),
              },
            },
            connectOrCreate: tagsOnModels.filter(isTag).map((tag) => ({
              where: { modelId_tagId: { tagId: tag.id, modelId: id } },
              create: { tagId: tag.id },
            })),
            create: tagsOnModels.filter(isNotTag).map((tag) => {
              const name = tag.name.toLowerCase().trim();
              return {
                tag: {
                  create: { name, target: TagTarget.Model },
                },
              };
            }),
          }
        : undefined,
    },
  });

  return model;
};
