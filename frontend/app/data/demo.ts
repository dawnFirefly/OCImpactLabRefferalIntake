import type { Referral, Fact, Rule } from "../types";
import { demoRowTop, DEMO_PAGE_HEIGHT } from "../lib/demoPdf";

/** Fictional UI fixtures. Never derived from the supplied referral packets. */
export function createDemo(): Referral {
  const documents = [{ id: "demo-packet", name: "Jane Doe referral packet.pdf", page_count: 3, status: "demo", error: null, pages: [] }];
  const definitions = [
    [
      "name",
      "Full name",
      "Personal information",
      "Jane Doe",
      "",
      [1, 3],
    ],
    [
      "bp",
      "Blood pressure",
      "Labs & vitals",
      "128 / 82",
      "mmHg",
      [2, 3],
    ],
    [
      "insurance",
      "Insurance type",
      "Personal information",
      "Medi-Cal",
      "",
      [1, 3],
    ],
    [
      "hemoglobin",
      "Hemoglobin",
      "Labs & vitals",
      "12.8",
      "g/dL",
      [2],
    ],
    [
      "dob",
      "Date of birth",
      "Personal information",
      "May 12, 1984",
      "",
      [1],
    ],
    [
      "gender",
      "Gender",
      "Personal information",
      "Female",
      "",
      [1],
    ],
    [
      "language",
      "Preferred language",
      "Personal information",
      "English",
      "",
      [1],
    ],
    [
      "contact",
      "Contact details",
      "Personal information",
      "Documented",
      "",
      [1],
    ],
    [
      "referrer",
      "Referring contact",
      "Personal information",
      "Demo hospital team",
      "",
      [1],
    ],
    ["heart-rate", "Heart rate", "Labs & vitals", "76", "bpm", [2]],
    [
      "temperature",
      "Temperature",
      "Labs & vitals",
      "36.8",
      "°C",
      [2],
    ],
    [
      "wbc",
      "White blood cell count",
      "Labs & vitals",
      "7.2",
      "×10³/µL",
      [2],
    ],
  ] as const;
  const evidence: Referral["evidence"] = [];
  const facts: Fact[] = definitions.map(
    ([key, label, group, value, unit, docs]) => {
      const ids = docs.map((page) => {
        const doc = "demo-packet";
        const id = `${key}-${doc}-${page}`;
        evidence.push({
          id,
          document_id: doc,
          page,
          quote: `${label}: ${value}${unit ? " " + unit : ""}`,
          bbox: null,
          confidence: null,
          method: "synthetic",
        });
        return id;
      });
      return {
        id: key,
        key,
        label,
        group,
        value,
        unit,
        original_value: value,
        evidence_ids: ids,
        rule_ids: [key],
        kind: "demo",
        status: "confirmed",
        review_note: "",
        discrepancy: undefined,
      };
    },
  );
  const rules: Rule[] = facts.map((f) => ({
    id: f.key,
    text: f.label,
    kind: "field",
    section: f.group,
    status: "met",
    fact_ids: [f.id],
    note: "",
  }));
  // Exact anchors are authored alongside the fictional PDF rows, never inferred.
  for (const document of documents) {
    for (let page = 1; page <= document.page_count; page++) {
      evidence
        .filter((e) => e.document_id === document.id && e.page === page)
        .forEach((e, index) => {
          const top = demoRowTop(index);
          e.bbox = [
            48 / 600,
            (top - 18) / DEMO_PAGE_HEIGHT,
            552 / 600,
            (top + 13) / DEMO_PAGE_HEIGHT,
          ];
        });
    }
  }
  for (const [id, text] of [
    ["glucose", "Glucose"],
    ["creatinine", "Creatinine"],
    ["sodium", "Sodium"],
    ["potassium", "Potassium"],
    ["culture", "Culture results"],
  ]) {
    rules.push({
      id: id!,
      text: text!,
      kind: "field",
      section: "Labs & vitals",
      status: "unknown",
      fact_ids: [],
      note: "",
    });
  }
  return {
    id: "synthetic-demo",
    title: "Synthetic UI example",
    status: "demo",
    revision: 0,
    documents,
    facts,
    evidence,
    error: null,
    audit: [],
    checklist: {
      precedence:
        "Illustrative UI fields only; the future Claude integration will use validated IHH rules.",
      source_url: "",
      rules,
      counts: { met: 12, unknown: 5 },
    },
  };
}
