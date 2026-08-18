import type { ImageMetadata } from "astro";
import cornellTechLogo from "../assets/logos/cornell-tech.avif";

const logoFiles = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/logos/*.png",
  { eager: true },
);

const caseLogo = (file: string) => {
  const mod = logoFiles[`../assets/logos/${file}`];
  if (!mod) {
    throw new Error(`Missing logo asset: ${file}`);
  }
  return mod.default;
};

export interface CaseStudy {
  name: string;
  role: string;
  logo: ImageMetadata;
  body: string;
  href?: string;
  linkLabel?: string;
}

export const caseStudies: CaseStudy[] = [
  {
    name: "The Vets",
    role: "Founder & CEO",
    logo: caseLogo("the-vets.png"),
    body: "Founded and led The Vets, a tech-enabled pet healthcare company that later merged with BetterVet.",
  },
  {
    name: "Natrion",
    role: "Fractional CFO",
    logo: caseLogo("natrion.png"),
    body: "Served as Fractional CFO during Natrion's latest fundraise, working across financial planning, investor materials, and close.",
  },
  {
    name: "Snout",
    role: "Fractional CFO",
    logo: caseLogo("snout.png"),
    body: "Served as Fractional CFO on Snout's $100M financing round.",
    href: "https://www.crowdfundinsider.com/2026/02/259184-pet-care-financing-startup-snout-lands-100m-facility-raises-10m-series-a/",
    linkLabel: "$100M financing round",
  },
  {
    name: "BlueMark",
    role: "Fractional CFO",
    logo: caseLogo("bluemark.png"),
    body: "Serves as Fractional CFO of BlueMark, an impact-investment intelligence platform.",
  },
  {
    name: "Morgan Stanley",
    role: "Investment Banking Professional",
    logo: caseLogo("morgan-stanley.png"),
    body: "Advised technology and consumer companies on M&A, IPOs, and strategic financing — sitting in the rooms where a raise is judged on thesis fit, timing, and whether the story holds.",
  },
  {
    name: "Cornell Tech",
    role: "Mentor",
    logo: cornellTechLogo,
    body: "Mentors early-stage founders through Cornell Tech's Runway Startups Program.",
  },
  {
    name: "Yale",
    role: "Mentor",
    logo: caseLogo("yale.png"),
    body: "Mentors early-stage founders through Yale's Tsai CITY.",
  },
];
