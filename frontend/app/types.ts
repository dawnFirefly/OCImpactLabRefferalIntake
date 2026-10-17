export type Evidence = {
  id: string;
  document_id: string;
  page: number;
  quote: string;
  bbox: [number, number, number, number] | null;
  confidence: number | null;
  method: "synthetic" | "claude";
};
export type Fact = {
  id: string;
  key: string;
  label: string;
  group: string;
  value: string;
  original_value: string;
  unit: string;
  evidence_ids: string[];
  rule_ids: string[];
  kind: string;
  status: string;
  review_note: string;
  discrepancy?: string;
};
export type Rule = {
  id: string;
  text: string;
  kind: string;
  section: string;
  status: string;
  fact_ids: string[];
  note: string;
  human_review?: boolean;
};
export type PacketDocument = {
  id: string;
  name: string;
  page_count: number | null;
  status: string;
  error: string | null;
  pages: { number: number; rotation: number; method: string; error?: string }[];
  local_url?: string;
};
export type ReviewStatus = "new" | "in_review" | "needs_info" | "approved" | "denied" | "completed";
/** Coordinator-entered intake details for a stored applicant (not model output). */
export type Intake = {
  receivedAt: string;
  source: string;
  contact: string;
  priority: "routine" | "urgent";
  reviewer: string;
  notes: string;
  reviewStatus: ReviewStatus;
  uploadedAt: string;
  size: number;
};
export type Referral = {
  id: string;
  title: string;
  intake?: Intake;
  status: string;
  revision: number;
  documents: PacketDocument[];
  facts: Fact[];
  evidence: Evidence[];
  error: string | null;
  checklist: {
    precedence: string;
    source_url: string;
    rules: Rule[];
    counts: Record<string, number>;
  };
  audit: { at: string; type: string; id: string; note: string }[];
};
