<script setup lang="ts">
import { FileText, Upload, X } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Referral } from "~/types";
import { REVIEW_WINDOW_MS, type IntakeInput } from "~/composables/useReviewWorkspace";

/** Add (with PDF upload) or edit (details only) a stored applicant. */
const props = defineProps<{ applicant?: Referral | null }>();
const open = defineModel<boolean>("open", { required: true });
const { createStoredApplicant, updateStoredApplicant } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;

const editing = computed(() => !!props.applicant?.intake);
const file = shallowRef<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const saving = ref(false);
const error = ref("");
const form = reactive({ name: "", receivedAt: "", source: "", contact: "", priority: "routine", reviewer: "", notes: "" });

/** `datetime-local` works in local time without a zone; convert both ways. */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const dueLabel = computed(() => {
  const received = new Date(form.receivedAt);
  if (Number.isNaN(received.getTime())) return "";
  return new Date(received.getTime() + REVIEW_WINDOW_MS).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  const intake = props.applicant?.intake;
  Object.assign(form, {
    name: intake ? props.applicant!.title : "",
    receivedAt: toLocalInput(intake?.receivedAt ? new Date(intake.receivedAt) : new Date()),
    source: intake?.source || "",
    contact: intake?.contact || "",
    priority: intake?.priority || "routine",
    reviewer: intake?.reviewer || "",
    notes: intake?.notes || "",
  });
  file.value = null;
  error.value = "";
}, { immediate: true });

function pick(files: FileList | null | undefined) {
  error.value = "";
  const list = Array.from(files || []);
  if (!list.length) return;
  if (list.length !== 1) return void (error.value = "Choose one combined referral PDF per applicant.");
  const chosen = list[0]!;
  if (!chosen.name.toLowerCase().endsWith(".pdf")) return void (error.value = "The file must be a PDF.");
  if (chosen.size > 50 * 1024 * 1024) return void (error.value = "PDF must be 50 MB or smaller.");
  file.value = chosen;
  if (!form.name.trim()) form.name = chosen.name.replace(/\.pdf$/i, "");
}
function clearFile() {
  file.value = null;
  if (fileInput.value) fileInput.value.value = "";
}
function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

const canSave = computed(() => !!form.name.trim() && (editing.value || !!file.value) && !saving.value);
async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = "";
  const received = new Date(form.receivedAt);
  const fields: IntakeInput = {
    ...form,
    name: form.name.trim(),
    priority: form.priority as IntakeInput["priority"],
    receivedAt: Number.isNaN(received.getTime()) ? undefined : received.toISOString(),
  };
  try {
    if (editing.value) await updateStoredApplicant(props.applicant!.id, fields);
    else await createStoredApplicant(fields, file.value!);
    open.value = false;
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || "Could not save. Try again.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[620px] max-h-[92vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ editing ? "Edit applicant details" : "Add applicant" }}</DialogTitle>
        <DialogDescription>
          {{ editing ? "Update intake details. The stored referral PDF is not changed." : "Upload the combined referral packet. Review is due 2 hours after the referral was received." }}
        </DialogDescription>
      </DialogHeader>

      <form id="intake-form" class="grid gap-5" @submit.prevent="save">
        <div v-if="!editing" class="grid gap-2">
          <Label>Referral packet PDF <span class="text-destructive">*</span></Label>
          <div v-if="file" class="flex items-center gap-3 rounded-lg border bg-muted px-4 py-3">
            <FileText class="size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ file.name }}</div>
              <div class="text-xs text-muted-foreground">{{ size(file.size) }} · PDF</div>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove file" @click="clearFile"><X class="size-4" /></Button>
          </div>
          <label
            v-else
            class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center transition-colors hover:bg-muted"
            :class="dragging ? 'border-primary bg-muted' : ''"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="dragging = false; pick($event.dataTransfer?.files)"
          >
            <input ref="fileInput" type="file" accept="application/pdf,.pdf" class="sr-only" @change="pick(($event.target as HTMLInputElement).files)" />
            <Upload class="size-5 text-muted-foreground" />
            <span class="font-medium">Click to choose or drag the PDF here</span>
            <span class="text-xs text-muted-foreground">One combined PDF per applicant · up to 50 MB</span>
          </label>
        </div>

        <div class="grid gap-2">
          <Label for="intake-name">Applicant name or reference <span class="text-destructive">*</span></Label>
          <Input id="intake-name" v-model="form.name" maxlength="120" placeholder="e.g. R01 or patient initials + DOB" />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="intake-received">Referral received</Label>
            <Input id="intake-received" v-model="form.receivedAt" type="datetime-local" />
            <p v-if="dueLabel" class="text-xs text-muted-foreground">Review due {{ dueLabel }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="intake-priority">Priority</Label>
            <Select v-model="form.priority">
              <SelectTrigger id="intake-priority" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="routine">Routine</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-2">
            <Label for="intake-source">Referring facility</Label>
            <Input id="intake-source" v-model="form.source" maxlength="80" placeholder="e.g. UCI Medical Center" />
          </div>
          <div class="grid gap-2">
            <Label for="intake-contact">Referrer contact</Label>
            <Input id="intake-contact" v-model="form.contact" maxlength="80" placeholder="Name, phone or email" />
          </div>
          <div class="grid gap-2 sm:col-span-2">
            <Label for="intake-reviewer">Assigned reviewer</Label>
            <Input id="intake-reviewer" v-model="form.reviewer" maxlength="60" placeholder="Who is reviewing this referral" />
          </div>
        </div>

        <div class="grid gap-2">
          <Label for="intake-notes">Notes</Label>
          <Textarea id="intake-notes" v-model="form.notes" maxlength="2000" rows="3" placeholder="Anything the reviewer should know" />
        </div>

        <p v-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{{ error }}</p>
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="saving" @click="open = false">Cancel</Button>
        <Button type="submit" form="intake-form" :disabled="!canSave">
          {{ saving ? (editing ? "Saving…" : "Uploading…") : editing ? "Save changes" : "Add applicant" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
