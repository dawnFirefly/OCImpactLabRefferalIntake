export type Evidence = {
  id: string;
  document_id: string;
  page: number;
  quote: string;
  bbox: [number, number, number, number] | null;
  confidence: number | null;
  method: "synthetic" | "claude" | "cloudflare" | "opencode";
};
export type Fact = {
  section_ids?: string[];
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
export type DocumentSection = {
  id: string;
  document_id: string;
  title: string;
  category: string;
  pages: number[];
  status: "found" | "missing" | "uncertain";
};
export type Recommendation = {
  status: "recommend_approval" | "recommend_denial" | "needs_information";
  /** Staged decision-tree outcome and the stage that decided it (shared/decision-tree.ts). */
  outcome?: "approved" | "denied" | "human_review" | "hold" | "conditional" | "rfi" | "needs_review" | "not_reviewed";
  stage?: number | null;
  reasons: string[];
  rule_ids: string[];
};
export type Rule = {
  id: string;
  text: string;
  kind: string;
  section: string;
  status: string;
  fact_ids: string[];
  note: string;
  original_note?: string;
  review_note?: string;
  human_review?: boolean;
  /** Source FORM rule replaced by an internal-outline rule (precedence). */
  superseded_by?: string;
};
export type StoredPacket = { key: string; size: number; uploaded_at: string };
export type PacketDocument = {
  id: string;
  name: string;
  page_count: number | null;
  status: string;
  error: string | null;
  pages: { number: number; rotation: number; method: string; error?: string }[];
  local_url?: string;
  storage?: StoredPacket;
};
export type ReviewStatus = "new" | "in_review" | "needs_info" | "approved" | "denied";
/** Summary of a saved Claude analysis (full result is fetched from /api/applicants/:id/analysis). */
export type AnalysisMeta = {
  analyzedAt: string;
  outcome: Recommendation["outcome"] | null;
  stage: number | null;
  recommendation: Recommendation["status"] | null;
};
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
  /** Set once an analysis has been saved for this applicant. */
  analysis?: AnalysisMeta;
};
export type Referral = {
  graphLayout?: { positions: Record<string, { x: number; y: number }>; viewport?: { x: number; y: number; zoom: number } };
  analysisProvider?: { provider: "cloudflare" | "anthropic" | "opencode"; extractionModel: string; reviewModel: string };
  sections?: DocumentSection[];
  recommendation?: Recommendation;
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
