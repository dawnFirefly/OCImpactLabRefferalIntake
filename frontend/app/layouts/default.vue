<script setup lang="ts">
import { Button } from "@/components/ui/button";
const { referral, analyzing, error, flushSaves } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
const route = useRoute();
const applicantQuery = computed(() => referral.value.id.startsWith("stored-") ? { applicant: referral.value.id } : {});
const router = useRouter();
let removeGuard: (() => void) | undefined;
onMounted(() => { removeGuard = router.beforeEach(async () => { try { await flushSaves(); return true; } catch { return false; } }); });
onBeforeUnmount(() => removeGuard?.());
const summaryReady = computed(() => route.path === "/processor" &&
  referral.value.status === "analyzed" && !!referral.value.recommendation &&
  !analyzing.value && !error.value);
</script>

<template>
  <div class="app-shell" :class="{ 'processor-shell': route.path === '/processor' }">
    <header class="app-nav">
      <NuxtLink to="/" class="brand">Referral Intake</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/" exact-active-class="current">Applicants</NuxtLink>
        <NuxtLink :to="{ path: '/processor', query: applicantQuery }" active-class="current">Decision processor</NuxtLink>
        <NuxtLink :to="{ path: '/summary', query: applicantQuery }" active-class="current">Summary</NuxtLink>
      </nav>
      <div v-if="summaryReady" class="summary-ready">
        <span>Analysis is ready for summary.</span>
        <Button as-child><NuxtLink :to="{ path: '/summary', query: applicantQuery }">Continue to summary →</NuxtLink></Button>
      </div>
    </header>
    <slot />
  </div>
</template>
