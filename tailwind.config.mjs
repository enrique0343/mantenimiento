// Sistema Visual Avante v2.0. La aplicación entera hereda de aquí: las escalas de
// Tailwind se reasignan a la paleta institucional para que ninguna pantalla pueda
// salirse de ella. Los fondos de estado (50, 100) son neutros a propósito: el color
// de alerta vive en el texto y en marcas pequeñas, nunca de fondo.
const MARINO = "#1E2142";
const AZUL = "#23417D";
const AZUL_CL = "#3372B5";
const AZUL_TN = "#8FB1D6";
const TINTA = "#1A1A1A";
const TINTA2 = "#4A4A4A";
const REF = "#6B7280";
const PAPEL = "#E5E8EF";
const PANEL = "#F2F4F7";
const FILETE = "#BDC6D8";
const ROJO = "#C03435";
const VERDE = "#1F5740";
const AMBAR = "#A27628";
// Ámbar para texto pequeño: el institucional da 3.7:1 sobre panel.
const AMBAR_TEXTO = "#8A6420";

const neutro = {
  50: PANEL, 100: PAPEL, 200: "#D3D9E5", 300: FILETE, 400: REF, 500: TINTA2, 600: TINTA2, 700: TINTA, 800: TINTA, 900: TINTA, 950: TINTA,
};
const familiaAzul = {
  50: PANEL, 100: PANEL, 200: FILETE, 300: AZUL_TN, 400: AZUL_CL, 500: AZUL_CL, 600: AZUL, 700: AZUL, 800: MARINO, 900: MARINO, 950: MARINO,
};
const familiaVerde = {
  50: PANEL, 100: PANEL, 200: FILETE, 300: FILETE, 400: VERDE, 500: VERDE, 600: VERDE, 700: VERDE, 800: VERDE, 900: VERDE, 950: VERDE,
};
const familiaAmbar = {
  50: PANEL, 100: PANEL, 200: FILETE, 300: FILETE, 400: AMBAR, 500: AMBAR, 600: AMBAR, 700: AMBAR_TEXTO, 800: AMBAR_TEXTO, 900: AMBAR_TEXTO, 950: AMBAR_TEXTO,
};
const familiaRojo = {
  50: PANEL, 100: PANEL, 200: FILETE, 300: FILETE, 400: ROJO, 500: ROJO, 600: ROJO, 700: ROJO, 800: ROJO, 900: ROJO, 950: ROJO,
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Figtree", "Segoe UI", "Arial", "sans-serif"],
        mono: ["Figtree", "Segoe UI", "Arial", "sans-serif"],
      },
      fontWeight: {
        medium: "600",
        semibold: "600",
        bold: "600",
        extrabold: "700",
        black: "700",
      },
      colors: {
        marino: MARINO,
        azul: AZUL,
        papel: PAPEL,
        panel: PANEL,
        filete: FILETE,
        tinta: TINTA,
        black: TINTA,
        slate: neutro, gray: neutro, zinc: neutro, neutral: neutro, stone: neutro,
        brand: familiaAzul, blue: familiaAzul, sky: familiaAzul, indigo: familiaAzul, cyan: familiaAzul, purple: familiaAzul, violet: familiaAzul, fuchsia: familiaAzul, pink: familiaAzul,
        emerald: familiaVerde, green: familiaVerde, teal: familiaVerde, lime: familiaVerde,
        amber: familiaAmbar, yellow: familiaAmbar, orange: familiaAmbar,
        red: familiaRojo, rose: familiaRojo,
      },
      borderRadius: {
        none: "0", sm: "2px", DEFAULT: "2px", md: "2px", lg: "2px", xl: "2px", "2xl": "2px", "3xl": "2px",
      },
      boxShadow: {
        sm: "none", DEFAULT: "none", md: "none", lg: "none", xl: "none", "2xl": "none", inner: "none",
      },
    },
  },
  plugins: [],
};
