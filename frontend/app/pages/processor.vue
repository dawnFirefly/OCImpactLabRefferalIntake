<script setup lang="ts">
import { Button } from "@/components/ui/button";

useHead({ title: "Decision processor · ReferralReady" });
</script>

<template>
  <div>
    <DecisionProcessor />
    <div class="processor-next">
      <span>Summary structure is ready for the next step.</span>
      <Button as-child><NuxtLink to="/summary">Continue to summary →</NuxtLink></Button>
    </div>
  </div>
</template>
