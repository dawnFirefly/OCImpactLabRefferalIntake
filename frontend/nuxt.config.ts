import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-17",
  devtools: { enabled: false },
  nitro: {
    ignore: ["**/local-demo/**"],
    cloudflare: {
      nodeCompat: true,
      wrangler: {
        name: "ocimpactlabrefferalintake",
        r2_buckets: [
          { binding: "REFERRAL_PDFS", bucket_name: "referralready" },
          { binding: "REFERRAL_PACKETS", bucket_name: "referralready" },
        ],
      },
    },
  },
  runtimeConfig: {
    anthropicApiKey: "",
    workspaceOrigin: "",
    cloudflareAccessTeamDomain: "",
    cloudflareAccessAudience: "",
    workspaceAllowedEmails: "",
    workspacePublicAccess: "",
    googleDrive: { clientId: "", clientSecret: "", refreshToken: "", folderId: "" },
    storageLimitGb: 9,
    // Pass 1 reads the PDF and locates facts; pass 2 links facts to admission criteria.
    claudeExtractionModel: "claude-haiku-5-5",
    claudeReviewModel: "claude-sonnet-5-5",
  },
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
