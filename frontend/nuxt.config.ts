import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-17",
  devtools: { enabled: false },
  modules: ["shadcn-nuxt"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    // Server-only. Set NUXT_GOOGLE_DRIVE_* to store packets in Google Drive;
    // otherwise uploads are kept on local disk in .data/referrals.
    googleDrive: { clientId: "", clientSecret: "", refreshToken: "", folderId: "" },
  },
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
