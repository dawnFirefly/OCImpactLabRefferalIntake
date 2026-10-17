<script setup lang="ts">
import { Button } from "@/components/ui/button";
const { applicants, addApplicant, selectApplicant } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
const name = ref("");
const adding = ref(false);
useHead({ title: "Applicants · ReferralReady" });
function add() {
  if (!name.value.trim()) return;
  addApplicant(name.value);
  name.value = "";
  adding.value = false;
}
function open(id: string) {
  selectApplicant(id);
  navigateTo("/processor");
}
function status(value: string) {
  return ({ demo: "Synthetic demo", mock_review: "Mock review ready", analyzed: "Claude reviewed", awaiting_pdf: "Needs PDF", awaiting_claude: "Awaiting analysis" } as Record<string, string>)[value] || "In review";
}
</script>

<template>
  <main class="skeleton-page">
    <div class="page-heading">
      <div><p class="eyebrow">01 · Applicants</p><h1>Applicant dashboard</h1><p>Choose an applicant to review their combined referral packet.</p></div>
      <Button @click="adding = !adding">Add applicant</Button>
    </div>
    <form v-if="adding" class="skeleton-card add-applicant" @submit.prevent="add">
      <label for="applicant-name">Applicant name or reference</label>
      <input id="applicant-name" v-model="name" required maxlength="120" placeholder="e.g. Demo applicant 03" />
      <Button type="submit" :disabled="!name.trim()">Create applicant</Button>
      <Button type="button" variant="outline" @click="adding = false">Cancel</Button>
    </form>
    <div class="applicant-list">
      <article v-for="applicant in applicants" :key="applicant.id" class="skeleton-card applicant-card">
        <div><h2>{{ applicant.title }}</h2><p>{{ applicant.documents[0]?.name || "No PDF attached" }}</p></div>
        <span class="status-label">{{ status(applicant.status) }}</span>
        <Button variant="outline" @click="open(applicant.id)">Open processor →</Button>
      </article>
    </div>
    <p class="skeleton-note">Demo workspace · applicants and changes last for this browser session.</p>
  </main>
</template>
