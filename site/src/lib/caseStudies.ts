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
  logo: ImageMetadata;
  body: string;
  href?: string;
  linkLabel?: string;
}

export const caseStudies: CaseStudy[] = [
  {
    name: "The Vets",
    logo: caseLogo("the-vets.png"),
    body: "Founded and led The Vets, a tech-enabled pet healthcare company that later merged with BetterVet.",
  },
  {
    name: "Natrion",
    logo: caseLogo("natrion.png"),
    body: "Served as Fractional CFO during Natrion's latest fundraise.",
  },
  {
    name: "Snout",
    logo: caseLogo("snout.png"),
    body: "Served as Fractional CFO on Snout's $100M financing round.",
    href: "https://www.crowdfundinsider.com/2026/02/259184-pet-care-financing-startup-snout-lands-100m-facility-raises-10m-series-a/",
    linkLabel: "$100M financing round",
  },
  {
    name: "BlueMark",
    logo: caseLogo("bluemark.png"),
    body: "Serves as CFO of BlueMark, an impact-investment intelligence platform.",
  },
  {
    name: "Morgan Stanley",
    logo: caseLogo("morgan-stanley.png"),
    body: "Investment Banking Professional",
  },
  {
    name: "Cornell Tech",
    logo: cornellTechLogo,
    body: "Mentors early-stage founders through Cornell Tech's Runway Startups Program.",
  },
  {
    name: "Yale",
    logo: caseLogo("yale.png"),
    body: "Mentors early-stage founders through Yale's Tsai CITY.",
  },
];
