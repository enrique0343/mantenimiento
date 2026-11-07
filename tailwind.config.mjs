/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#edf6f1",
          100: "#dceee3",
          200: "#bedeca",
          300: "#8dc8a8",
          400: "#55a780",
          500: "#288662",
          600: "#146447",
          700: "#11523c",
          800: "#153b2e",
          900: "#102c23",
        },
      },
    },
  },
  plugins: [],
};
