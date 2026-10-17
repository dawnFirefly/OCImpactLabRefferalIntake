<script setup lang="ts">
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Clock, Inbox, MoreHorizontal, Pencil, Plus, Search, Trash2, XCircle } from "@lucide/vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Referral, ReviewStatus } from "~/types";
import { REVIEW_WINDOW_MS } from "~/composables/useReviewWorkspace";

const { applicants, selectApplicant, loadStoredApplicants, updateStoredApplicant, deleteStoredApplicant } =
  inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
useHead({ title: "Applicants · ReferralReady" });

const loading = ref(true);
const pageError = ref("");
const dialogOpen = ref(false);
const editingApplicant = ref<Referral | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  timer = setInterval(() => (now.value = Date.now()), 30_000);
  try {
    await loadStoredApplicants();
  } catch {
    pageError.value = "Stored applicants could not be loaded. Check that the server is running.";
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => clearInterval(timer));

const STATUS: Record<ReviewStatus, { label: string; class: string }> = {
  new: { label: "New", class: "bg-sky-50 text-sky-800 border-sky-200" },
  in_review: { label: "In review", class: "bg-violet-50 text-violet-800 border-violet-200" },
  needs_info: { label: "Needs info", class: "bg-amber-50 text-amber-800 border-amber-200" },
  approved: { label: "Approved", class: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  denied: { label: "Denied", class: "bg-red-50 text-red-700 border-red-200" },
  completed: { label: "Completed", class: "bg-muted text-muted-foreground border-border" },
};
const STATUS_ORDER: ReviewStatus[] = ["new", "in_review", "needs_info", "approved", "denied", "completed"];
/** Coordinator-recorded outcomes. These stop the review clock; nothing sets them automatically. */
const CLOSED: ReviewStatus[] = ["approved", "denied", "completed"];

type Row = Referral & { intake: NonNullable<Referral["intake"]> };
const stored = computed(() => applicants.value.filter((a): a is Row => !!a.intake));

const dueAt = (r: Row) => new Date(r.intake.receivedAt).getTime() + REVIEW_WINDOW_MS;
const isOpen = (r: Row) => !CLOSED.includes(r.intake.reviewStatus);
const remaining = (r: Row) => dueAt(r) - now.value;

function timeLeft(r: Row) {
  if (!isOpen(r)) return { label: "Done", tone: "text-muted-foreground" };
  const ms = remaining(r);
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h ? `${h}h ${m}m` : `${m}m`;
  if (ms < 0) return { label: `Overdue ${span}`, tone: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle };
  if (ms < 30 * 60_000) return { label: `${span} left`, tone: "bg-amber-50 text-amber-800 border-amber-200", icon: Clock };
  return { label: `${span} left`, tone: "bg-muted text-foreground border-border", icon: Clock };
}
function formatReceived(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(now.value).toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Summary counts (also act as quick filters)
const stats = computed(() => {
  const open = stored.value.filter(isOpen);
  return {
    open: open.length,
    dueSoon: open.filter((r) => remaining(r) >= 0 && remaining(r) < 30 * 60_000).length,
    overdue: open.filter((r) => remaining(r) < 0).length,
    approved: stored.value.filter((r) => r.intake.reviewStatus === "approved").length,
    denied: stored.value.filter((r) => r.intake.reviewStatus === "denied").length,
  };
});

// Filters and sorting
const search = ref("");
const statusFilter = ref("all");
const priorityFilter = ref("all");
const sortBy = ref("due");
const filtersActive = computed(() => !!search.value || statusFilter.value !== "all" || priorityFilter.value !== "all");
/** Summary cards act as toggles: clicking the active card goes back to all referrals. */
function toggleCard(key: string) {
  statusFilter.value = statusFilter.value === key ? "all" : key;
}
function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  priorityFilter.value = "all";
}
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = stored.value.filter((r) => {
    const s = r.intake.reviewStatus;
    if (statusFilter.value === "open" && !isOpen(r)) return false;
    if (statusFilter.value === "closed" && isOpen(r)) return false;
    if (statusFilter.value === "overdue" && !(isOpen(r) && remaining(r) < 0)) return false;
    if (statusFilter.value === "due_soon" && !(isOpen(r) && remaining(r) >= 0 && remaining(r) < 30 * 60_000)) return false;
    if (STATUS_ORDER.includes(statusFilter.value as ReviewStatus) && s !== statusFilter.value) return false;
    if (priorityFilter.value !== "all" && r.intake.priority !== priorityFilter.value) return false;
    if (!q) return true;
    return [r.title, r.documents[0]?.name, r.intake.source, r.intake.reviewer, r.intake.contact]
      .some((v) => v?.toLowerCase().includes(q));
  });
  const received = (r: Row) => new Date(r.intake.receivedAt).getTime();
  const compare: Record<string, (a: Row, b: Row) => number> = {
    // Open referrals by deadline first; closed ones sink to the bottom.
    due: (a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || dueAt(a) - dueAt(b),
    newest: (a, b) => received(b) - received(a),
    oldest: (a, b) => received(a) - received(b),
    name: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
    priority: (a, b) => Number(b.intake.priority === "urgent") - Number(a.intake.priority === "urgent") || dueAt(a) - dueAt(b),
    status: (a, b) => STATUS_ORDER.indexOf(a.intake.reviewStatus) - STATUS_ORDER.indexOf(b.intake.reviewStatus) || dueAt(a) - dueAt(b),
  };
  return list.sort(compare[sortBy.value]);
});

// Row actions
async function setStatus(r: Row, status: unknown) {
  try {
    await updateStoredApplicant(r.id, { reviewStatus: status as ReviewStatus });
  } catch {
    pageError.value = `Could not update the status of "${r.title}".`;
  }
}
function addApplicant() {
  editingApplicant.value = null;
  dialogOpen.value = true;
}
function edit(r: Row) {
  editingApplicant.value = r;
  dialogOpen.value = true;
}
const pendingDelete = ref<Row | null>(null);
const deleteOpen = computed({
  get: () => !!pendingDelete.value,
  set: (value) => { if (!value) pendingDelete.value = null; },
});
async function confirmDelete() {
  const r = pendingDelete.value;
  pendingDelete.value = null;
  if (!r) return;
  try {
    await deleteStoredApplicant(r.id);
  } catch {
    pageError.value = `Could not delete "${r.title}".`;
  }
}
function open(r: Referral) {
  // Opening a new referral starts its review.
  if (r.intake?.reviewStatus === "new") setStatus(r as Row, "in_review");
  selectApplicant(r.id);
  navigateTo("/processor");
}
</script>

<template>
  <main class="mx-auto w-full max-w-[1240px] px-6 py-10">
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="intake-title">Referral intake</h1>
        <p class="mt-1 text-muted-foreground">Each referral should be reviewed within 2 hours of being received.</p>
      </div>
      <Button size="lg" @click="addApplicant"><Plus class="size-4" />Add applicant</Button>
    </div>

    <section class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Summary">
      <Card
        v-for="card in [
          { key: 'open', label: 'Open referrals', value: stats.open, icon: Inbox, tone: 'text-foreground' },
          { key: 'due_soon', label: 'Due within 30 min', value: stats.dueSoon, icon: Clock, tone: 'text-amber-700' },
          { key: 'overdue', label: 'Overdue', value: stats.overdue, icon: AlertTriangle, tone: 'text-red-700' },
          { key: 'approved', label: 'Approved', value: stats.approved, icon: CheckCircle2, tone: 'text-emerald-700' },
          { key: 'denied', label: 'Denied', value: stats.denied, icon: XCircle, tone: 'text-red-700' },
        ]"
        :key="card.key"
        role="button"
        tabindex="0"
        :aria-pressed="statusFilter === card.key"
        class="cursor-pointer gap-2 py-4 shadow-none transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
        :class="statusFilter === card.key ? 'border-ring ring-2 ring-ring/30' : ''"
        @click="toggleCard(card.key)"
        @keydown.enter.space.prevent="toggleCard(card.key)"
      >
        <CardHeader class="px-4">
          <CardDescription class="text-xs font-medium">{{ card.label }}</CardDescription>
          <CardAction><component :is="card.icon" class="size-4" :class="card.tone" /></CardAction>
        </CardHeader>
        <CardContent class="px-4">
          <CardTitle class="text-2xl font-semibold tabular-nums" :class="card.tone">{{ card.value }}</CardTitle>
        </CardContent>
      </Card>
    </section>

    <Alert v-if="pageError" variant="destructive" class="mb-4">
      <AlertCircle />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ pageError }}</AlertDescription>
    </Alert>

    <Card class="gap-0 py-0 shadow-none">
      <CardHeader class="flex flex-wrap items-center gap-3 border-b p-4 [.border-b]:pb-4">
        <div class="relative min-w-[220px] flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" class="pl-9" placeholder="Search name, file, facility, reviewer…" aria-label="Search applicants" />
        </div>
        <Select v-model="statusFilter">
          <SelectTrigger class="w-[170px]" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All referrals</SelectItem>
            <SelectItem value="open">All open</SelectItem>
            <SelectItem value="closed">All closed</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="due_soon">Due within 30 min</SelectItem>
            <SelectItem v-for="s in STATUS_ORDER" :key="s" :value="s">{{ STATUS[s].label }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="priorityFilter">
          <SelectTrigger class="w-[150px]" aria-label="Filter by priority"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="routine">Routine</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="sortBy">
          <SelectTrigger class="w-[190px]" aria-label="Sort applicants"><span class="text-muted-foreground">Sort:</span><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="due">Due soonest</SelectItem>
            <SelectItem value="newest">Newest received</SelectItem>
            <SelectItem value="oldest">Oldest received</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="name">Name A–Z</SelectItem>
          </SelectContent>
        </Select>
        <Button v-if="filtersActive" variant="ghost" size="sm" @click="clearFilters">Clear filters</Button>
      </CardHeader>

      <CardContent class="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-5">Applicant</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Time to review</TableHead>
              <TableHead>Referring facility</TableHead>
              <TableHead>Reviewer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead class="pr-5 text-right"><span class="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in rows" :key="r.id">
              <TableCell class="pl-5">
                <div class="flex items-center gap-2">
                  <Button variant="link" class="h-auto p-0 font-medium text-foreground" @click="open(r)">{{ r.title }}</Button>
                  <Badge v-if="r.intake.priority === 'urgent'" variant="outline" class="border-red-200 bg-red-50 text-red-700">Urgent</Badge>
                </div>
                <div class="max-w-[260px] truncate text-xs text-muted-foreground">{{ r.documents[0]?.name }}</div>
              </TableCell>
              <TableCell class="whitespace-nowrap">{{ formatReceived(r.intake.receivedAt) }}</TableCell>
              <TableCell>
                <Badge v-if="isOpen(r)" variant="outline" :class="timeLeft(r).tone">
                  <component :is="timeLeft(r).icon" />{{ timeLeft(r).label }}
                </Badge>
                <span v-else class="text-muted-foreground">Done</span>
              </TableCell>
              <TableCell class="max-w-[180px] truncate">{{ r.intake.source || "—" }}</TableCell>
              <TableCell>{{ r.intake.reviewer || "—" }}</TableCell>
              <TableCell>
                <Select :model-value="r.intake.reviewStatus" @update:model-value="setStatus(r, $event)">
                  <SelectTrigger size="sm" class="w-[130px] rounded-full" :class="STATUS[r.intake.reviewStatus].class" :aria-label="`Status for ${r.title}`">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="s in STATUS_ORDER" :key="s" :value="s">{{ STATUS[s].label }}</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell class="pr-5">
                <div class="flex items-center justify-end gap-1">
                  <Button variant="outline" size="sm" @click="open(r)">Review<ArrowRight class="size-3.5" /></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" :aria-label="`More actions for ${r.title}`"><MoreHorizontal class="size-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @select="edit(r)"><Pencil />Edit details</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" @select="pendingDelete = r"><Trash2 />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="!rows.length" class="hover:bg-transparent">
              <TableCell colspan="7" class="py-14 text-center">
                <template v-if="loading">Loading applicants…</template>
                <template v-else-if="!stored.length">
                  <Inbox class="mx-auto mb-3 size-8 text-muted-foreground" />
                  <div class="font-medium">No applicants yet</div>
                  <p class="mt-1 text-muted-foreground">Add a referral packet PDF to start the 2-hour review clock.</p>
                  <Button class="mt-4" @click="addApplicant"><Plus class="size-4" />Add applicant</Button>
                </template>
                <template v-else>
                  <div class="font-medium">No applicants match these filters</div>
                  <Button class="mt-3" variant="outline" size="sm" @click="clearFilters">Clear filters</Button>
                </template>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>

    </Card>

    <ApplicantIntakeDialog v-model:open="dialogOpen" :applicant="editingApplicant" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ pendingDelete?.title }}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the applicant and their stored referral PDF. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="confirmDelete">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>
</template>

<style scoped>
/* Page-scoped: the global h1 rule in main.css would otherwise override utilities. */
.intake-title { font-size: 26px; font-weight: 600; letter-spacing: -0.5px; margin: 0; }
</style>
