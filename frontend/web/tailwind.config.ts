import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f0fdf4",
          100: "#dcfce7",
          400: "#00d47e",
          500: "#00a85e",
          600: "#007a44",
          700: "#005c33",
        },
        surface: {
          DEFAULT: "#06090f",
          raised:  "#080d17",
          card:    "#0b1120",
          el:      "#0e1628",
          border:  "#152034",
          strong:  "#1e3148",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
