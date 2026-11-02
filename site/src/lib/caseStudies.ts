import type { ImageMetadata } from "astro";
import cornellTechLogo from "../assets/logos/cornell-tech.png";

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
    body: "Founded and led The Vets, which later merged with BetterVet.",
  },
  {
    name: "BlueMark",
    role: "Fractional CFO",
    logo: caseLogo("bluemark.png"),
    body: "Fractional CFO at BlueMark, an impact-investment intelligence platform.",
  },
  {
    name: "Natrion",
    role: "Fractional CFO",
    logo: caseLogo("natrion.png"),
    body: "Fractional CFO through Natrion's latest fundraise, from planning to close.",
  },
  {
    name: "Snout",
    role: "Fractional CFO",
    logo: caseLogo("snout.png"),
    body: "Fractional CFO on Snout's $100M financing round.",
    href: "https://www.crowdfundinsider.com/2026/02/259184-pet-care-financing-startup-snout-lands-100m-facility-raises-10m-series-a/",
    linkLabel: "$100M financing round",
  },
  {
    name: "Cornell Tech",
    role: "Startups mentor",
    logo: cornellTechLogo,
    body: "Mentors founders in Cornell Tech's Runway Startups Program.",
  },
  {
    name: "Yale",
    role: "Startups mentor",
    logo: caseLogo("yale.png"),
    body: "Mentors early-stage founders through Yale's Tsai CITY.",
  },
  {
    name: "Morgan Stanley",
    role: "Investment Banking",
    logo: caseLogo("morgan-stanley.png"),
    body: "Advised tech and consumer companies on M&A, IPOs and financing.",
  },
  {
    name: "Translucent AI",
    role: "Fractional CFO",
    logo: caseLogo("translucent-ai.png"),
    body: "Fractional CFO at Translucent AI.",
  },
  {
    name: "Ambi Robotics",
    role: "Capital advisor",
    logo: caseLogo("ambi-robotics.png"),
    body: "Fundraising and strategic finance advisor to Ambi Robotics.",
  },
  {
    name: "Manatee",
    role: "Capital advisor",
    logo: caseLogo("manatee.png"),
    body: "Fundraising and strategic finance advisor to Manatee.",
  },
  {
    name: "Sniffi",
    role: "Advisor",
    logo: caseLogo("sniffi.png"),
    body: "Advisor to Sniffi in India.",
  },
  {
    name: "Swift Vets",
    role: "Advisor",
    logo: caseLogo("swift-vets.png"),
    body: "Advisor to Swift Vets in Australia.",
  },
];
