<script setup lang="ts">
const { referral } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
</script>

<template>
  <div class="app-shell">
    <header class="app-nav">
      <NuxtLink to="/" class="brand">ReferralReady</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/" exact-active-class="current">Applicants</NuxtLink>
        <NuxtLink to="/processor" active-class="current">Decision processor</NuxtLink>
        <NuxtLink to="/summary" active-class="current">Summary</NuxtLink>
      </nav>
      <span class="active-applicant">{{ referral.title }}</span>
    </header>
    <slot />
  </div>
</template>
