import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-17",
  devtools: { enabled: false },
  modules: ["shadcn-nuxt"],
  css: ["~/assets/css/main.css"],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: "", componentDir: "./app/components/ui" },
  app: {
    head: {
      title: "ReferralReady · Decision factors",
      meta: [
        {
          name: "description",
          content: "Source-linked referral decision-factor review.",
        },
      ],
    },
  },
});
