<script setup lang="ts">
import { Button } from "@/components/ui/button";
const { referral } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
useHead({ title: "Summary · ReferralReady" });
</script>

<template>
  <main class="skeleton-page">
    <div class="page-heading"><div><p class="eyebrow">03 · Summary</p><h1>Referral summary</h1><p>{{ referral.title }}</p></div><span class="status-label">Placeholder</span></div>
    <div class="summary-sections">
      <section class="skeleton-card"><h2>Review summary</h2><p>The analysis overview will appear here.</p></section>
      <section class="skeleton-card"><h2>Items needing attention</h2><p>Unresolved information and supporting explanations will appear here.</p></section>
      <section class="skeleton-card"><h2>Recommended changes</h2><p>Coordinator next steps will appear here.</p></section>
    </div>
    <div class="page-actions"><Button as-child variant="outline"><NuxtLink to="/processor">← Back to processor</NuxtLink></Button><Button as-child><NuxtLink to="/">Back to applicants</NuxtLink></Button></div>
  </main>
</template>
