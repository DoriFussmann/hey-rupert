import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const link = z.object({
  label: z.string(),
  url: z.string(),
});

const faq = z.object({
  question: z.string(),
  answer: z.string(),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().min(55).max(60),
        description: z.string().min(140).max(160),
        slug: z.string(),
        date: z.coerce.date(),
        author: z.string(),
        category: z.string(),
        tags: z.array(z.string()).min(4).max(6),
        image: image(),
        imageAlt: z.string().min(10),
        robots: z.string().default("index, follow"),
        schemaType: z.string().default("BlogPosting"),
        locale: z.string().default("en-US"),
        twitterCard: z.string().default("summary_large_image"),
        draft: z.boolean().default(false),
        h1: z.string().min(20).optional(),
        pillarKeyword: z.string().optional(),
        supportingKeyword: z.string().optional(),
        articleType: z
          .enum(["comprehensive", "howto", "comparison", "faq", "flex"])
          .optional(),
        targetKeyword: z.string().optional(),
        updatedDate: z.coerce.date().optional(),
        keywords: z.array(z.string()).optional(),
        canonical: z.string().optional(),
        image2: image().optional(),
        image2Alt: z.string().min(10).optional(),
        image3: image().optional(),
        image3Alt: z.string().min(10).optional(),
        ogTitle: z.string().optional(),
        ogDescription: z.string().optional(),
        ogImage: image().optional(),
        internalLinks: z.array(link).optional(),
        externalLinks: z.array(link).optional(),
        faqs: z.array(faq).optional(),
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
      }),
});

const team = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/team" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      slug: z.string(),
      role: z.string(),
      bio: z.string(),
      credentials: z.string().optional(),
      photo: image(),
      sameAs: z.array(z.string().url()).default([]),
    }),
});

const services = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/services" }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    summary: z.string(),
    order: z.number(),
  }),
});

export const collections = { articles, team, services };
