import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // TNT's own CLI theme: #0052D9 (light theme) / #5AC8FA (dark theme)
        accent: {
          DEFAULT: "#0052D9",
          deep: "#0043B8",
          light: "#5AC8FA",
        },
      },
    },
  },
  plugins: [],
};
export default config;
