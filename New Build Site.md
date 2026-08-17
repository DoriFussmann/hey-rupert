# RUPERT WEBSITE — FINAL IMPLEMENTATION BRIEF

You are now moving the Rupert public marketing website from its current audited state to a polished production-ready version.

This is an IMPLEMENTATION task.

You may modify the codebase.

Do not merely give recommendations. Inspect the existing implementation, make the changes described below, run the appropriate build/checks, and report what you changed when finished.

Work primarily in:

* `site/src/pages/index.astro`
* `site/src/layouts/BaseLayout.astro`
* `site/src/layouts/ArticleLayout.astro`
* `site/src/config/site.ts`
* `site/src/components/Header.astro`
* `site/src/components/Footer.astro`
* `site/src/components/CtaBanner.astro`
* `site/src/components/PhotoCarousel.astro`
* `site/src/components/LogoMarquee.astro`
* `site/src/styles/global.css`
* `site/tailwind.config.mjs`
* relevant individual marketing pages
* SEO/schema/config files where necessary

Do not alter the CMS unless required to keep public-site content references consistent.

---

# 1. THE PRODUCT POSITIONING

Rupert is NOT primarily:

* a SaaS platform
* an AI fundraising agent
* an investor CRM
* a self-serve investor database
* a fundraising agency blasting thousands of investors
* a broker taking a percentage of the raise

Rupert is:

**Expert-managed investor outreach for founders raising capital.**

Rupert researches investors, builds a highly relevant target list, writes and manages personalized outreach, handles sequencing and follow-up, and helps founders run a disciplined investor pipeline.

The founder retains:

* every reply
* every relationship
* complete visibility
* complete control
* 100% of the raise

Rupert takes no percentage of the capital raised.

The core positioning should feel:

**An experienced fundraising operator handling the work with you — not another fundraising tool you need to operate yourself.**

The emotional response we want from a founder is:

**“Good. Someone competent has this.”**

---

# 2. PRIMARY TARGET AUDIENCE

Primary ICP:

Founders and CEOs of venture-scale startups, primarily Pre-Seed through Series A, who are actively preparing for or currently raising capital.

Typical profile:

* founder-led technology company
* roughly 2–50 employees
* already has a product/company/story worth funding
* usually raising approximately $500K–$10M
* founder is managing the raise personally
* lacks the time or expertise to research investors and run disciplined outbound
* does not want another dashboard or tool
* values precision, professionalism, discretion, transparency and ownership

They are not looking for “fundraising hacks.”

They want qualified investor conversations without turning themselves into full-time fundraising operators.

---

# 3. BRAND VOICE

All public copy should sound like an experienced banker/founder/operator speaking to another sophisticated founder.

Tone:

* calm
* concise
* specific
* confident
* candid
* understated
* professional

Use short declarative claims where appropriate.

Examples:

“Every reply comes to you.”

“No percentage of your raise.”

“Nothing goes out until you approve it.”

Avoid:

* AI hype
* startup clichés
* “supercharge”
* “unlock”
* “game-changing”
* “revolutionary”
* “10x your raise”
* “rocket fuel”
* emoji
* exclamation points
* marketing fluff
* forced cleverness
* inflated promises

Do not promise funding.

Do not imply Rupert can guarantee meetings, term sheets, introductions, or successful raises.

---

# 4. HOMEPAGE STRATEGY

The homepage currently has too many similarly styled card sections.

Keep the overall editorial feeling but simplify the page visually.

The page should feel more like a high-end advisory firm's website or financial document than a SaaS landing page.

Use fewer boxes.

Use more:

* whitespace
* typography
* ruled separators
* alternating editorial layouts
* restrained stat treatments
* short copy blocks

Avoid turning every idea into a tinted card.

The homepage should follow this structure:

1. Header
2. Hero
3. Three core operating principles
4. Credibility / select clients
5. What Rupert actually does
6. Why founders use Rupert
7. How it works
8. Founder credibility / Dori
9. Selected proof / results
10. FAQ
11. Closing CTA
12. Footer

Remove or consolidate redundant sections where necessary.

---

# 5. HOMEPAGE HERO — REPLACE COPY

Replace the current hero:

“Real Investors. Precise Campaigns. Direct Replies.”

with:

## H1

**Investor outreach, run by someone who has done the work.**

Supporting body:

**Rupert finds the investors most likely to fund companies like yours, builds the outreach, runs the follow-up, and keeps you in control of every conversation.**

Primary CTA:

**Book a call**

Secondary CTA:

**See how it works**

Supporting microcopy underneath:

**Expert-managed. Every reply comes to you. No percentage of your raise.**

Do not add excessive additional copy above the fold.

Keep the existing editorial photography direction if the actual images are strong.

If the four-image carousel feels distracting or overly consumer-like, simplify it.

Preferred solution:

* one strong editorial hero image on desktop
* optional subtle secondary imagery
* no aggressive carousel behavior

If keeping the carousel, stop automatic movement after the first user interaction and ensure it does not dominate the headline.

---

# 6. CORE PRINCIPLES STRIP

Immediately below hero, retain three concise ideas but make the wording stronger:

**Managed for you**
Research, targeting, copy and follow-up are handled by Rupert.

**Every reply is yours**
Investor conversations go directly to you.

**No percentage of your raise**
Rupert is paid for the work, not for ownership of your relationships.

Do not turn these into three oversized SaaS cards.

Preferred treatment:

* three columns
* thin dividers
* minimal icons or no icons
* typography first

---

# 7. SELECT CLIENTS / CREDIBILITY

Keep the client/logo proof if these are legitimate companies Rupert/Dori has actually worked with.

Change “Select Clients” to:

**Selected companies Dori has worked with**

unless every logo is specifically a Rupert client.

This distinction matters.

Do not imply companies were Rupert clients if they were instead Dori advisory/founder/CFO relationships.

Prefer a static or gently scrolling presentation.

The current continuous marquee draws unnecessary attention.

On desktop, strongly consider:

* static grid
  or
* very slow restrained row without dramatic edge fades

On mobile, make logos wrap naturally rather than continuously autoplay.

---

# 8. WHAT RUPERT DOES

Replace the weak “Services” list and redundant card structure with one strong explanatory section.

Label:

**What Rupert does**

Headline:

**The operational work behind a serious fundraise.**

Body:

**Most founders know they should be speaking with more relevant investors. The hard part is doing the research, building the list, writing the outreach, following up consistently, and keeping the process organized while still running the company. Rupert handles that work.**

Then show four capabilities:

### Investor research & targeting

Rupert builds a target universe around stage, sector, geography, investment thesis, check size and actual fit.

### Outreach strategy & writing

Messages are written for your company and the investors receiving them — not copied from a generic sequence.

### Campaign execution & follow-up

Rupert runs the outreach and follow-up process with consistency and discipline.

### Pipeline support

You retain visibility into the process and every investor relationship as conversations develop.

Avoid excessive cards.

Use a 2x2 editorial grid with thin separators or a simple vertical treatment.

---

# 9. WHY RUPERT

Create one clear differentiation section.

Label:

**Why Rupert**

Headline:

**Not another fundraising tool.**

Body:

**Databases give you names. CRMs give you a place to organize them. Automated agents give you more activity. Rupert gives you an experienced operator running the outreach with you.**

Then use these three differentiators:

### Precision over volume

The goal is not to contact the most investors. It is to identify and reach investors whose mandate actually fits the company and round.

### Human judgment

Investor selection, messaging and campaign decisions are reviewed by an experienced operator rather than delegated entirely to automation.

### Founder ownership

Every reply and every relationship remains with the founder. Rupert does not sit between you and the investor and does not take a percentage of the raise.

Do not mention competitor names here.

Do not create a comparison matrix.

---

# 10. HOW IT WORKS — HOMEPAGE VERSION

Simplify the existing three-step homepage process.

Use:

## 01 Understand the raise

A direct conversation with Dori about the company, round, story, target investor profile and what has already been tried.

## 02 Build the campaign

Rupert researches the investor universe, creates the target list and writes the outreach. You review the approach before anything goes out.

## 03 Run the process

Campaigns launch, follow-ups are managed, and investor replies come back to you. When conversations develop, Rupert stays involved where useful.

CTA:

**See the full process**

→ `/how-it-works/`

Keep “48 hours” only if this is a service commitment Rupert is confident can consistently meet.

Otherwise remove the hard promise.

---

# 11. DORI / FOUNDER CREDIBILITY

This section is important, but it should feel like evidence — not a biography dump.

Headline:

**Built by someone who has raised, advised and operated.**

Suggested copy:

**Dori Fussmann is an entrepreneur, finance executive and former investment banker who has spent his career on both sides of the fundraising table. He founded and led The Vets, previously worked in investment banking at Citi, Morgan Stanley and Ion Pacific, and today serves as CFO of BlueMark.**

**He also mentors early-stage founders through Cornell Tech's Runway Startups Program and Yale's Tsai CITY. Rupert was built to bring the discipline of institutional dealmaking to founder-led fundraising without the opacity, commissions or middleman dynamic.**

Supporting credentials may include:

* Founder & former CEO, The Vets
* CFO, BlueMark
* Former investment banking, Citi / Morgan Stanley / Ion Pacific
* Mentor, Cornell Tech Runway
* Mentor, Yale Tsai CITY

CTA:

**About Dori**

Remove the existing quote:

“If something can happen at 50% probability…”

unless Dori explicitly wants it as part of his public brand.

It does not reinforce Rupert's core proposition strongly enough and is difficult to substantiate.

---

# 12. RESOLVE CREDENTIAL AND STAT INCONSISTENCIES

The current site contains conflicting claims.

Audit and reconcile all quantitative claims before publishing.

Examples currently appearing include:

* $100M+ raised
* $250M+ collectively helped raise
* 15+ companies
* 50+ startups backed
* 2,400+ campaigns
* 8,700+ investor replies
* 1,200+ meetings
* 5x replies
* 10,000+ investors

DO NOT INVENT OR EXPAND NUMBERS.

Only retain a statistic if there is a clear source in the existing project/company data and it is genuinely supportable.

If evidence is ambiguous, remove the statistic rather than presenting an unsupported marketing claim.

Likewise, remove fictional or placeholder testimonials.

Current testimonials such as:

* Sarah M., Finova
* James K., DataPipe
* Ana R., GreenStack
* etc.

must only remain if they are real, approved testimonials.

If there is no evidence they are real customer testimonials, DELETE THEM.

Do not replace them with invented testimonials.

A smaller amount of real proof is materially better than fabricated-looking social proof.

---

# 13. PROOF / RESULTS SECTION

If verified quantitative results exist, show a restrained set of 2–4 numbers.

Do not create a dashboard.

Potential categories, only if verified:

* capital raised by Dori-led companies
* number of investor profiles in research universe
* companies advised/worked with
* investor outreach experience

Use typography and ruled lines, not four tinted stat cards.

If the campaign/reply/meeting numbers cannot be verified, remove them entirely.

---

# 14. FAQ — ADD TO HOMEPAGE

Add a concise FAQ near the bottom of the homepage.

Use approximately six questions.

### Is Rupert a fundraising agency?

Rupert is an expert-managed investor outreach service. Rupert researches investors, develops outreach and manages the campaign process, while the founder retains direct ownership of every investor relationship.

### Does Rupert take a percentage of the raise?

No. Rupert does not take a percentage of capital raised.

### Does Rupert guarantee funding or investor meetings?

No. No credible fundraising service can guarantee that an investor will engage or invest. Rupert's job is to improve the quality and execution of the outreach process.

### Who is Rupert best suited for?

Primarily founders of venture-scale companies preparing for or actively raising Pre-Seed through Series A rounds.

### Do I approve outreach before it is sent?

Yes. Messaging and campaign direction are reviewed with you before outreach begins.

### Who receives investor replies?

You do. Investor relationships remain yours.

Use native semantic `details/summary`.

Add FAQPage schema only if the FAQ is visible on the page.

---

# 15. CLOSING CTA

Replace current:

“You're raising. Investors are looking. Rupert makes the introduction.”

This implies an outcome Rupert cannot necessarily promise.

Use:

## Headline

**Spend your time on the company. Rupert can run the outreach.**

Body:

**30 minutes with Dori to understand your raise, explain how Rupert works, and determine whether it is a fit.**

CTA:

**Book a call**

Keep this consistent sitewide where `CtaBanner.astro` is used.

---

# 16. HOW IT WORKS PAGE

Retain this page, but tighten it.

Current eight steps are too operationally fragmented.

Condense into approximately five stages:

### 01 Understand the raise

Company, capital needs, story, current materials and target profile.

### 02 Research and match

Build the target investor universe using stage, vertical, geography, check size and investment criteria.

### 03 Build the outreach

Develop campaign positioning, message variants and sequence.

### 04 Approve and launch

Founder reviews and approves messaging before launch. Rupert manages execution and follow-up.

### 05 Manage engagement

Every reply goes to the founder. Rupert remains available to support prioritization and investor conversations.

Do not repeatedly say “Dori” if “Rupert” is cleaner.

Mention direct access to Dori where it is a genuine differentiator.

Remove “client portal” language unless the actual portal is available and part of the current client experience.

Do not advertise nonexistent product functionality.

---

# 17. DATABASE PAGE

The database is supporting infrastructure, not the product.

Reframe the page accordingly.

Current headline:

“The most complete investor dataset behind every campaign”

is too broad and likely impossible to substantiate.

Replace with:

## H1

**The research behind every Rupert campaign.**

Body:

**Rupert works from a structured investor dataset covering venture funds, family offices and other relevant capital sources. The database helps narrow a large market into investors whose stage, sector, geography and mandate fit the company being raised for.**

Keep factual dataset numbers only if verified.

Avoid positioning database access/export as a core self-service product unless customers actually receive database access.

The founder buys the outcome of good research, not an Excel export.

Remove the visible commissioning/image placeholder completely.

If no final photograph exists, use typography and whitespace instead.

---

# 18. ABOUT PAGE

Simplify.

Do not begin with a long contrarian list of things Dori “did not” do.

That writing style feels more performative than the Rupert brand.

Use:

Label:
**About**

H1:
**Dori Fussmann**

Opening:

**Dori Fussmann is an entrepreneur, finance executive and former investment banker with experience spanning company building, capital markets and strategic finance.**

Then use the approved medium bio.

Ensure facts and titles align everywhere.

Dori's public Rupert role should be:

**Founder**

NOT “VP Content.”

Update:

`site/src/content/team/dori-fussmann.md`

and article author treatments accordingly.

Do not show “VP Content” publicly anywhere unless that is intentionally his actual Rupert title.

Remove incomplete Fortune and Dagens Industri placeholders.

Only publish media links with actual confirmed URLs and copy.

---

# 19. TEAM PAGE

There is only one public team member.

A standalone `/team/` page adds little value and currently duplicates `/about/`.

Preferred solution:

* keep `/about/` as the canonical Dori page
* remove `/team/` from any discoverable navigation
* either redirect `/team/` permanently to `/about/`
  or
* leave it as a minimal technical compatibility route with canonical `/about/`

Update any Person schema IDs currently pointing to `/team/` so they point to `/about/#dori-fussmann`.

---

# 20. BOOK A CALL PAGE — HIGH PRIORITY

The current form is visually present but does not submit.

This must not remain silently broken.

First inspect the repo/environment for an existing:

* form endpoint
* Calendly URL
* HubSpot form
* scheduling URL
* CRM endpoint
* serverless form integration
* relevant environment variable

If a valid existing integration exists, wire the form to it correctly.

If NO submission/scheduling integration exists:

DO NOT INVENT credentials, endpoints, API keys or calendar URLs.

Instead:

1. retain the polished form UI,
2. ensure the form code is structured correctly for future submission,
3. remove misleading behavior such as `onsubmit="return false"` and a button pretending to submit,
4. add a clearly named implementation constant/config field for the booking endpoint,
5. fail gracefully if the integration is missing,
6. document exactly what external URL or endpoint is still required.

Do not claim the booking flow is functional if it is not.

Remove all visible “photography brief” placeholders.

Do not show internal production instructions publicly.

If final images are unavailable, use a cleaner text-led page.

Suggested page copy:

## H1

**Let's talk about your raise.**

Body:

**A 30-minute conversation with Dori to understand what you're raising, where you are in the process, and whether Rupert is the right fit.**

Supporting bullets:

* Discuss your target investor profile
* Understand how Rupert runs outreach
* Determine whether the engagement makes sense

Form heading:

**Tell me about the raise**

Keep existing relevant fields, but simplify if needed:

* Full name
* Work email
* Company
* Company website
* Stage
* Raising now?
* Amount being raised
* Sector
* Optional note

Do not request unnecessary data.

---

# 21. HEADER / NAVIGATION

Desktop:

Logo

How It Works
Our Database
Articles
About
Book a Call

This structure is acceptable.

Mobile currently wraps the full desktop nav and creates a large sticky header.

Fix this.

Implement an accessible mobile menu.

Requirements:

* hamburger/menu control below appropriate breakpoint
* native button
* `aria-expanded`
* keyboard accessible
* closes after selecting a route
* visible focus state
* no unnecessary animation
* body should not horizontally overflow
* tap targets minimum 44px

Keep header compact.

---

# 22. LOGO CONSISTENCY

Use one Rupert identity consistently.

The site currently has a mismatch between header image and footer text wordmark.

Use the final Rupert logo asset already placed in the project if available.

Preferred identity:

minimal four-line correspondence mark + lowercase `rupert`

Use the horizontal logo in header/footer.

Use the mark-only version for favicon where appropriate.

If the final SVG assets are present, prefer SVG over PNG.

Do not stretch/rasterize unnecessarily.

Remove conflicting old logo implementations.

---

# 23. DESIGN DIRECTION

Keep the strongest existing characteristics:

* Inter
* light mode
* editorial restraint
* warm background
* dark ink typography
* fine font weights
* no shadows
* minimal motion
* generous whitespace

However, reduce the current sage-card-heavy aesthetic.

Update palette toward the approved Rupert design system:

Background:
`#FAF9F7`

Heading / ink:
`#1A1A2E`

Body:
`#2D2D2D`

Border:
`#E4E2DE`

Muted:
use a value dark enough to pass WCAG AA

Accent:
`#B5935A` brass, used sparingly

Primary CTA:
Ink `#1A1A2E`

Primary hover:
`#11111F`

Do not make brass the dominant brand color.

It should appear only in:

* subtle rules
* small accents
* links
* quote marks
* selected labels

Remove the broad sage-green visual language unless a specific existing element clearly benefits from it.

The overall feeling should be:

**a high-quality financial document rendered on the web**

not:

**green SaaS cards**

---

# 24. BUTTONS

Primary button:

* dark ink fill
* light text
* restrained 8px radius
* no pill shape
* no gradient
* no shadow

Secondary:

* text link
  or
* quiet outline

Minimum touch target: 44px.

No animated flourishes.

---

# 25. TYPOGRAPHY

Continue using Inter.

Load:

* 300
* 400
* 500

Do not use weights 600+.

Maintain roughly:

Display: 56px desktop / ~36px mobile, weight 300
H1: 40px desktop / ~32px mobile, weight 300
H2: 28px / 400
H3: 20px / 500
Body large: 18px / 1.7
Body: 16px / 1.7
Small: 14px / 1.6

Headlines:
`letter-spacing: -0.02em`

Do not bold individual marketing phrases just to create emphasis.

Use composition and whitespace instead.

---

# 26. LAYOUT

Keep max container approximately:

1160px

Prose:

680px maximum

Increase visual breathing room.

Desktop major sections should generally have:

64–96px vertical padding.

Avoid full-width text.

Avoid more than two or three consecutive “card grids.”

Use thin ruled separators between editorial sections.

---

# 27. PHOTOGRAPHY

Only use photography when it genuinely improves the page.

Style:

* candid/editorial
* natural light
* slightly warm
* restrained saturation
* founders working
* documents
* one-to-one conversations
* paper / desk / materials

Avoid:

* handshake photography
* generic office stock
* smiling team lineups
* rockets
* graphs
* fake UI screenshots
* floating device mockups

If a final image does not exist, whitespace is preferable to a placeholder.

Remove ALL public commissioning brief text.

---

# 28. MOTION

Minimal.

Keep:

* 150–250ms hover/focus transitions
* optional subtle one-time reveal

Remove or limit:

* attention-seeking logo autoplay
* unnecessary carousel autoplay
* repeated card animations

Respect `prefers-reduced-motion`.

---

# 29. ACCESSIBILITY FIXES

Fix current known issues.

Specifically:

* muted text must meet 4.5:1 contrast where used at small sizes
* accent links must meet 4.5:1
* add skip-to-content link
* maintain visible focus ring
* mobile menu fully keyboard accessible
* semantic headings
* Book a Call form heading should be a real H2
* Dori's name should be a semantic heading where appropriate
* avoid tiny H2 elements styled only as labels
* maintain 44×44 touch targets
* alt text appropriate
* decorative duplicated logos use empty alt
* reduced motion honored

---

# 30. SEO POSITIONING

Do not keyword-stuff the homepage.

Homepage primary topic:

**investor outreach for startups / startup fundraising outreach**

Secondary semantic themes:

* find investors for startup
* fundraising strategy
* investor targeting
* venture capital outreach
* investor research
* fundraising pipeline
* Seed fundraising
* Series A fundraising

Avoid optimizing Rupert's commercial pages for broad small-business queries like:

* investors near me
* investors for small business

Those terms do not closely match Rupert's ICP.

They can be handled editorially only if strategically useful.

---

# 31. HOMEPAGE SEO

Suggested title:

**Investor Outreach for Startups | Rupert**

Alternative if length works:

**Expert-Managed Investor Outreach for Startups | Rupert**

Meta description:

**Rupert runs investor research, targeting, personalized outreach and follow-up for founders raising capital. Every reply and investor relationship stays yours.**

H1:

**Investor outreach, run by someone who has done the work.**

Only one H1.

Use H2 structure around:

* What Rupert does
* Why Rupert
* How it works
* Dori credibility
* Results/proof
* FAQ

---

# 32. HOW IT WORKS SEO

Title:

**How Rupert Runs Investor Outreach | Rupert**

Meta:

**See how Rupert researches investors, builds personalized outreach, manages follow-up and keeps founders in control of every investor relationship.**

H1:

**How Rupert runs investor outreach.**

---

# 33. DATABASE SEO

Title:

**Investor Research & Targeting Database | Rupert**

Meta:

**See how Rupert uses structured investor research to identify VCs, family offices and other capital sources that fit a startup's stage, sector and raise.**

H1:

**The research behind every Rupert campaign.**

---

# 34. ABOUT SEO

Title:

**Dori Fussmann | Founder of Rupert**

Meta:

**Dori Fussmann is an entrepreneur, finance executive and former investment banker who founded Rupert to bring disciplined investor outreach to startup fundraising.**

Add Person structured data here.

Include:

* name
* URL
* jobTitle = Founder
* affiliation Rupert
* sameAs LinkedIn
* image if appropriate

Do not include claims that are not present on the page.

---

# 35. ARTICLES

Keep the article system.

Do not mass-rewrite the 12 current articles in this task.

Preserve existing URLs.

However:

* ensure article prose width uses the intended 680px reading width
* keep TOC usable
* retain article schema
* retain FAQ schema only where visible FAQs exist
* keep internal related links
* keep sources
* ensure author title says Founder, not VP Content
* author links to `/about/`
* fix canonical/schema references away from `/team/`

Future SEO should build topic authority around:

1. finding investors
2. investor outreach
3. investor targeting
4. fundraising process
5. pitch decks
6. Seed fundraising
7. Series A fundraising
8. investor CRM/process

Do not create new articles in this implementation task.

---

# 36. STRUCTURED DATA

Maintain Organization schema.

Improve:

Organization:

* name Rupert
* URL https://www.heyrupert.com/
* logo
* sameAs where legitimate

Add Service schema on relevant commercial page/homepage for:

**Expert-Managed Investor Outreach**

Add Person schema on About.

Keep BlogPosting + Breadcrumb + FAQ where appropriate on articles.

Add homepage FAQPage schema only because visible FAQ will now exist.

Do not add fake aggregate ratings/reviews.

---

# 37. OPEN GRAPH / SOCIAL

Marketing pages currently lack OG images.

Create a restrained default OG image based on Rupert branding if feasible using existing brand assets.

Suggested treatment:

warm parchment background
Rupert logo
small line:

**Expert-managed investor outreach for founders**

No gradients.

No fake UI.

Use 1200×630.

Configure it as the default marketing OG image.

Article-specific hero OG images can remain.

Add sensible:

* `og:title`
* `og:description`
* `og:image`
* Twitter equivalents

---

# 38. SITEMAP — FIX

Production currently returns HTTP 500 for:

* `/sitemap-index.xml`
* `/sitemap-0.xml`

Investigate and fix.

Verify locally/build artifact if possible.

`robots.txt` must only advertise a working sitemap.

Do not simply remove the sitemap reference as a shortcut.

Ensure sitemap excludes:

* 404
* noindex pages as appropriate
* redirect-only technical routes where inappropriate

---

# 39. 404

Set:

`noindex, follow`

Do not emit an indexable canonical `/404/`.

Keep page useful and minimal.

---

# 40. PRIVACY / TERMS

Current pages only contain headings.

Do NOT invent legal policies.

Leave them noindex until actual legal content exists.

Remove public copy such as:

“This page will be published…”

if it looks unfinished.

Use a minimal neutral placeholder if necessary:

**Privacy Policy**

“Rupert's privacy policy is being finalized.”

and equivalent Terms wording.

However, do not claim legal terms that do not exist.

---

# 41. SEARCH CONSOLE / ANALYTICS

Do not invent tracking IDs.

Do not add Google Analytics simply because none currently exists.

Prepare architecture so analytics can be added cleanly later if needed.

If there are no IDs/config values in the environment, leave analytics absent and report it.

Likewise, do not fabricate Search Console verification.

---

# 42. PERFORMANCE

Improve where straightforward.

* do not load IBM Plex Mono globally if only one page needs it
* optimize hero image loading
* first hero image may preload if it is LCP
* remaining carousel images lazy-load where sensible
* reduce duplicated logo DOM where possible
* preserve static rendering
* do not introduce large JS dependencies
* do not add a UI framework
* keep Astro-first implementation

---

# 43. INTERNAL LINKING

Improve relevant commercial/article links naturally.

Homepage should link to:

* How It Works
* Database
* About
* Articles
* Book a Call

Relevant articles should link to commercial pages where contextually useful.

Do not place repetitive keyword-rich links everywhere.

About author references should consistently resolve to:

`/about/`

---

# 44. FOOTER

Use consistent Rupert logo.

Supporting line:

**Expert-managed investor outreach for founders raising capital.**

Links:

How It Works
Our Database
Articles
About
Book a Call
Privacy
Terms

RSS may remain but should be visually secondary.

Copyright:

**© Rupert 2026**

---

# 45. REMOVE / FIX THESE KNOWN ISSUES

Explicitly address all of these:

* inert Book a Call submit
* public photography placeholders
* Database image placeholder
* mobile nav wrapping
* Dori role “VP Content”
* inconsistent Dori bios
* inconsistent / unsupported statistics
* unsupported/fake testimonials
* broken sitemap
* indexable 404
* Person schema pointing to Team instead of About
* empty `sameAs`
* no default marketing OG image
* “client portal” copy if portal is not real/publicly part of service
* incomplete Fortune/Dagens media entries
* duplicated brand implementations
* CMS routes pointing to nonexistent homepage service anchor if public routing depends on this
* unused/dead CSS where safe to remove
* duplicate root image assets only if clearly unused and safe
* article prose width
* accessibility contrast problems

---

# 46. THINGS YOU MUST NOT DO

Do NOT:

* redesign Rupert as SaaS
* add dashboards
* add fake interface screenshots
* add AI language
* add gradients
* introduce purple/electric blue
* add dark mode
* add bold font weights
* add decorative animation
* add fake testimonials
* invent metrics
* invent client logos
* invent awards
* invent media coverage
* invent booking URLs
* invent APIs
* invent tracking IDs
* guarantee fundraising outcomes
* create competitor comparison tables
* change article URLs
* destroy the current editorial identity
* replace Astro with another framework

---

# 47. IMPLEMENTATION PRIORITY

If scope becomes large, prioritize in this exact order:

P0:

1. broken booking flow honesty/functionality
2. remove placeholders
3. unsupported testimonials/claims
4. broken sitemap
5. mobile navigation
6. role/content inconsistencies

P1:
7. homepage positioning/copy
8. homepage structure
9. design refinement
10. CTA consistency
11. About/How It Works/Database copy

P2:
12. schema
13. OG
14. accessibility
15. performance
16. internal linking
17. cleanup

---

# 48. QA

After implementation:

Run the full production build.

Check:

* build completes with no errors
* no broken internal links
* sitemap generated correctly
* robots references valid sitemap
* mobile menu works
* no horizontal mobile overflow
* Book a Call behavior is truthful and functional to the extent integrations allow
* no production placeholder copy remains
* no “VP Content”
* no unsupported testimonials
* no unsupported stats
* no client portal references unless real
* one homepage H1
* valid heading structure
* unique page titles/descriptions
* canonical URLs correct
* 404 noindex
* OG tags present
* schema valid JSON
* keyboard navigation works
* contrast improved
* reduced motion works
* images have appropriate alt text
* desktop and mobile layouts remain polished

Then provide me with:

1. a concise summary of changes
2. files modified
3. any claims/statistics you removed because they could not be verified
4. any external integration still needed, especially Book a Call
5. any decisions you could not safely make without owner input
6. build/test results
7. screenshots or browser captures if available

Do not stop after describing changes. Implement everything you can safely implement first.
