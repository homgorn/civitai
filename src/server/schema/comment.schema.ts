import { z } from 'zod';

import { ReviewFilter, ReviewSort } from '~/server/common/enums';
import { getSanitizedStringSchema } from '~/server/schema/utils.schema';

export type GetAllCommentsSchema = z.infer<typeof getAllCommentsSchema>;
export const getAllCommentsSchema = z
  .object({
    limit: z.number().min(0).max(100),
    page: z.number(),
    cursor: z.number(),
    modelId: z.number(),
    userId: z.number(),
    filterBy: z.array(z.nativeEnum(ReviewFilter)),
    sort: z.nativeEnum(ReviewSort).default(ReviewSort.Newest),
  })
  .partial();

export type CommentUpsertInput = z.infer<typeof commentUpsertInput>;
export const commentUpsertInput = z.object({
  id: z.number().optional(),
  modelId: z.number(),
  commentId: z.number().nullish(),
  reviewId: z.number().nullish(),
  parentId: z.number().nullish(),
  content: getSanitizedStringSchema({
    allowedTags: ['div', 'strong', 'p', 'em', 'u', 's', 'a', 'br', 'span'],
  }),
});

export type GetCommentReactionsSchema = z.infer<typeof getCommentReactionsSchema>;
export const getCommentReactionsSchema = z.object({ commentId: z.number() });
