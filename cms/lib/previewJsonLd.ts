import { SAME_AS, SITE_NAME } from "../../site/src/config/site.ts";
import { absoluteUrl } from "../../site/src/lib/url.ts";

type Link = { label: string; url: string };
type Faq = { question: string; answer: string };

type Author = {
  name: string;
  slug: string;
  role: string;
  bio: string;
  sameAs?: string[];
};

export function previewArticleJsonLd(input: {
  title: string;
  description: string;
  slug: string;
  date: string;
  updatedDate?: string;
  schemaType?: string;
  locale?: string;
  faqs?: Faq[];
  author: Author;
}): Record<string, unknown>[] {
  const canonicalPath = `/articles/${input.slug}/`;
  const pageUrl = absoluteUrl(canonicalPath);
  const orgId = `${absoluteUrl("/")}#organization`;
  const personId = `${absoluteUrl("/team/")}#${input.author.slug}`;
  const published = new Date(input.date).toISOString();
  const modified = new Date(input.updatedDate || input.date).toISOString();

  const blocks: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": orgId,
      name: SITE_NAME,
      url: absoluteUrl("/"),
      sameAs: SAME_AS,
    },
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": personId,
      name: input.author.name,
      jobTitle: input.author.role,
      description: input.author.bio,
      url: absoluteUrl("/team/"),
      sameAs: input.author.sameAs ?? [],
    },
    {
      "@context": "https://schema.org",
      "@type": input.schemaType || "BlogPosting",
      headline: input.title,
      description: input.description,
      datePublished: published,
      dateModified: modified,
      inLanguage: input.locale || "en-US",
      mainEntityOfPage: pageUrl,
      author: { "@id": personId },
      publisher: { "@id": orgId },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: absoluteUrl("/"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Articles",
          item: absoluteUrl("/articles/"),
        },
        {
          "@type": "ListItem",
          position: 3,
          name: input.title,
          item: pageUrl,
        },
      ],
    },
  ];

  if (input.faqs && input.faqs.length > 0) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: input.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  return blocks;
}

export type { Link, Faq, Author };
