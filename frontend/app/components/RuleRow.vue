<script setup lang="ts">
import { Check, Minus, AlertCircle, X } from "@lucide/vue";
import type { Rule } from "../types";

/** One requirement card. `id="rule-…"` is the anchor nodes scroll to and output wires attach to. */
defineProps<{ rule: Rule; detail: string; showNote: boolean; active: boolean; flash: boolean }>();
defineEmits<{ inspect: [rule: Rule] }>();
const uncertain = (status: string) => ["uncertain", "conflicting", "redacted", "questioned", "concern"].includes(status);
</script>

<template>
  <button
    :id="`rule-${rule.id}`"
    class="rule-row"
    :class="{ flash, active, pending: rule.status === 'pending', unreviewed: rule.status === 'not_reviewed', missing: ['missing', 'not_met'].includes(rule.status), uncertain: uncertain(rule.status) }"
    @click="$emit('inspect', rule)"
  >
    <div style="min-width: 0">
      <div class="rule-id">{{ rule.id }}<span v-if="rule.superseded_by"> · superseded by {{ rule.superseded_by }}</span></div>
      <span class="rule-text">{{ rule.text }}</span>
      <p v-if="showNote && rule.note" class="tiny muted">{{ rule.note }}</p>
      <div class="rule-state" :class="rule.status">{{ detail }}</div>
    </div>
    <Check v-if="rule.status === 'met'" :size="13" class="rule-symbol" />
    <X v-else-if="rule.status === 'not_met'" :size="13" class="rule-symbol" />
    <AlertCircle v-else-if="rule.status === 'concern' || uncertain(rule.status)" :size="13" class="rule-symbol" />
    <Minus v-else :size="12" class="rule-symbol" />
  </button>
</template>
