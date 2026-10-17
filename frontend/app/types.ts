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
export type Referral = {
  sections?: DocumentSection[];
  recommendation?: Recommendation;
  id: string;
  title: string;
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
