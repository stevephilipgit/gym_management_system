/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Montserrat", "system-ui", "sans-serif"],
        display: ["Montserrat", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Enhanced responsive font sizes
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};
