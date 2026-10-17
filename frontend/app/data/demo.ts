import type { Referral, Fact, Rule } from "../types";
import { demoRowTop, DEMO_PAGE_HEIGHT } from "../lib/demoPdf";

/** Fictional UI fixtures. Never derived from the supplied referral packets. */
export function createDemo(): Referral {
  const documents = [
    { id: "demo-referral", name: "Referral form.pdf", page_count: 3 },
    { id: "demo-labs", name: "Lab results.pdf", page_count: 2 },
    { id: "demo-discharge", name: "Discharge notes.pdf", page_count: 5 },
  ].map((d) => ({ ...d, status: "demo", error: null, pages: [] }));
  const definitions = [
    [
      "name",
      "Full name",
      "Personal information",
      "Jane Doe",
      "",
      ["demo-referral", "demo-discharge"],
    ],
    [
      "bp",
      "Blood pressure",
      "Labs & vitals",
      "128 / 82",
      "mmHg",
      ["demo-labs", "demo-discharge"],
    ],
    [
      "insurance",
      "Insurance type",
      "Personal information",
      "Medi-Cal",
      "",
      ["demo-referral", "demo-discharge"],
    ],
    [
      "hemoglobin",
      "Hemoglobin",
      "Labs & vitals",
      "12.8",
      "g/dL",
      ["demo-labs"],
    ],
    [
      "dob",
      "Date of birth",
      "Personal information",
      "May 12, 1984",
      "",
      ["demo-referral"],
    ],
    [
      "gender",
      "Gender",
      "Personal information",
      "Female",
      "",
      ["demo-referral"],
    ],
    [
      "language",
      "Preferred language",
      "Personal information",
      "English",
      "",
      ["demo-referral"],
    ],
    [
      "contact",
      "Contact details",
      "Personal information",
      "Documented",
      "",
      ["demo-referral"],
    ],
    [
      "referrer",
      "Referring contact",
      "Personal information",
      "Demo hospital team",
      "",
      ["demo-referral"],
    ],
    ["heart-rate", "Heart rate", "Labs & vitals", "76", "bpm", ["demo-labs"]],
    [
      "temperature",
      "Temperature",
      "Labs & vitals",
      "36.8",
      "°C",
      ["demo-labs"],
    ],
    [
      "wbc",
      "White blood cell count",
      "Labs & vitals",
      "7.2",
      "×10³/µL",
      ["demo-labs"],
    ],
  ] as const;
  const evidence: Referral["evidence"] = [];
  const facts: Fact[] = definitions.map(
    ([key, label, group, value, unit, docs]) => {
      const ids = docs.map((doc, index) => {
        const id = `${key}-${doc}`;
        evidence.push({
          id,
          document_id: doc,
          page: index + 1,
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
