import type { AuthorPath, SiteIdentity } from "seo-core";

export const SITE_URL = "https://www.heyrupert.com";
export const SITE_NAME = "Rupert";

/** URL segment for articles. Changing it requires redirects for every article. */
export const ARTICLES_BASE = "articles";

/** Portal sign-in. The site Login button goes here, not through an interstitial. */
export const PORTAL_LOGIN_URL = "https://hey-rupert-portal.vercel.app/login";

/** Public LinkedIn profile for Dori. Used on Person schema, not as a company profile. */
export const DORI_LINKEDIN =
  "https://www.linkedin.com/in/dori-fussmann-663ba242";

/**
 * Organization `sameAs` profiles. Only include verified company URLs.
 * Dori's personal LinkedIn belongs on Person schema, not here.
 * TODO: add the Rupert LinkedIn company page and Crunchbase URLs (the audit warns while empty).
 */
export const SAME_AS: string[] = [];

/** Organization logo (512×512 PNG of the Rupert portrait). */
export const LOGO_PATH = "/logo.png";

export const SITE_IDENTITY: SiteIdentity = {
  siteUrl: SITE_URL,
  siteName: SITE_NAME,
  logo: LOGO_PATH,
  sameAs: SAME_AS,
};

/** Authors are profiled on the About page, anchored by slug ("/about/#dori-fussmann"). */
export const AUTHOR_PATH: AuthorPath = (slug) => `/about/#${slug}`;

export const SITE_DESCRIPTION =
  "Rupert runs investor research, targeting, and personalized outreach for founders raising capital. You approve the messages. Investor relationships stay yours.";

/** Default marketing Open Graph image (1200×630). */
export const DEFAULT_OG_IMAGE = "/og-default.png";
