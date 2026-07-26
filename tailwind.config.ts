import type { Config } from "tailwindcss";

// Tokens extracted from comanager-design (2026-07-23 design export).
// Do not hand-edit values from memory — re-extract from the source design
// file if the palette/typography/radius scale ever changes.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        green: "#013F32",
        "green-deep": "#0A2B22",
        accent: "#E7FE25",
        "accent-ink": "#161616",
        cream: "#FDFDFD",
        ink: "#161616",
        card: "#FFFFFF",
        // Status/semantic — named per comanager-design's fix for the dead
        // --blue/--yellow variables (those never get carried over as-is).
        red: "#E8697C",
        "red-ink": "#9C3F26",
        amber: "#E0A23B",
        "amber-ink": "#8A5D1E",
        success: "#37B788",
        "success-ink": "#1F5C54",
      },
      fontFamily: {
        display: ["'Baloo 2'", "sans-serif"],
        sans: ["Inter", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "10px",
        md: "12px",
        lg: "18px",
        xl: "20px",
        pill: "999px",
      },
    },
  },
  plugins: [],
};
export default config;
