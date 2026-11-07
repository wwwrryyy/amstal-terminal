/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{svelte,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        terminal: "#0A0E17",
        surface: "#111622",
        surfaceActive: "#182030",
        borderSubtle: "#1E2638",
        borderFocus: "#FF9E00",
        textPrimary: "#E2E8F0",
        textMuted: "#64748B",
        amber: "#FF9E00",
        cyan: "#00D2FF",
        green: "#00E676",
        crimson: "#FF3366",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'SF Mono'", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
