<script setup lang="ts">
const workspace = useReviewWorkspace();
provide("review-workspace", workspace);
</script>

<template>
  <NuxtLayout><NuxtPage /></NuxtLayout>
</template>
