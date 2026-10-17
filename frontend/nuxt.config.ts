import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-17",
  devtools: { enabled: false },
  modules: ["shadcn-nuxt"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    // Server-only. On Cloudflare, packets go to R2 (see nitro.cloudflare below). Elsewhere, set
    // NUXT_GOOGLE_DRIVE_* to store packets in Google Drive;
    // otherwise uploads are kept on local disk in .data/referrals.
    googleDrive: { clientId: "", clientSecret: "", refreshToken: "", folderId: "" },
    // Upload cap in GB across all stored PDFs (NUXT_STORAGE_LIMIT_GB). 9 GB stays under R2's free 10 GB.
    storageLimitGb: 9,
  },
  nitro: {
    cloudflare: {
      // Used by the Cloudflare build (Workers Builds generates wrangler.json from this).
      // Uploaded packets are stored in the private R2 bucket "referralready".
      wrangler: {
        name: "ocimpactlabrefferalintake",
        r2_buckets: [{ binding: "REFERRAL_PACKETS", bucket_name: "referralready" }],
      },
    },
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
