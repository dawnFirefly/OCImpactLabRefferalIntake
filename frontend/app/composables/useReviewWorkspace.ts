import { createR01Mock } from "../data/r01Mock";
import { createDemo } from "../data/demo";
import type { Referral, Fact, Rule, PacketDocument } from "../types";
import { createDemoPdf } from "../lib/demoPdf";

/** Frontend-only session state. No extraction, model requests, or PDF text extraction. */
export function useReviewWorkspace() {
  const referral = ref<Referral>(createDemo());
  const applicants = ref<Referral[]>([]);
  const error = ref("");
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
    referral.value = applicant;
    mode.value = id === "synthetic-demo" ? "synthetic" : id.startsWith("provided-") ? "provided" : "attached";
    error.value = "";
  }
  function addApplicant(name: string) {
    referral.value = {
      id: crypto.randomUUID(), title: name.trim(), status: "awaiting_pdf", revision: 0,
      documents: [], facts: [], evidence: [], error: null, audit: [],
      checklist: { precedence: "", source_url: "", rules: [], counts: {} },
    };
    mode.value = "attached";
    rememberApplicant();
    return referral.value.id;
  }
  function resetDemo() {
    attachedFiles.value = [];
    referral.value = createDemo();
    installDemoPreviews();
    error.value = "";
    mode.value = "synthetic";
    rememberApplicant();
  }
  function useProvidedDocument(document: PacketDocument) {
    attachedFiles.value = [];
    mode.value = "provided";
    error.value = "";
    const existing = applicants.value.find((a) => a.id === document.id);
    if (existing) { referral.value = existing; return; }
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
      checklist: { precedence: "", source_url: "", rules: [], counts: {} },
    };
    rememberApplicant();
  }
  async function loadProvidedDocuments() {
    try {
      const response = await fetch("/local-demo/manifest.json");
      if (!response.ok) return;
      const entries: unknown = await response.json();
      if (!Array.isArray(entries)) return;
      providedDocuments.value = entries
        .filter(
          (entry) =>
            ["R01", "R02"].includes(entry.id) &&
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
          !f.name.toLowerCase().endsWith(".pdf") || f.size > 50 * 1024 * 1024,
      )
    ) {
      error.value = "Choose PDF files up to 50 MB each.";
      return;
    }
    if (list.length !== 1) {
      error.value = "Choose one combined PDF per applicant. Switch applicants to review another packet.";
      return;
    }
    error.value = "";
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
      checklist: { precedence: "", source_url: "", rules: [], counts: {} },
    } as Referral;
    rememberApplicant();
  }
  function updateFact(fact: Fact, value: string, note: string, status: string) {
    const current = referral.value.facts.find((f) => f.id === fact.id);
    if (!current) return;
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
    current.status = status;
    current.note = note;
    referral.value.audit.push({
      at: new Date().toISOString(),
      type: "rule_review",
      id: current.id,
      note,
    });
  }
  onBeforeUnmount(() => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  onMounted(() => {
    installDemoPreviews();
    rememberApplicant();
    loadProvidedDocuments();
  });
  return {
    referral,
    applicants,
    selectApplicant,
    addApplicant,
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
