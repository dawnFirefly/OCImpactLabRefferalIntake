<script setup lang="ts">
import { Button } from "@/components/ui/button";
const { referral, analyzing, error } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
const route = useRoute();
const summaryReady = computed(() => route.path === "/processor" &&
  referral.value.status === "analyzed" && !!referral.value.recommendation &&
  !analyzing.value && !error.value);
</script>

<template>
  <div class="app-shell" :class="{ 'processor-shell': route.path === '/processor' }">
    <header class="app-nav">
      <NuxtLink to="/" class="brand">ReferralReady</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/" exact-active-class="current">Applicants</NuxtLink>
        <NuxtLink to="/processor" active-class="current">Decision processor</NuxtLink>
        <NuxtLink to="/summary" active-class="current">Summary</NuxtLink>
      </nav>
      <div v-if="summaryReady" class="summary-ready">
        <span>Analysis is ready for summary.</span>
        <Button as-child><NuxtLink to="/summary">Continue to summary →</NuxtLink></Button>
      </div>
    </header>
    <slot />
  </div>
</template>
