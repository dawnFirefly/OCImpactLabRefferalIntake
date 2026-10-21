import { makeAnalysisProvider, type AnalysisProgress, type AnalysisPreview } from "../services/analysis";
import { uploadPacket } from "../services/storage";
import { createR01Mock } from "../data/r01Mock";
import { createDemo } from "../data/demo";
import type { Referral, Fact, Rule, PacketDocument, Intake, AnalysisMeta } from "../types";
import { createDemoPdf } from "../lib/demoPdf";
import { criteriaPrecedence, criteriaSource, unreviewedRules } from "#shared/decision-tree";
import type { Workspace } from "#shared/workspace";
import { maxPacketBytes } from "#shared/upload-limits";

/** The full staged rubric with no findings: Application review shows every criterion before analysis. */
function rubric(status: "not_reviewed" | "pending" = "not_reviewed"): Referral["checklist"] {
  return { precedence: criteriaPrecedence, source_url: criteriaSource, rules: unreviewedRules().map((r) => ({ ...r, status })), counts: {} };
}

/** Applicant packet persisted by the server (`server/api/applicants`). */
export type StoredPacket = Intake & {
  id: string;
  name: string;
  fileName: string;
  storage: "local" | "google_drive" | "r2";
};
/** Editable intake fields sent to the server on create/update. */
export type IntakeInput = Partial<Pick<StoredPacket, "name" | "receivedAt" | "source" | "contact" | "priority" | "reviewer" | "notes" | "reviewStatus">>;
/** Review deadline: two hours after the referral was received. */
export const REVIEW_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Root workspace: persistent applicants and browser-only synthetic examples. */
export function useReviewWorkspace() {
  const referral = ref<Referral>(createDemo());
  const aiSettings = useAiSettings();
  const route = useRoute();
  const router = useRouter();
  const saveStates = ref(new Map<string, "saving" | "saved" | "error">());
  const saveErrors = ref(new Map<string, string>());
  const revisions = new Map<string, number>();
  const loaded = new Set<string>();
  const saves = new Map<string, Promise<void>>();
  const dirty = new Set<string>();
  const saveState = computed(() => saveStates.value.get(referral.value.id));
  const saveError = computed(() => saveErrors.value.get(referral.value.id) || "");
  function saveWorkspace(current = referral.value): Promise<void> {
    if (!current.id.startsWith("stored-") || current.status === "analyzing" || !loaded.has(current.id)) return Promise.resolve();
    const id = current.id;
    const snapshot = JSON.parse(JSON.stringify(current));
    dirty.add(id);
    saveStates.value = new Map(saveStates.value).set(id, "saving");
    const previous = saves.get(id) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      try {
        const result = await $fetch<Workspace>(`/api/applicants/${encodeURIComponent(packetId(id))}/workspace`, {
          method: "PUT", body: { revision: revisions.get(id) || 0, referral: snapshot },
        });
        revisions.set(id, result.revision);
        if (current.intake && current.status === "analyzed") current.intake.analysis = analysisMeta(current);
        if (saves.get(id) === job) {
          dirty.delete(id);
          saveStates.value = new Map(saveStates.value).set(id, "saved");
          saveErrors.value = new Map(saveErrors.value).set(id, "");
        }
      } catch (failure: any) {
        saveStates.value = new Map(saveStates.value).set(id, "error");
        saveErrors.value = new Map(saveErrors.value).set(id, failure?.data?.statusMessage || "The review could not be saved. Your changes remain in this tab. Retry before leaving.");
        throw failure;
      }
    });
    saves.set(id, job);
    return job;
  }
  const retrySave = () => saveWorkspace().catch(() => {});
  function saveLayout(layout: NonNullable<Referral["graphLayout"]>) {
    if (referral.value.status === "analyzing") return;
    referral.value.graphLayout = layout;
    void saveWorkspace().catch(() => {});
  }
  async function flushSaves() { if (dirty.size) await Promise.all([...saves.values()]); }
  function beforeLeave(event: BeforeUnloadEvent) {
    if (dirty.size) { event.preventDefault(); event.returnValue = ""; }
  }
  async function restoreRouteApplicant() {
    if (!["/processor", "/summary"].includes(route.path)) return;
    const id = typeof route.query.applicant === "string" ? route.query.applicant : sessionStorage.getItem("referral-active-id");
    if (!id?.startsWith("stored-")) return;
    if (!applicants.value.some(a => a.id === id)) await loadStoredApplicants();
    const desired = typeof route.query.applicant === "string" ? route.query.applicant : sessionStorage.getItem("referral-active-id");
    if (desired !== id) return;
    if (!applicants.value.some(a => a.id === id)) { error.value = "This applicant is unavailable or was deleted."; return; }
    if (referral.value.id !== id) await selectApplicant(id);
    else await loadStoredAnalysis(referral.value);
  }
  watch(() => [route.path, route.query.applicant], () => { if (import.meta.client) void restoreRouteApplicant().catch(() => { error.value = "The saved applicant could not be loaded. Please retry from the dashboard."; }); });
  const applicants = ref<Referral[]>([]);
  const error = ref("");
  const patientName = ref("");
  const analyzing = ref(false);
  const savingPdf = ref(false);
  let uploadController: AbortController | null = null;
  const progress = ref<AnalysisProgress | null>(null);
  const filesByApplicant = new Map<string, File>();
  const namesByApplicant = new Map<string, string>();
  let controller: AbortController | null = null;
  /** Workspace before a running analysis; restored if it fails or is cancelled. */
  let beforeAnalysis: Referral | null = null;
  async function sourceFile(current: Referral, signal: AbortSignal): Promise<File> {
    const attached = filesByApplicant.get(current.id);
    if (attached) return attached;
    const document = current.documents[0];
    // Provided local packets and server-stored applicant PDFs can be fetched for analysis.
    if (!document?.local_url?.match(/^\/local-demo\/R\d{2}\.pdf$|^\/api\/applicants\/[^/]+\/pdf$/)) throw new Error("Attach a PDF first.");
    const response = await fetch(document.local_url, { signal });
    if (!response.ok) throw new Error("The local PDF is unavailable. Attach it again.");
    const blob = await response.blob();
    if (blob.size > maxPacketBytes) throw new Error("Choose a PDF up to 50 MB.");
    return new File([blob], document.name, { type: "application/pdf" });
  }
  async function savePdf() {
    const current = referral.value;
    const document = current.documents[0];
    if (savingPdf.value || analyzing.value || !document || document.storage || mode.value === "synthetic") return;
    const request = new AbortController();
    uploadController = request;
    savingPdf.value = true;
    error.value = "";
    try {
      const file = await sourceFile(current, request.signal);
      const stored = await uploadPacket(file, request.signal);
      document.storage = stored;
    } catch (failure) {
      if (!request.signal.aborted && referral.value.id === current.id) {
        error.value = failure instanceof Error ? failure.message : "The PDF could not be saved. Please retry.";
      }
    } finally {
      if (uploadController === request) { uploadController = null; savingPdf.value = false; }
    }
  }
  function restoreBeforeAnalysis() {
    if (beforeAnalysis && referral.value.status === "analyzing" && referral.value.id === beforeAnalysis.id) {
      referral.value = beforeAnalysis;
      rememberApplicant();
    }
    beforeAnalysis = null;
  }
  function cancelAnalysis() {
    controller?.abort();
    controller = null;
    analyzing.value = false;
    progress.value = null;
    restoreBeforeAnalysis();
  }
  /** A provisional workspace that fills with streamed, unvalidated nodes while Claude writes. */
  function startPreview(current: Referral, name: string) {
    const source = current.documents[0];
    beforeAnalysis = current;
    referral.value = {
      id: current.id, title: name, intake: current.intake, status: "analyzing", revision: current.revision,
      documents: [{ id: "source-pdf", name: source?.name || "applicant.pdf", page_count: source?.page_count ?? null, status: "analyzing", error: null, pages: [], local_url: source?.local_url, storage: source?.storage }],
      sections: [], facts: [], evidence: [], error: null, audit: [],
      checklist: rubric("pending"),
    };
  }
  function applyPreview(event: AnalysisPreview) {
    const live = referral.value;
    if (live.status !== "analyzing") return;
    if (event.type === "section") live.sections!.push(event.section);
    else if (event.type === "fact") { live.facts.push(event.fact); live.evidence.push(...event.evidence); }
    else if (event.type === "criteria") live.checklist.rules = event.rules;
    else if (event.type === "rule") {
      const rule = live.checklist.rules.find((r) => r.id === event.rule.id);
      if (!rule) return;
      Object.assign(rule, event.rule);
      for (const fact of live.facts) if (rule.fact_ids.includes(fact.id) && !fact.rule_ids.includes(rule.id)) fact.rule_ids.push(rule.id);
    } else if (event.stage === "extracting") { live.sections = []; live.facts = []; live.evidence = []; }
    else {
      live.checklist.rules.forEach((r) => Object.assign(r, { status: "pending", fact_ids: [], note: "" }));
      live.facts.forEach((f) => { f.rule_ids = []; });
    }
  }
  async function analyze() {
    if (analyzing.value || savingPdf.value) return;
    const current = referral.value;
    if (dirty.has(current.id)) { error.value = "Save your pending review changes before analyzing again."; return; }
    if (current.audit.some(a => a.type === "fact_review" || a.type === "rule_review")) { error.value = "This packet has coordinator edits. Add a separate applicant to reanalyze without replacing the saved review."; return; }
    // The name is optional: Claude reads it from the PDF. When given, it is checked against the packet.
    const name = patientName.value.trim();
    error.value = "";
    if (name) namesByApplicant.set(current.id, name);
    if (backgroundIds.value.has(current.id)) return;
    analyzing.value = true;
    const request = new AbortController();
    controller = request;
    try {
      const handlers = {
        onProgress: (update: AnalysisProgress) => { if (controller === request) progress.value = update; },
        onPreview: (event: AnalysisPreview) => { if (controller === request) applyPreview(event); },
      };
      let result: Referral;
      if (isStored(current)) {
        // The server reads the stored PDF and saves the result with the applicant.
        startPreview(current, name || current.title);
        result = await makeAnalysisProvider(aiSettings.value).analyzeStored(packetId(current.id), name, handlers, request.signal);
      } else {
        const file = await sourceFile(current, request.signal);
        startPreview(current, name || current.title);
        result = await makeAnalysisProvider(aiSettings.value).analyze(file, name, handlers, request.signal);
      }
      if (request.signal.aborted || referral.value.id !== current.id) return;
      beforeAnalysis = null;
      if (isStored(current)) {
        referral.value = current; // leave the provisional preview before swapping in the saved result
        applyStoredResult(current, result);
        return;
      }
      result.id = current.id;
      // Keep coordinator intake details (received time, status) for stored applicants.
      result.intake = current.intake;
      if (current.intake) result.title = current.title;
      result.documents[0]!.local_url = current.documents[0]?.local_url;
      result.documents[0]!.storage = current.documents[0]?.storage;
      referral.value = result;
      rememberApplicant();
    } catch (failure) {
      if (request.signal.aborted) return;
      restoreBeforeAnalysis();
      error.value = failure instanceof Error ? failure.message : "Analysis failed. Try again.";
    } finally {
      if (controller === request) { analyzing.value = false; progress.value = null; controller = null; }
    }
  }
  const attachedFiles = shallowRef<File[]>([]);
  const mode = ref<"synthetic" | "provided" | "attached">("synthetic");
  const providedDocuments = ref<PacketDocument[]>([]);
  const objectUrls: string[] = [];
  function installDemoPreviews() {
    for (const document of referral.value.documents) {
      const url = URL.createObjectURL(
        createDemoPdf(document, referral.value.evidence),
      );
      document.local_url = url;
      objectUrls.push(url);
    }
  }
  function rememberApplicant() {
    const index = applicants.value.findIndex((a) => a.id === referral.value.id);
    if (index === -1) applicants.value.push(referral.value);
    else applicants.value[index] = referral.value;
  }
  async function selectApplicant(id: string) {
    const applicant = applicants.value.find((a) => a.id === id);
    if (!applicant) return;
    cancelAnalysis();
    referral.value = applicant;
    if (import.meta.client) {
      if (isStored(applicant)) sessionStorage.setItem("referral-active-id", id);
      else sessionStorage.removeItem("referral-active-id");
    }
    patientName.value = namesByApplicant.get(id) || (applicant.status === "analyzed" || applicant.status === "awaiting_pdf" ? applicant.title : "");
    mode.value = id === "synthetic-demo" ? "synthetic" : id.startsWith("provided-") ? "provided" : "attached";
    error.value = "";
    await loadStoredAnalysis(applicant, true);
  }
  function addApplicant(name: string) {
    cancelAnalysis();
    patientName.value = name.trim();
    referral.value = {
      id: crypto.randomUUID(), title: name.trim(), status: "awaiting_pdf", revision: 0,
      documents: [], facts: [], evidence: [], error: null, audit: [],
      checklist: rubric(),
    };
    mode.value = "attached";
    namesByApplicant.set(referral.value.id, name.trim());
    rememberApplicant();
    return referral.value.id;
  }
  /** Persist the original PDF and intake first; analysis never owns the only copy. */
  async function createApplicantForAnalysis(fields: IntakeInput, file: File) {
    const record = await createStoredApplicant({ ...fields, reviewStatus: fields.reviewStatus || "in_review" }, file);
    await selectApplicant(record.id);
    if (["/processor", "/summary"].includes(route.path)) await router.replace({ path: "/processor", query: { applicant: record.id } });
    void analyze();
    return record.id;
  }
  // ── Stored applicants: background analysis and saved results ───────────────
  const isStored = (r: Referral) => r.id.startsWith("stored-");
  const packetId = (id: string) => id.replace(/^stored-/, "");
  /** Applicants being analyzed in the background, and the last background error per applicant. */
  const backgroundIds = ref(new Set<string>());
  const backgroundErrors = ref(new Map<string, string>());
  const queue: string[] = [];
  let queueRunning = false;
  function analysisMeta(result: Referral): AnalysisMeta {
    const rec = result.recommendation;
    return { analyzedAt: new Date().toISOString(), outcome: rec?.outcome ?? null, stage: rec?.stage ?? null, recommendation: rec?.status ?? null };
  }
  /** Swap a stored applicant's record for its analyzed result, keeping its name, intake and PDF link. */
  function applyStoredResult(record: Referral, result: Referral, meta = analysisMeta(result)) {
    result.id = record.id;
    result.title = record.title;
    result.intake = record.intake ? { ...record.intake, analysis: result.status === "analyzed" ? meta : record.intake.analysis } : undefined;
    if (result.status === "analyzed") revisions.set(record.id, result.revision);
    loaded.add(record.id);
    if (result.documents[0]) result.documents[0].local_url = record.documents[0]?.local_url;
    const index = applicants.value.findIndex((a) => a.id === record.id);
    if (index !== -1) applicants.value[index] = result;
    if (referral.value.id === record.id && referral.value.status !== "analyzing") referral.value = result;
    return result;
  }
  /** Restore the complete saved graph, including edits and layout, once per session. */
  async function loadStoredAnalysis(record: Referral, refresh = false) {
    if (!isStored(record) || (!refresh && loaded.has(record.id)) || dirty.has(record.id)) return;
    const saved = await $fetch<Workspace | null>(`/api/applicants/${encodeURIComponent(packetId(record.id))}/workspace`);
    revisions.set(record.id, saved?.revision || 0);
    loaded.add(record.id);
    const latest = applicants.value.find(a => a.id === record.id);
    if (saved && latest && !dirty.has(record.id) && latest.status !== "analyzing") {
      applyStoredResult(latest, saved.referral, latest.intake?.analysis);
      revisions.set(record.id, saved.revision);
      saveStates.value = new Map(saveStates.value).set(record.id, "saved");
    }
  }
  /** Queue a stored applicant for analysis; runs one at a time (the server allows one analysis). */
  function analyzeInBackground(id: string) {
    if (!queue.includes(id) && !backgroundIds.value.has(id)) queue.push(id);
    void runQueue();
  }
  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (queue.length) {
        const id = queue.shift()!;
        const record = applicants.value.find((a) => a.id === id);
        if (!record || record.status === "analyzed") continue;
        while (analyzing.value) await new Promise((resolve) => setTimeout(resolve, 1000));
        backgroundIds.value = new Set(backgroundIds.value).add(id);
        const errors = new Map(backgroundErrors.value);
        errors.delete(id);
        backgroundErrors.value = errors;
        try {
          const result = await makeAnalysisProvider(aiSettings.value).analyzeStored(packetId(id), "", { onProgress() {}, onPreview() {} });
          const latest = applicants.value.find((a) => a.id === id);
          if (latest) applyStoredResult(latest, result);
        } catch (failure) {
          backgroundErrors.value = new Map(backgroundErrors.value).set(id, failure instanceof Error ? failure.message : "Analysis failed.");
        } finally {
          const running = new Set(backgroundIds.value);
          running.delete(id);
          backgroundIds.value = running;
        }
      }
    } finally {
      queueRunning = false;
    }
  }
  function storedReferral(packet: StoredPacket): Referral {
    const { id, name, fileName, storage, ...intake } = packet;
    return {
      id: `stored-${packet.id}`, title: packet.name, intake, status: "awaiting_claude", revision: 0,
      documents: [{
        id: `stored-doc-${packet.id}`, name: packet.fileName, page_count: null, status: "stored",
        error: null, pages: [], local_url: `/api/applicants/${encodeURIComponent(packet.id)}/pdf`,
      }],
      facts: [], evidence: [], error: null, audit: [],
      checklist: rubric(),
    };
  }
  /** Adds stored applicants without replacing session records (and their edits) already loaded. */
  async function loadStoredApplicants() {
    const packets = await $fetch<StoredPacket[]>("/api/applicants");
    const serverIds = new Set(packets.map(p => `stored-${p.id}`));
    applicants.value = applicants.value.filter(a => !isStored(a) || serverIds.has(a.id) || dirty.has(a.id));
    for (const packet of packets) {
      const existing = applicants.value.find(a => a.id === `stored-${packet.id}`);
      if (!existing) applicants.value.push(storedReferral(packet));
      else { existing.title = packet.name; const { id, name, fileName, storage, ...intake } = packet; existing.intake = intake; }
    }
    return packets;
  }
  /** Uploads one combined PDF with intake details, stores it on the server, and adds the applicant. */
  async function createStoredApplicant(fields: IntakeInput, file: File) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value);
    form.append("file", file);
    const packet = await $fetch<StoredPacket>("/api/applicants", { method: "POST", body: form });
    const record = storedReferral(packet);
    applicants.value.push(record);
    filesByApplicant.set(record.id, file);
    revisions.set(record.id, 0);
    loaded.add(record.id);
    return record;
  }
  /** Saves intake/status edits, keeping the in-session review (facts, checklist, audit) intact. */
  async function updateStoredApplicant(id: string, fields: IntakeInput) {
    const local = applicants.value.find(a => a.id === id);
    if (local && !isStored(local)) {
      const { name, ...intake } = fields;
      if (name !== undefined) local.title = name;
      if (local.intake) Object.assign(local.intake, intake);
      return local;
    }
    const packet = await $fetch<StoredPacket>(`/api/applicants/${encodeURIComponent(id.replace(/^stored-/, ""))}`, {
      method: "PATCH", body: fields,
    });
    const record = applicants.value.find((a) => a.id === id);
    if (record) {
      const fresh = storedReferral(packet);
      record.title = fresh.title;
      record.intake = fresh.intake;
    }
    return record;
  }
  async function deleteStoredApplicant(id: string) {
    await saves.get(id)?.catch(() => {});
    if (id.startsWith("stored-")) await $fetch(`/api/applicants/${encodeURIComponent(id.replace(/^stored-/, ""))}`, { method: "DELETE" });
    dirty.delete(id);
    loaded.delete(id);
    revisions.delete(id);
    filesByApplicant.delete(id);
    namesByApplicant.delete(id);
    applicants.value = applicants.value.filter((a) => a.id !== id);
    if (referral.value.id === id) selectApplicant("synthetic-demo");
  }
  async function resetDemo() {
    try { await flushSaves(); } catch { return; }
    cancelAnalysis();
    sessionStorage.removeItem("referral-active-id");
    patientName.value = "";
    attachedFiles.value = [];
    referral.value = createDemo();
    installDemoPreviews();
    error.value = "";
    mode.value = "synthetic";
    rememberApplicant();
    if (["/processor", "/summary"].includes(route.path) && route.query.applicant) await router.replace({ path: route.path, query: {} });
  }
  function useProvidedDocument(document: PacketDocument) {
    cancelAnalysis();
    patientName.value = "";
    attachedFiles.value = [];
    mode.value = "provided";
    error.value = "";
    const existing = applicants.value.find((a) => a.id === document.id);
    if (existing) { referral.value = existing; patientName.value = namesByApplicant.get(existing.id) || ""; return; }
    // Every supplied packet is a separate referral, never one combined patient.
    referral.value = document.id === "provided-R01" ? createR01Mock(document) : {
      id: document.id,
      title: document.name,
      status: "awaiting_claude",
      revision: 0,
      documents: [document],
      facts: [],
      evidence: [],
      error: null,
      audit: [],
      checklist: rubric(),
    };
    rememberApplicant();
  }
  async function loadProvidedDocuments() {
    // Local packet previews exist only in local development; deployed builds exclude them.
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
    try {
      const response = await fetch("/local-demo/manifest.json");
      if (!response.ok) return;
      const entries: unknown = await response.json();
      if (!Array.isArray(entries)) return;
      providedDocuments.value = entries
        .filter(
          (entry) =>
            /^R\d{2}$/.test(entry.id) &&
            entry.url === `/local-demo/${entry.id}.pdf`,
        )
        .map((entry) => ({
          id: `provided-${entry.id}`,
          name: `${entry.id}.pdf`,
          page_count: entry.page_count,
          local_url: entry.url,
          status: "provided_demo",
          error: null,
          pages: [],
        }));
      for (const doc of providedDocuments.value) useProvidedDocument(doc);
      if (providedDocuments.value[0]) selectApplicant(providedDocuments.value[0].id);
    } catch {
      /* No local examples configured; retain the synthetic flow. */
    }
  }
  async function attach(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length || savingPdf.value || analyzing.value) return;
    if (list.length !== 1 || !list[0]!.name.toLowerCase().endsWith(".pdf") || !list[0]!.size || list[0]!.size > maxPacketBytes) {
      error.value = "Choose one valid combined PDF up to 50 MB per applicant.";
      return;
    }
    error.value = "";
    savingPdf.value = true;
    try {
      const record = await createStoredApplicant({ name: list[0]!.name.replace(/\.pdf$/i, ""), reviewStatus: "in_review" }, list[0]!);
      await selectApplicant(record.id);
      savingPdf.value = false;
      await router.replace({ path: "/processor", query: { applicant: record.id } });
      void analyze();
    } catch (failure: any) {
      error.value = failure?.data?.statusMessage || "The applicant could not be saved. Try the upload again.";
    } finally { savingPdf.value = false; }
  }
  function invalidateRecommendation() {
    if (!referral.value.recommendation) return;
    referral.value.recommendation = { status: "needs_information", reasons: ["Coordinator edits changed the review. Recheck linked requirements before a final decision."], rule_ids: [] };
  }
  async function updateFact(fact: Fact, value: string, note: string, status: string) {
    const current = referral.value.facts.find((f) => f.id === fact.id);
    if (!current) return;
    invalidateRecommendation();
    for (const rule of referral.value.checklist.rules.filter(r => r.fact_ids.includes(current.id))) {
      rule.original_note ??= rule.note;
      rule.status = "uncertain";
      rule.note = "Linked fact changed by coordinator; reassess this requirement.";
    }
    current.value = value;
    current.review_note = note;
    current.status = status;
    referral.value.audit.push({
      at: new Date().toISOString(),
      type: "fact_review",
      id: current.id,
      note,
    });
    referral.value.checklist.counts = Object.fromEntries([...new Set(referral.value.checklist.rules.map(r => r.status))].map(status => [status, referral.value.checklist.rules.filter(r => r.status === status).length]));
    await saveWorkspace();
  }
  async function updateRule(rule: Rule, status: string, note: string) {
    const current = referral.value.checklist.rules.find(
      (r) => r.id === rule.id,
    );
    if (!current) return;
    invalidateRecommendation();
    current.original_note ??= current.note;
    current.review_note = note;
    current.status = status;
    current.note = note;
    referral.value.audit.push({
      at: new Date().toISOString(),
      type: "rule_review",
      id: current.id,
      note,
    });
    referral.value.checklist.counts = Object.fromEntries([...new Set(referral.value.checklist.rules.map(r => r.status))].map(status => [status, referral.value.checklist.rules.filter(r => r.status === status).length]));
    await saveWorkspace();
  }
  onBeforeUnmount(() => { if (import.meta.client) window.removeEventListener("beforeunload", beforeLeave); cancelAnalysis(); uploadController?.abort(); objectUrls.forEach((url) => URL.revokeObjectURL(url)); });
  onMounted(() => {
    installDemoPreviews();
    rememberApplicant();
    window.addEventListener("beforeunload", beforeLeave);
    void restoreRouteApplicant().catch(() => { error.value = "The saved applicant could not be loaded. Open it again from the dashboard."; });
    if (!route.query.applicant && !sessionStorage.getItem("referral-active-id")) loadProvidedDocuments();
  });
  return {
    referral,
    aiSettings,
    saveState,
    saveError,
    retrySave,
    saveLayout,
    flushSaves,
    patientName,
    analyzing,
    savingPdf,
    savePdf,
    progress,
    analyze,
    cancelAnalysis,
    applicants,
    selectApplicant,
    addApplicant,
    loadStoredApplicants,
    createStoredApplicant,
    createApplicantForAnalysis,
    analyzeInBackground,
    backgroundIds,
    backgroundErrors,
    updateStoredApplicant,
    deleteStoredApplicant,
    error,
    attachedFiles,
    resetDemo,
    attach,
    updateFact,
    updateRule,
    mode,
    providedDocuments,
    useProvidedDocument,
  };
}
