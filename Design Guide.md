# Design Guide

## Brand identity

**Name:** Rupert
**Domain:** heyrupert.com
**Tagline (implied):** Quiet expertise. Every investor, every conversation, yours.

**Intended feel:** A senior Wall Street operator who left banking to help founders — understated, precise, and completely on your side. Warmer and more human than a pure finance-institution feel, without tipping into consumer-startup energy.

**Mission:** To bring the discipline and craft of institutional dealmaking to founder-led fundraising, without the opacity, the cut, or the middleman dynamic.

**Values:**
- Transparency over black-box automation
- Relationship ownership belongs to the founder
- Quality and precision over volume and speed
- Expertise earned in real transactions, not SaaS dashboards
- Quiet confidence — no hype, no hustle-culture posturing

**Emotional goal for visitors:** A founder landing on heyrupert.com should feel immediate relief. *Someone who actually knows what they're doing is going to handle this with me, not for me, and nothing will be hidden.* The anxiety of fundraising should drop a notch.

**Reference brands (aesthetic and tonal parallels):**
- **Stripe** (documentation era) — precision, quiet competence, developer-grade trust
- **Peel** or **Fathom Analytics** — restrained SaaS that signals seriousness by removing noise
- **The Economist** — confident editorial voice, no exclamation marks, earns authority through specificity
- **A top-tier law firm's website** — white space, weight of credentials, nothing garish
- **Brightwood Capital** — structural reference for warmth and a single confident accent color used sparingly, not for tone (Rupert stays more restrained than Brightwood's copy voice)

**Anti-references (what Rupert is explicitly not):**
- Foundersuite, ProRaise, SeriesA.ai — software-tool feel, feature grids, growth-hacker energy
- Qubit Capital — bold gradient hero, VC-glamour aesthetics, AI-forward copy
- Generic accelerator websites with rocket-ship emoji and "🚀 Let's scale your startup!" copy

---

## Color palette

**Mode:** Light mode only. Dark mode would undermine the clean, trustworthy, document-quality feel that differentiates Rupert from automation-heavy competitors.

**Contrast target:** WCAG AA minimum throughout; WCAG AAA for all body text on white backgrounds, given the professional positioning.

**Revision note:** This palette replaces the previous Brass/Parchment system. Sage green is now the sole accent, used exactly where Brass used to sit — CTAs, links, dividers, pull-quote marks. Ink is retained for headings and the logo (not as an accent) because a fully green-and-white system loses the "institutional" weight the brand still needs; Ink is what keeps this from reading as a wellness or consumer-lifestyle brand. The result should feel like Brightwood's warmth grafted onto Rupert's restraint, not a full pivot to a consumer palette.

| Token | Name | Hex | Usage |
|---|---|---|---|
| `--color-primary` | Sage | `#5C7A5E` | Primary CTA buttons, links, key UI anchors |
| `--color-primary-hover` | Sage Dark | `#476148` | Button hover states |
| `--color-primary-tint` | Sage Pale | `#E6EDE3` | Tinted section backgrounds, badge fills, pull-quote panels — use sparingly, as punctuation not paint |
| `--color-secondary` | Slate | `#4A5568` | Secondary buttons, supporting UI |
| `--color-heading` | Ink | `#1A1A2E` | All headings, logo mark, nav text |
| `--color-body` | Charcoal | `#2D2D2D` | All body copy |
| `--color-background` | Linen | `#FAF9F5` | Page background — warm off-white with a faint sage undertone, not clinical, not green-tinted enough to read as "themed" |
| `--color-surface` | White | `#FFFFFF` | Cards, modals, inset content panels |
| `--color-border` | Smoke | `#E4E4DE` | All ruled lines, card borders, input borders |
| `--color-muted` | Ash | `#8A8A8A` | Meta text, captions, timestamps, labels |
| `--color-success` | Moss | `#2F6B4F` | Confirmation states, campaign sent, reply received — a distinct, deeper green than Sage so success states don't compete visually with primary CTAs |
| `--color-warning` | Amber | `#C07C2A` | Non-blocking alerts |
| `--color-error` | Cinnabar | `#C0392B` | Destructive actions, validation errors |

**Palette rationale:** Sage replaces Brass as the brand's single accent color, applied with the same discipline — selectively, never as a background wash. It reads as calm and grounded rather than "finance gold," softening Rupert toward approachable without sacrificing seriousness. Ink is retained specifically as the headline/heading color (not demoted to an accent) because a green-and-white-only palette starts to feel like a consumer wellness brand; Ink is what keeps the institutional weight. The background shifts from Parchment to Linen — barely perceptible, but warm enough to sit comfortably next to the new green rather than competing with it. Moss is introduced as a distinct, deeper green specifically for success/confirmation states, so a "reply received" indicator never gets mistaken for a CTA button.

**What did not change:** Ink for headings, Charcoal for body, Slate for secondary UI, Amber and Cinnabar for warning/error. These were never part of the black-and-white read the redesign is solving for — they're neutral-to-functional, not part of the "minimalistic" problem.

---

## Typography

**Typeface philosophy:** Inter exclusively — the founder explicitly requested it. Used at fine weights to convey precision and restraint. Bold weights are never used anywhere on the site.

**Font stack:**
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
```
Load via Google Fonts or self-host from Bunny Fonts: weights 300, 400, 500 only. Never load 600, 700, 800, or 900.

**Monospace (for email previews, investor pipeline data, code-like contexts):**
```css
font-family: 'IBM Plex Mono', 'Courier New', monospace;
```
Weight: 400 only. Use sparingly — exclusively for campaign preview snippets, investor ID strings, and pipeline metrics.

**Weight rules (absolute):**
- `300` (Light) — display headings, large pull quotes
- `400` (Regular) — all body text, meta, labels, navigation
- `500` (Medium) — the only permissible emphasis weight; used for subheadings, inline link labels, button text, and field labels
- **Bold (600+) is forbidden site-wide**

**Type scale:**

| Step | Size | Line-height | Weight | Usage |
|---|---|---|---|---|
| `display` | 56px | 1.1 | 300 | Hero headline, single per page |
| `h1` | 40px | 1.2 | 300 | Page-level headings |
| `h2` | 28px | 1.3 | 400 | Section headings |
| `h3` | 20px | 1.4 | 500 | Subsection headings, service titles |
| `h4` | 16px | 1.5 | 500 | Card headers, sidebar headings |
| `body-lg` | 18px | 1.7 | 400 | Hero body copy, key value proposition paragraphs |
| `body` | 16px | 1.7 | 400 | Standard body text throughout |
| `body-sm` | 14px | 1.6 | 400 | Captions, meta, footnotes, form help text |
| `label` | 12px | 1.4 | 500 | All-caps labels at 0.08em tracking |
| `mono` | 13px | 1.6 | 400 | Campaign previews, pipeline data |

**Letter-spacing:** Headlines at `display` and `h1` size use `letter-spacing: -0.02em` for refinement. Body is `0`. Labels are `0.08em` and uppercase.

**Italic use:** Permitted sparingly for founder quotes, investor names in prose, and the company name "Rupert" when used mid-sentence.

---

## Spacing & layout

**Base unit:** `8px`. All spacing values are multiples of 8 (or half-steps of 4 where needed for tight UI elements).

**Common spacing tokens:**
```
4px   — xs  (inline chip gaps, tight list items)
8px   — sm  (between label and field, icon padding)
16px  — md  (intra-component gaps, paragraph spacing)
24px  — lg  (between cards, section-internal gaps)
40px  — xl  (between major content blocks)
64px  — 2xl (section-to-section vertical breathing room)
96px  — 3xl (hero padding top/bottom)
```

**Max container width:** `1160px` — wide enough for substance, narrow enough to feel curated. Centered with `auto` margins.

**Max article / prose width:** `680px` — for all long-form copy, blog posts, bio text, and service descriptions. Never let body paragraphs span the full container.

**Grid:** 12-column with `24px` gutters at desktop, collapsing to a 4-column / `16px` gutter grid on mobile. Most layouts use 6+6 or 8+4 splits; avoid 12-wide stretches for text.

**Breakpoints:**
```
sm  — 480px   (single-column mobile)
md  — 768px   (tablet, 2-column begins)
lg  — 1024px  (desktop layout unlocks)
xl  — 1280px  (max-width container fully visible)
```

**Vertical rhythm:** Sections breathe. Padding above and below each major section is never less than `64px` at desktop, `40px` on mobile. White space is not wasted space — it is signal.

**Navigation:** Minimal top bar, maximum height `64px`. Logo left, 3–4 nav links center or right, single CTA button. No mega-menus. No dropdowns if avoidable.

---

## Imagery & photography

**Photography direction:**
Photos, where used, should feel like editorial documentary photography — candid, slightly desaturated, natural light. Think: a founder at a whiteboard late in the afternoon, a quiet office with a document on the desk, a one-on-one meeting across a small table. No staged group shots. No stock-handshake imagery. No glass-and-steel office stock photos.

**Color treatment:** All photography is run through a warm matte treatment — lifted blacks, slightly reduced saturation, +10–15 warmth. The result should feel consistent with the new Linen background palette, not jarring against it. Do not push a green color-grade onto photography to "match the brand" — the sage accent lives in UI elements, not in photo treatment.

**Subjects appropriate for Rupert:**
- Founders working — reading documents, on calls, writing
- Paper, notebooks, printed decks (analog signals trust and craft)
- One-to-one conversation settings (not group brainstorm rooms)
- Architectural detail — a window, a desk corner, a hallway — to suggest environment without showing people if no strong image is available

**What to avoid:**
- Rocket ships, growth charts, upward arrows as imagery themes
- Handshakes (especially stock)
- Overcrowded team photos
- Bright colorful office culture shots
- Any image that reads "startup pitch deck filler"

**Iconography:**
Use a single consistent line-icon set — **Lucide** is the preferred library (consistent with Inter's geometric neutrality). Stroke weight: `1.5px`. Size: `20px` inline, `24px` standalone. Never fill icons. Never mix icon families. Icons may use `--color-primary` (Sage) for active/selected states; default state is Ink or Ash.

**Illustration:** None. Rupert does not use illustration. If a concept needs visual support and no photograph fits, use a refined typographic treatment or ruled line instead.

**Logo / brand mark:** The wordmark "Rupert" should be set in Inter 300 (Light) with slight negative tracking (`-0.02em`), in Ink. No icons or marks are needed beyond the logotype. If a favicon or app icon is required, use the letterform "R" in Ink on Linen — no rounded square, no gradient fill, no green favicon (Ink stays the brand-mark color even though Sage is the UI accent).

---

## Tone, voice & motion

**Tone adjectives:** Measured. Precise. Candid. Earned. Calm.

**Voice model:** A former investment banker who became a founder and now helps other founders — speaks with specificity and experience, never hype. Sounds like a trusted advisor who has been in the room, not a marketer who has read about it.

**Voice do:**
- Use specific, concrete language: "investors who have backed fintech companies at the pre-seed stage" not "top investors"
- Short declarative sentences for key claims: "Every reply comes to you." "We take no percentage of your raise."
- Acknowledge the difficulty of fundraising without catastrophizing or inflating stakes
- Use "you" and "founders" — center the founder's agency throughout
- Trust the reader's intelligence; never explain what a term sheet is unless asked
- Reference real mechanics: thesis alignment, sequenced follow-up, intro ownership

**Proof & stats — what's allowed:**
- **Activity/process stats are fine:** campaigns run, funds in the database, meetings booked historically, replies received historically. These describe what Rupert *does*, not what a prospect will *get*.
- **Outcome stats about a specific prospect's future results are never fine:** no "founders raise $X with us," no "expect N meetings in 90 days," no implied guarantee dressed up as an average. Same rule as "never promise outcomes," made explicit because competitor sites (Qubit Capital, Waveup, Fundraisly) normalize this so heavily it's easy to copy by accident.
- Historical aggregate stats about Rupert/Dori himself (e.g. "$100M+ raised," "50+ startups backed") are activity/track-record stats, not promises — they stay.

**Voice don't:**
- Never use exclamation marks in body copy or headings
- Never use "game-changing," "rocket fuel," "supercharge," "unlock," "🚀," or any startup-hype vocabulary
- Do not use second-person imperative in hero copy ("Start your raise today!") — prefer declarative positioning ("Rupert manages your investor outreach with the precision of an experienced operator")
- Avoid passive voice where a specific subject can be named
- Do not use the phrase "we believe in founders" or any empty mission-speak
- Never write in plural first person ("we are here to help") when singular specificity is stronger ("Dori built Rupert to…")

**Motion:**
Keep motion minimal and purposeful. This is a professional services product, not a consumer app.

- **Page transitions:** None. Full-page transitions are distracting.
- **Hover states:** `150ms ease` opacity or border-color shifts on links and buttons. Subtle.
- **Scroll reveals:** Single-direction fade-up (`opacity 0 → 1`, `translateY 12px → 0`) over `400ms ease-out`. Trigger once. No bounce, no spring physics.
- **No:** parallax, background particle systems, animated gradients, typing effects, counters counting up, or any motion that draws attention to itself.
- **Reduced motion:** Respect `prefers-reduced-motion: reduce` — disable all transforms and transitions.

---

## Explicit anti-patterns

The following are explicitly prohibited for Rupert across all touchpoints — site, collateral, email templates, and pitch materials.

1. **Purple or electric blue as any color** — these are generic SaaS/VC-pitch colors that signal automation and distance, the opposite of Rupert's positioning.

2. **Bold type anywhere** — the typography specification is Inter 300/400/500 only. Bold weights undermine the restrained, precise register the brand requires.

3. **Dark mode design** — the Linen-and-Ink palette is load-bearing for the "professional document" feeling. A dark version would look like every other fintech tool.

4. **Gradient fills or glassmorphism** — no gradient backgrounds, gradient text, or frosted-glass UI panels. These read as generic 2022–2024 startup visual language.

5. **Feature comparison tables with competitor names** — Rupert is a service, not a product. Positioning via feature matrix undercuts the operator quality being sold.

6. **Stock-handshake or stock-boardroom photography** — referenced above in imagery; worth repeating here as a categorical no.

7. **Countdown timers, urgency signals, or scarcity language** — ("Only 3 spots left this month!") — patronizing in this context and destroys the trust the brand is built on.

8. **Testimonial carousels with headshots in circles** — use testimonials as editorial pull quotes, not as social-proof widgets.

9. **AI-forward language** — Rupert's entire value proposition is human expertise and judgment. Any framing that implies or celebrates automation ("AI-powered," "intelligent outreach engine") directly contradicts the product.

10. **Emoji in any public-facing copy** — not in headlines, not in body text, not in CTAs, not in email subject lines.

11. **"We" as the first word of a hero headline** — hero copy should center the founder, not the company: "Your investor relationships, managed with the discipline of an experienced operator" not "We help founders raise capital."

12. **Multi-step animated onboarding tours or interactive demos that simulate software** — Rupert is a managed service. Simulating a software product experience misrepresents what is being purchased.

13. **Typing/typewriter text effects and counters that count up on scroll** — already implicitly covered under Motion, called out directly here because the current live hero uses a typewriter effect and this must be corrected in the redesign, not just avoided going forward.

14. **Outcome-promising stats about what a prospect will personally get** ("expect N meetings," "founders raise $X with us") — see "Proof & stats" under Voice. The single most common pattern across competitor sites (Qubit Capital, Waveup, Fundraisly) and the easiest one to absorb by accident.

15. **Green as a background wash, gradient, or dominant field color** — Sage is an accent, applied the way Brass used to be: buttons, links, dividers, tinted panels used sparingly. A page that reads as "the green site" has overcorrected; the base palette is still Linen-and-Ink with sage as punctuation, not the reverse.

**Design Abstract:** Rupert is a founder-facing fundraising advisory brand built around a single emotional register: quiet, institutional competence, warmed slightly by a considered accent color. The visual identity is anchored in a warm-neutral light palette — Linen (`#FAF9F5`) as the page background, White (`#FFFFFF`) for card surfaces, and Smoke (`#E4E4DE`) for all ruled lines and borders. Headings and the logo remain in Ink (`#1A1A2E`), a deep navy-black chosen to evoke institutional finance without defaulting to a clichéd bank blue, and to keep the brand from reading as a consumer-lifestyle product once green enters the palette. The sole accent is Sage (`#5C7A5E`), applied selectively to CTAs, links, dividers, and pull-quote marks — it reads as calm and grounded rather than "finance gold," softening Rupert toward approachable without sacrificing seriousness. Supporting neutrals are Slate (`#4A5568`) for secondary UI, Charcoal (`#2D2D2D`) for body text, and Ash (`#8A8A8A`) for meta and captions; Moss (`#2F6B4F`), a deeper, distinct green, is reserved for success/confirmation states so they never compete visually with a primary CTA. The overall tonal impression is a high-quality printed financial document, warmed at the edges — unhurried, credible, and slightly more human than before.

Typography is Inter exclusively, loaded at weights 300, 400, and 500 only — bold weights (600 and above) are categorically forbidden. Display headings run at 56px / weight 300 / `letter-spacing: -0.02em`; H1 at 40px / 300; section headings (H2) at 28px / 400; subheadings (H3–H4) at 20–16px / 500. Body copy is 16–18px / 400 / line-height 1.7. Labels are 12px / 500 / uppercase / `letter-spacing: 0.08em`. IBM Plex Mono at 400 appears only in pipeline data, investor IDs, and email preview contexts. The restraint in weight is load-bearing: it produces the measured, precise register the brand requires and distinguishes Rupert from feature-grid SaaS competitors.

Distinctive visual patterns worth reusing: editorial pull quotes styled with Sage accent marks rather than blockquote boxes; thin `1.5px`-stroke Lucide line icons at 20–24px, never filled; photography treated with a warm matte grade (lifted blacks, reduced saturation, +10–15 warmth) to harmonize with the Linen background; and generous vertical breathing room (64px minimum between major sections at desktop). The grid is 12-column with a 1160px max container and a 680px prose-width cap — text never spans full container width. All motion is minimal: 150ms hover transitions, single-direction fade-up scroll reveals at 400ms ease-out, and no parallax, gradients, or animated effects of any kind. No illustration, no dark mode, no gradients, no emoji, no bold type, no green backgrounds — these are not stylistic preferences but explicit categorical prohibitions that define the brand's boundaries as precisely as its palette does.
