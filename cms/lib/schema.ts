import { z } from "zod";

export const linkSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
});

export const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const articleTypeSchema = z.enum([
  "comprehensive",
  "howto",
  "comparison",
  "faq",
  "flex",
]);

export const articleSchema = z
  .object({
    title: z.string().min(55).max(60),
    description: z.string().min(140).max(160),
    slug: z.string().min(1),
    date: z.coerce.date(),
    author: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).min(4).max(6),
    image: z.string().min(1),
    imageAlt: z.string().min(10),
    robots: z.string().default("index, follow"),
    schemaType: z.string().default("BlogPosting"),
    locale: z.string().default("en-US"),
    twitterCard: z.string().default("summary_large_image"),
    draft: z.boolean().default(false),
    h1: z.string().min(20).optional(),
    pillarKeyword: z.string().optional(),
    supportingKeyword: z.string().optional(),
    articleType: articleTypeSchema.optional(),
    targetKeyword: z.string().optional(),
    updatedDate: z.coerce.date().optional(),
    keywords: z.array(z.string()).optional(),
    canonical: z.string().optional(),
    image2: z.string().optional(),
    image2Alt: z.string().min(10).optional(),
    image3: z.string().optional(),
    image3Alt: z.string().min(10).optional(),
    ogTitle: z.string().optional(),
    ogDescription: z.string().optional(),
    ogImage: z.string().optional(),
    internalLinks: z.array(linkSchema).optional(),
    externalLinks: z.array(linkSchema).optional(),
    faqs: z.array(faqSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.image2 && !data.image2Alt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image2Alt is required when image2 is set",
        path: ["image2Alt"],
      });
    }
    if (data.image3 && !data.image3Alt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image3Alt is required when image3 is set",
        path: ["image3Alt"],
      });
    }
  });

export const teamSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  role: z.string().min(1),
  bio: z.string().min(1),
  credentials: z.string().optional(),
  photo: z.string().min(1),
  sameAs: z.array(z.string().url()).default([]),
});

export const serviceSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  summary: z.string().min(1),
  order: z.number(),
});

export const ARTICLE_REQUIRED_FIELDS = [
  "title",
  "description",
  "slug",
  "date",
  "author",
  "category",
  "tags",
  "image",
  "imageAlt",
  "robots",
  "schemaType",
  "locale",
  "twitterCard",
  "draft",
] as const;

export const ARTICLE_OPTIONAL_FIELDS = [
  "h1",
  "pillarKeyword",
  "supportingKeyword",
  "articleType",
  "targetKeyword",
  "updatedDate",
  "keywords",
  "canonical",
  "image2",
  "image2Alt",
  "image3",
  "image3Alt",
  "ogTitle",
  "ogDescription",
  "ogImage",
  "internalLinks",
  "externalLinks",
  "faqs",
] as const;
