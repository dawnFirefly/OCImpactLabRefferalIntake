import type { Fact, PacketDocument, Referral, Rule } from "../types";

/** User-supplied packet inventory only. No patient-level findings or PDF anchors. */
export function createR01Mock(document: PacketDocument): Referral {
  const definitions = [
    ["referral", "Referral form", "Administrative", "IHH referral form present", "met"],
    ["payer", "Payer paperwork", "Administrative", "CalAIM form present; authorization unverified", "met"],
    ["identity", "Personal information", "Administrative", "Face sheet present; values not extracted", "met"],
    ["medications", "Medication records", "Care needs", "19 sideways pages reported; regimen unreviewed", "met"],
    ["mobility", "Mobility & ADLs", "Functional review", "Upside-down PT evaluation; independence unverified", "unknown"],
    ["stability", "Medical stability", "Care needs", "Progress-note fragments; stability unverified", "unknown"],
    ["labs", "Labs & vitals", "Care needs", "Not evaluated; presence not established by summary", "unknown"],
    ["housing", "Housing status", "Administrative", "Not evaluated; confirm in packet", "unknown"],
    ["self-medication", "Medication self-management", "Functional review", "Not evaluated; coordinator review needed", "unknown"],
  ] as const;
  const facts: Fact[] = definitions.map(([id, label, group, value]) => ({
    id, key: id, label, group, value, original_value: value, unit: "",
    evidence_ids: [], rule_ids: [id], kind: "mock_summary", status: "unverified", review_note: "",
  }));
  const rules: Rule[] = definitions.map(([id, text, section, , status]) => ({
    id, text, section, status, kind: "mock_review", fact_ids: [id], human_review: true,
    note: "Mock from user-provided packet inventory. Completed means document reported present, not eligibility confirmed.",
  }));
  return {
    id: document.id, title: "R01 · mock packet review", status: "mock_review", revision: 0,
    documents: [document], facts, evidence: [], error: null, audit: [],
    checklist: {
      precedence: "Illustrative document-presence checklist, not IHH admission rules or a clinical assessment.",
      source_url: "", rules, counts: { met: 4, unknown: 5 },
    },
  };
}
