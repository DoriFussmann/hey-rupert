import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      sm: "480px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: "#5C7A5E",
          hover: "#476148",
          tint: "#E6EDE3",
        },
        secondary: "#4A5568",
        heading: "#1A1A2E",
        body: "#2D2D2D",
        background: "#FAF9F5",
        surface: "#FFFFFF",
        border: "#E4E4DE",
        muted: {
          DEFAULT: "#8A8A8A",
          text: "#8A8A8A",
        },
        success: "#2F6B4F",
        warning: "#C07C2A",
        error: "#C0392B",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: ["var(--font-mono)", "IBM Plex Mono", "Courier New", "monospace"],
      },
      fontWeight: {
        light: "300",
        normal: "400",
        medium: "500",
        semibold: "500",
        bold: "500",
      },
      fontSize: {
        display: [
          "56px",
          { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "300" },
        ],
        h1: [
          "40px",
          { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "300" },
        ],
        h2: ["28px", { lineHeight: "1.3", fontWeight: "400" }],
        h3: ["20px", { lineHeight: "1.4", fontWeight: "500" }],
        h4: ["16px", { lineHeight: "1.5", fontWeight: "500" }],
        "body-lg": ["18px", { lineHeight: "1.7", fontWeight: "400" }],
        body: ["16px", { lineHeight: "1.7", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "1.6", fontWeight: "400" }],
        label: [
          "12px",
          { lineHeight: "1.4", letterSpacing: "0.08em", fontWeight: "500" },
        ],
        mono: ["13px", { lineHeight: "1.6", fontWeight: "400" }],
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "40px",
        "2xl": "64px",
        "3xl": "96px",
      },
      borderRadius: {
        card: "8px",
      },
      maxWidth: {
        container: "1160px",
        prose: "680px",
      },
      letterSpacing: {
        headline: "-0.02em",
        label: "0.08em",
      },
      transitionDuration: {
        hover: "150ms",
      },
    },
  },
  plugins: [],
};

export default config;
