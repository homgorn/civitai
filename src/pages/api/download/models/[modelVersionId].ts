import { ModelFileFormat, ModelType, Prisma, UserActivityType } from '@prisma/client';
import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { env } from '~/env/server.mjs';
import { prisma } from '~/server/db/client';
import { getServerAuthSession } from '~/server/utils/get-server-auth-session';
import { filenamize } from '~/utils/string-helpers';
import { getGetUrl } from '~/utils/s3-utils';
import requestIp from 'request-ip';
import { constants, ModelFileType } from '~/server/common/constants';
import { getPrimaryFile } from '~/server/utils/model-helpers';

const schema = z.object({
  modelVersionId: z.preprocess((val) => Number(val), z.number()),
  type: z.enum(constants.modelFileTypes).optional(),
  format: z.nativeEnum(ModelFileFormat).optional(),
});

export default async function downloadModel(req: NextApiRequest, res: NextApiResponse) {
  // Get ip so that we can block exploits we catch
  const ip = requestIp.getClientIp(req);
  const blacklist = (
    ((await prisma.keyValue.findUnique({ where: { key: 'ip-blacklist' } }))?.value as string) ?? ''
  ).split(',');
  if (ip && blacklist.includes(ip)) return res.status(403).json({ error: 'Forbidden' });

  const queryResults = schema.safeParse(req.query);
  if (!queryResults.success)
    return res
      .status(400)
      .json({ error: `Invalid id: ${queryResults.error.flatten().fieldErrors.modelVersionId}` });

  const { type, modelVersionId, format } = queryResults.data;
  if (!modelVersionId) return res.status(400).json({ error: 'Missing modelVersionId' });

  const fileWhere: Prisma.ModelFileWhereInput = {};
  if (type) fileWhere.type = type;
  if (format) fileWhere.format = format;

  const modelVersion = await prisma.modelVersion.findFirst({
    where: { id: modelVersionId },
    select: {
      id: true,
      model: { select: { id: true, name: true, type: true } },
      name: true,
      trainedWords: true,
      files: { where: fileWhere, select: { url: true, name: true, type: true, format: true } },
    },
  });
  if (!modelVersion) return res.status(404).json({ error: 'Model not found' });

  const session = await getServerAuthSession({ req, res });
  const file =
    type != null || format != null
      ? modelVersion.files[0]
      : getPrimaryFile(modelVersion.files, {
          type: session?.user?.preferredPrunedModel ? 'Pruned Model' : undefined,
          format: session?.user?.preferredModelFormat,
        });
  if (!file) return res.status(404).json({ error: 'Model file not found' });

  const userId = session?.user?.id;
  if (!env.UNAUTHENTICATED_DOWNLOAD && !userId) {
    if (req.headers['content-type'] === 'application/json')
      return res.status(401).json({ error: 'Unauthorized' });
    else return res.redirect(`/login?returnUrl=/models/${modelVersion.model.id}`);
  }

  // Track download
  try {
    await prisma.userActivity.create({
      data: {
        userId,
        activity: UserActivityType.ModelDownload,
        details: {
          modelId: modelVersion.model.id,
          modelVersionId: modelVersion.id,
          // Just so we can catch exploits
          ...(!userId
            ? {
                ip,
                userAgent: req.headers['user-agent'],
              }
            : {}), // You'll notice we don't include this for authed users...
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Invalid database operation', cause: error });
  }

  const fileName = getDownloadFilename({ model: modelVersion.model, modelVersion, file });
  const { url } = await getGetUrl(file.url, { fileName });
  res.redirect(url);
}

export function getDownloadFilename({
  model,
  modelVersion,
  file,
}: {
  model: { name: string; type: ModelType };
  modelVersion: { name: string; trainedWords: string[] };
  file: { name: string; type: ModelFileType | string };
}) {
  let fileName = file.name;
  const modelName = filenamize(model.name);
  const versionName = filenamize(modelVersion.name).replace(modelName, '');

  const ext = file.name.split('.').pop();
  if (!constants.modelFileTypes.includes(file.type as ModelFileType)) return file.name;
  const fileType = file.type as ModelFileType;

  if (fileType === 'Training Data') {
    fileName = `${modelName}_${versionName}_trainingData.zip`;
  } else if (model.type === ModelType.TextualInversion) {
    const trainedWord = modelVersion.trainedWords[0];
    let fileSuffix = '';
    if (fileType === 'Negative') fileSuffix = '-neg';

    if (trainedWord) fileName = `${trainedWord}${fileSuffix}.${ext}`;
  } else if (fileType !== 'VAE') {
    let fileSuffix = '';
    if (fileName.includes('-inpainting')) fileSuffix = '-inpainting';
    else if (fileType === 'Text Encoder') fileSuffix = '_txt';

    fileName = `${modelName}_${versionName}${fileSuffix}.${ext}`;
  }
  return fileName;
}
