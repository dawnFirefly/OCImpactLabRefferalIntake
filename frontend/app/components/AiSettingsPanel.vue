<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultModels, type AiProvider } from "#shared/ai";
const settings = useAiSettings();
const notice = ref("");
const testing = ref(false);
function changeProvider(provider: unknown) {
  settings.value = { provider: provider as AiProvider, apiKey: "", accountId: "", ...defaultModels[provider as AiProvider] };
  notice.value = "";
}
async function testConnection() {
  testing.value = true;
  notice.value = "";
  try {
    await $fetch("/api/ai/test", { method: "POST", headers: {
      "x-ai-provider": settings.value.provider, "x-ai-key": settings.value.apiKey,
      "x-ai-account": settings.value.accountId, "x-ai-extraction-model": settings.value.extractionModel,
      "x-ai-review-model": settings.value.reviewModel,
    } });
    notice.value = "Connected. Document and model limits are checked during analysis.";
  } catch (error: any) { notice.value = error?.data?.statusMessage || "Connection failed. Check the provider, model, and credentials."; }
  finally { testing.value = false; }
}
</script>
<template>
  <details class="rounded-lg border bg-card p-4">
    <summary class="cursor-pointer font-medium">AI settings · {{ settings.provider === 'cloudflare' ? 'Cloudflare Workers AI (default)' : settings.provider === 'anthropic' ? 'Anthropic' : 'OpenCode Zen' }}</summary>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <div class="grid gap-2"><Label for="ai-provider">Provider</Label>
        <Select :model-value="settings.provider" @update:model-value="changeProvider"><SelectTrigger id="ai-provider" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="cloudflare">Cloudflare Workers AI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="opencode">OpenCode Zen</SelectItem></SelectContent>
        </Select>
      </div>
      <div class="grid gap-2"><Label for="ai-key">Your API key (optional with server credentials)</Label>
        <Input id="ai-key" v-model="settings.apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="Kept only in this open session" maxlength="512" />
      </div>
      <div v-if="settings.provider === 'cloudflare'" class="grid gap-2"><Label for="ai-account">Cloudflare account ID (for your own key)</Label><Input id="ai-account" v-model="settings.accountId" autocomplete="off" maxlength="32" /></div>
      <div class="grid gap-2"><Label for="ai-extraction">Extraction model {{ settings.provider === 'opencode' ? '(must support images and chat completions)' : '' }}</Label><Input id="ai-extraction" v-model="settings.extractionModel" maxlength="150" /></div>
      <div class="grid gap-2"><Label for="ai-review">Review model</Label><Input id="ai-review" v-model="settings.reviewModel" maxlength="150" /></div>
      <p class="text-sm text-muted-foreground sm:col-span-2">Cloudflare uses the deployed Workers AI binding by default. Keys are sent only to this app’s server for the provider you select. Refreshing clears your key. Cloudflare and OpenCode read rendered page images (up to 60 pages); the original PDF stays stored with the applicant.</p>
      <div class="flex gap-2 sm:col-span-2"><Button variant="outline" :disabled="testing" @click="testConnection">{{ testing ? 'Testing…' : 'Test connection' }}</Button><Button variant="ghost" @click="settings.apiKey = ''; notice = 'API key cleared.'">Clear key</Button></div>
      <p v-if="notice" role="status" class="text-sm sm:col-span-2">{{ notice }}</p>
    </div>
  </details>
</template>
