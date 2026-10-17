import { claudeProvider, type AnalysisProgress, type AnalysisPreview } from "../services/analysis";
import { uploadPacket } from "../services/storage";
import { createR01Mock } from "../data/r01Mock";
import { createDemo } from "../data/demo";
import type { Referral, Fact, Rule, PacketDocument, Intake, AnalysisMeta } from "../types";
import { createDemoPdf } from "../lib/demoPdf";
import { criteriaPrecedence, criteriaSource, unreviewedRules } from "#shared/decision-tree";
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

/** Session state. Uploading a PDF starts Claude analysis; stored packets are persisted by the server. */
export function useReviewWorkspace() {
  const referral = ref<Referral>(createDemo());
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
      id: current.id, title: name, status: "analyzing", revision: current.revision,
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
        result = await claudeProvider.analyzeStored(packetId(current.id), name, handlers, request.signal);
      } else {
        const file = await sourceFile(current, request.signal);
        startPreview(current, name || current.title);
        result = await claudeProvider.analyze(file, name, handlers, request.signal);
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
  function selectApplicant(id: string) {
    const applicant = applicants.value.find((a) => a.id === id);
    if (!applicant) return;
    cancelAnalysis();
    referral.value = applicant;
    patientName.value = namesByApplicant.get(id) || (applicant.status === "analyzed" || applicant.status === "awaiting_pdf" ? applicant.title : "");
    mode.value = id === "synthetic-demo" ? "synthetic" : id.startsWith("provided-") ? "provided" : "attached";
    error.value = "";
    loadStoredAnalysis(applicant).catch(() => { error.value = "The saved analysis could not be loaded. Analyze again to refresh it."; });
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
    result.intake = record.intake ? { ...record.intake, analysis: meta } : undefined;
    if (result.documents[0]) result.documents[0].local_url = record.documents[0]?.local_url;
    const index = applicants.value.findIndex((a) => a.id === record.id);
    if (index !== -1) applicants.value[index] = result;
    if (referral.value.id === record.id && referral.value.status !== "analyzing") referral.value = result;
    return result;
  }
  /** Load a saved analysis instead of re-running Claude. */
  async function loadStoredAnalysis(record: Referral) {
    if (!isStored(record) || record.status === "analyzed" || !record.intake?.analysis) return;
    const result = await $fetch<Referral>(`/api/applicants/${encodeURIComponent(packetId(record.id))}/analysis`);
    const latest = applicants.value.find((a) => a.id === record.id);
    if (latest && latest.status !== "analyzed") applyStoredResult(latest, result, record.intake.analysis);
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
          const result = await claudeProvider.analyzeStored(packetId(id), "", { onProgress() {}, onPreview() {} });
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
    for (const packet of packets) {
      if (!applicants.value.some((a) => a.id === `stored-${packet.id}`)) applicants.value.push(storedReferral(packet));
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
    // New referrals are analyzed right away; the result is saved with the applicant.
    analyzeInBackground(record.id);
    return record;
  }
  /** Saves intake/status edits, keeping the in-session review (facts, checklist, audit) intact. */
  async function updateStoredApplicant(id: string, fields: IntakeInput) {
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
    await $fetch(`/api/applicants/${encodeURIComponent(id.replace(/^stored-/, ""))}`, { method: "DELETE" });
    applicants.value = applicants.value.filter((a) => a.id !== id);
    if (referral.value.id === id) selectApplicant("synthetic-demo");
  }
  function resetDemo() {
    cancelAnalysis();
    patientName.value = "";
    attachedFiles.value = [];
    referral.value = createDemo();
    installDemoPreviews();
    error.value = "";
    mode.value = "synthetic";
    rememberApplicant();
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
  function attach(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    if (
      list.some(
        (f) =>
          !f.name.toLowerCase().endsWith(".pdf") || f.size > maxPacketBytes,
      )
    ) {
      error.value = "Choose one PDF up to 50 MB.";
      return;
    }
    if (list.length !== 1) {
      error.value = "Choose one combined PDF per applicant. Switch applicants to review another packet.";
      return;
    }
    error.value = "";
    cancelAnalysis();
    // Only a dashboard-named applicant carries a name to check; otherwise Claude reads it from the PDF.
    patientName.value = referral.value.status === "awaiting_pdf" ? namesByApplicant.get(referral.value.id) || "" : "";
    attachedFiles.value = list;
    mode.value = "attached";
    referral.value = {
      id: referral.value.status === "awaiting_pdf" ? referral.value.id : crypto.randomUUID(),
      title: referral.value.status === "awaiting_pdf" ? referral.value.title : list[0]!.name,
      status: "awaiting_claude",
      revision: 0,
      documents: list.map((f) => {
        const url = URL.createObjectURL(f);
        objectUrls.push(url);
        return {
          id: crypto.randomUUID(),
          name: f.name,
          page_count: null,
          status: "awaiting_claude",
          error: null,
          pages: [],
          local_url: url,
        };
      }),
      facts: [],
      evidence: [],
      error: null,
      audit: [],
      checklist: rubric(),
    } as Referral;
    filesByApplicant.set(referral.value.id, list[0]!);
    rememberApplicant();
    // Uploading is the coordinator's explicit request: start the Claude analysis immediately.
    void analyze();
  }
  function invalidateRecommendation() {
    if (!referral.value.recommendation) return;
    referral.value.recommendation = { status: "needs_information", reasons: ["Coordinator edits changed the review. Recheck linked requirements before a final decision."], rule_ids: [] };
  }
  function updateFact(fact: Fact, value: string, note: string, status: string) {
    const current = referral.value.facts.find((f) => f.id === fact.id);
    if (!current) return;
    invalidateRecommendation();
    for (const rule of referral.value.checklist.rules.filter(r => r.fact_ids.includes(current.id))) {
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
  }
  function updateRule(rule: Rule, status: string, note: string) {
    const current = referral.value.checklist.rules.find(
      (r) => r.id === rule.id,
    );
    if (!current) return;
    invalidateRecommendation();
    current.status = status;
    current.note = note;
    referral.value.audit.push({
      at: new Date().toISOString(),
      type: "rule_review",
      id: current.id,
      note,
    });
  }
  onBeforeUnmount(() => { cancelAnalysis(); uploadController?.abort(); objectUrls.forEach((url) => URL.revokeObjectURL(url)); });
  onMounted(() => {
    installDemoPreviews();
    rememberApplicant();
    loadProvidedDocuments();
  });
  return {
    referral,
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
