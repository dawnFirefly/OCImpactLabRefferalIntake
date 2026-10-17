import { createDemo } from "../data/demo";
import type { Referral, Fact, Rule } from "../types";

/** Frontend-only session state. No extraction, network requests, or PDF text parsing. */
export function useReviewWorkspace() {
  const referral = ref<Referral>(createDemo());
  const error = ref("");
  const attachedFiles = shallowRef<File[]>([]);
  const objectUrls: string[] = [];
  function resetDemo() {
    objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    attachedFiles.value = [];
    referral.value = createDemo();
    error.value = "";
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
    if (list.length > 6) {
      error.value = "Attach up to six PDFs for one referral.";
      return;
    }
    resetDemo();
    attachedFiles.value = list;
    referral.value = {
      id: crypto.randomUUID(),
      title: "Attached referral",
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
  return {
    referral,
    error,
    attachedFiles,
    resetDemo,
    attach,
    updateFact,
    updateRule,
  };
}
