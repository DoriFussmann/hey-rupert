/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts}"],
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
          DEFAULT: "#1A1A2E",
          hover: "#11111F",
          tint: "#F3F1EC",
        },
        secondary: "#4A5568",
        accent: {
          DEFAULT: "#B5935A",
          text: "#7A5C28",
        },
        background: "#FAF9F7",
        surface: "#FFFFFF",
        border: "#E4E2DE",
        muted: {
          DEFAULT: "#5C5C5C",
          text: "#5C5C5C",
        },
        heading: "#1A1A2E",
        foreground: "#2D2D2D",
        success: "#2F6B4F",
        warning: "#C07C2A",
        error: "#C0392B",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: ["IBM Plex Mono", "Courier New", "monospace"],
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
        reveal: "250ms",
      },
      transitionTimingFunction: {
        hover: "ease",
        reveal: "ease-out",
      },
    },
  },
};
