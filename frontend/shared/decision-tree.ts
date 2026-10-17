import criteria from "./admission-criteria.json" with { type: "json" };

/**
 * IHH staged decision tree (frontend/decisionTree.md) over the pinned organizer criteria.
 * Shared by the browser (Application review) and the server (recommendation gate).
 * Every source rule ID appears in exactly one step; IDs, wording and precedence are unchanged.
 */
export type Criterion = { id: string; text: string; section: string; kind: string; human_review?: boolean; superseded_by?: string };

export const criteriaSource = "https://github.com/travcjohnson/claude-impact-lab-oc/blob/main/challenges/1-referral-intake/criteria/admission-criteria.json";
export const criteriaPrecedence = criteria.precedence;
export const criteriaText = JSON.stringify(criteria);
export const catalog: Criterion[] = [
  ...criteria.general.any_of.map(r => ({ ...r, section: "General eligibility (one or more)", kind: "any_of" })),
  ...criteria.rules,
  ...criteria.by_system.flatMap(s => [
    ...s.eligible.map(r => ({ ...r, section: s.system, kind: "kind" in r ? String(r.kind) : "eligible" })),
    ...s.ineligible.map(r => ({ ...r, section: s.system, kind: "exclude" })),
  ]),
  ...criteria.referral_checklist.items.map(r => ({ ...r, section: "Required documents", kind: "document" })),
  ...criteria.referral_form_screen.must_meet_all.map(r => ({ ...r, section: "Referral screen", kind: "must" })),
  ...criteria.referral_form_screen.not_eligible_if.map(r => ({ ...r, section: "Referral screen", kind: "exclude" })),
];

/** What failing a step leads to. `context`/`info` steps never gate; `manual` has no source rule ID. */
export type StepGate = "deny" | "human_review" | "hold" | "conditional" | "rfi" | "context" | "info" | "manual";
export type TreeStep = { id: string; title: string; question: string; gate: StepGate; failLabel: string; rule_ids: string[]; anyOf?: string[] };
export type TreeStage = { id: string; number: number; title: string; summary: string; steps: TreeStep[] };

const eligibleContext = catalog.filter(r => r.kind === "eligible").map(r => r.id);
const questions = catalog.filter(r => r.kind === "ask").map(r => r.id);

export const decisionTree: TreeStage[] = [
  { id: "stage-1", number: 1, title: "General & payer eligibility", summary: "Baseline qualification. The internal outline supersedes hospital referral forms.", steps: [
    { id: "1.1", title: "Qualifying living situation", question: "Meets at least one general criterion (GEN-1, GEN-2 or GEN-3)?", gate: "deny", failLabel: "Denied · ineligible living situation",
      rule_ids: ["GEN-1", "GEN-2", "GEN-3", "FORM-M1"], anyOf: ["GEN-1", "GEN-2", "GEN-3"] },
    { id: "1.2", title: "CalAIM 182-day cap", question: "More than 182 days of Recuperative Care, STPHH or Transitional Rent in a rolling 12 months?", gate: "manual", failLabel: "Denied · exceeded CalAIM cap",
      rule_ids: [] },
  ] },
  { id: "stage-2", number: 2, title: "Safety, behavioral & cognitive filter", summary: "Psychiatric safety, legal boundaries and cognitive independence.", steps: [
    { id: "2.1", title: "Behavioral and legal exclusions", question: "Aggression, suicidal ideation, commanding hallucinations, conservatorship/FSP, detox non-compliance, or unstable on medications?", gate: "deny", failLabel: "Denied",
      rule_ids: ["OTH-1", "FORM-X7", "MH-2", "MH-3", "MH-5", "FORM-X5", "MH-1", "FORM-M2"] },
    { id: "2.2", title: "Sex offender evaluation", question: "Registered sex offender? The outline (OTH-2) supersedes FORM-X6: never auto-deny.", gate: "human_review", failLabel: "Human review · case by case",
      rule_ids: ["OTH-2", "FORM-X6"] },
    { id: "2.3", title: "Cognition & medication self-administration", question: "A&Ox4, no dementia, and able to self-administer all medications?", gate: "deny", failLabel: "Denied",
      rule_ids: ["COG-2", "FORM-M3", "NEU-X5", "FORM-X1", "COG-1", "FORM-M5"] },
    { id: "2.4", title: "Acute alcohol intoxication clearance", question: "If admitted for acute intoxication: 72-hour hold completed with CIWA-AR < 8?", gate: "hold", failLabel: "Hold · 72-hr hold & CIWA-AR required",
      rule_ids: ["MH-4"] },
  ] },
  { id: "stage-3", number: 3, title: "Functional mobility & ADLs", summary: "PT/OT notes govern. Wheelchair users who transfer independently are eligible (MOB-4 supersedes the 100 ft form rule).", steps: [
    { id: "3.1", title: "Activities of daily living", question: "Completes all ADLs, bathing and toileting independently?", gate: "deny", failLabel: "Denied · needs SNF-level assistance",
      rule_ids: ["ADL-1", "ADL-2", "ADL-3", "FORM-M4", "FORM-X2"] },
    { id: "3.2", title: "Mobility and transfers", question: "Wheelchair: transfers and self-propels independently. Otherwise: ambulates 100 ft at modified independence.", gate: "deny", failLabel: "Denied",
      rule_ids: ["MOB-1", "MOB-3", "MOB-4", "FORM-M6", "FORM-X3"] },
  ] },
  { id: "stage-4", number: 4, title: "Medical stability & clinical exclusions", summary: "Any confirmed exclusion is ineligible. Eligible examples are context, not requirements.", steps: [
    { id: "4.1", title: "Infection & vitals", question: "Sepsis physiology on last 5 vitals, uncleared MRSA/TB/C. diff, or isolation?", gate: "deny", failLabel: "Denied", rule_ids: ["ID-1", "OTH-4", "FORM-X4"] },
    { id: "4.2", title: "Integumentary", question: "Grafting, complicated large abscess, or inhalation burns?", gate: "deny", failLabel: "Denied", rule_ids: ["INT-X1", "INT-X2", "INT-X3"] },
    { id: "4.3", title: "Respiratory", question: "BiPAP, pneumothorax, hemothorax, trach with ventilator, or pulmonary embolism?", gate: "deny", failLabel: "Denied", rule_ids: ["RSP-X1", "RSP-X2", "RSP-X3", "RSP-X4", "RSP-X5"] },
    { id: "4.4", title: "Musculoskeletal", question: "Open fracture, osteomyelitis, external fixation, recent amputation with wounds, or jaw wiring?", gate: "deny", failLabel: "Denied", rule_ids: ["MSK-X1", "MSK-X2", "MSK-X3", "MSK-X4", "MSK-X5"] },
    { id: "4.5", title: "Gastrointestinal", question: "Decompensated cirrhosis, recent bleeding ulcer/varices, or C. diff?", gate: "deny", failLabel: "Denied", rule_ids: ["GI-X1", "GI-X2", "GI-X3"] },
    { id: "4.6", title: "Endocrine", question: "DKA, AKA, insulin started < 24 h before admission, or immediately s/p parathyroidectomy?", gate: "deny", failLabel: "Denied", rule_ids: ["DM-3", "END-X1", "END-X2", "END-X3"] },
    { id: "4.7", title: "Genitourinary", question: "Intermittent catheterization performed by medical staff?", gate: "deny", failLabel: "Denied", rule_ids: ["GU-X1"] },
    { id: "4.8", title: "Circulatory", question: "IV BP medication in 24 h, symptomatic/unresponsive hypertension, unstable arrhythmia, or EF < 25%?", gate: "deny", failLabel: "Denied", rule_ids: ["CARD-5", "CARD-6", "CIR-X1", "CIR-X2"] },
    { id: "4.9", title: "Neurology", question: "Stroke with residual deficit, new seizure with impairment, moderate/severe TBI, or spinal fusion?", gate: "deny", failLabel: "Denied", rule_ids: ["NEU-X1", "NEU-X2", "NEU-X3", "NEU-X4"] },
    { id: "4.10", title: "Neurosurgery escalation", question: "Immediately status-post neurosurgery?", gate: "human_review", failLabel: "Human review · specialized clinical review", rule_ids: ["NEU-X6"] },
    { id: "4.11", title: "System-specific requirements", question: "ED diabetic stabilization, A-fib control, oral antibiotics and glucometer/insulin self-management where applicable.", gate: "deny", failLabel: "Denied", rule_ids: ["DM-2", "CARD-4", "ID-2", "DM-5", "DM-6"] },
    { id: "4.12", title: "Eligible conditions (context)", question: "Examples of conditions IHH accepts; not universal requirements.", gate: "context", failLabel: "", rule_ids: eligibleContext },
  ] },
  { id: "stage-5", number: 5, title: "Conditional services", summary: "Eligible only once the external order or schedule is in place before intake.", steps: [
    { id: "5.1", title: "Required arrangements", question: "Home health, IV maintenance, O2 delivery, staple/suture removal, catheter, dialysis, cardiac, hospice, diabetic and PT follow-up arranged?", gate: "conditional", failLabel: "Conditional · pending arrangements",
      rule_ids: ["INT-E2", "INT-E6", "INT-E7", "OTH-3", "ID-3", "INT-E3", "RESP-3", "INT-E5", "GU-E5", "GU-E6", "GU-E7", "CIR-E5", "EOL-1", "DM-4", "MSK-E2"] },
  ] },
  { id: "stage-6", number: 6, title: "Required documentation", summary: "All required clinical documentation is in the packet.", steps: [
    { id: "6.1", title: "Document checklist", question: "Referral form, facesheet, payer authorization, H&P, progress notes, vitals, medications, PT/OT notes, cultures, 30-day supply.", gate: "rfi", failLabel: "RFI · pending documentation",
      rule_ids: ["DOC-1", "DOC-2", "DOC-3", "DOC-4", "DOC-5", "DOC-6", "DOC-7", "DOC-8", "DOC-9", "DOC-10"] },
    { id: "6.2", title: "Clinical objective verification", question: "PT/OT notes, negative MRSA and COVID swabs, 5 vitals, 5 glucoses, troponins, EKG and chest imaging where applicable.", gate: "rfi", failLabel: "RFI · pending documentation",
      rule_ids: ["MOB-2", "INF-1", "INF-2", "RESP-2", "CARD-1", "DM-1", "CARD-2", "CARD-3", "RESP-1", "RESP-4"] },
    { id: "6.3", title: "Intake questions", question: "Information to collect; never an admission gate.", gate: "info", failLabel: "", rule_ids: questions },
  ] },
];

export const ruleStep = new Map(decisionTree.flatMap(stage => stage.steps.flatMap(step => step.rule_ids.map(id => [id, { stage, step }] as const))));

export type StepOutcome = "pass" | "fail" | "unresolved" | "not_reviewed" | "info" | "manual";
export type TreeOutcome = "approved" | "denied" | "human_review" | "hold" | "conditional" | "rfi" | "needs_review" | "not_reviewed";
export type RuleState = { id: string; status: string };

const unreviewed = new Set(["not_reviewed", "pending"]);
/** Evaluate one step from rule statuses. Missing evidence never denies; it leaves the step unresolved. */
export function evaluateStep(step: TreeStep, statusOf: (id: string) => string | undefined): { outcome: StepOutcome; failing: string[]; open: string[] } {
  if (step.gate === "context" || step.gate === "info") return { outcome: "info", failing: [], open: [] };
  if (step.gate === "manual") return { outcome: "manual", failing: [], open: [] };
  const states = step.rule_ids.map(id => ({ id, status: statusOf(id) || "not_reviewed" }));
  if (states.some(s => unreviewed.has(s.status))) return { outcome: "not_reviewed", failing: [], open: [] };
  const anyOf = new Set(step.anyOf || []);
  const alternatives = states.filter(s => anyOf.has(s.id));
  const failing: string[] = [], open: string[] = [];
  if (alternatives.length && !alternatives.some(s => s.status === "met")) {
    if (alternatives.every(s => s.status === "not_met")) failing.push(...alternatives.map(s => s.id));
    else open.push(...alternatives.filter(s => s.status !== "not_met").map(s => s.id));
  }
  // Conditional arrangements and documents fail when absent; clinical gates only when explicitly not met.
  const absentFails = step.gate === "conditional" || step.gate === "rfi";
  for (const s of states.filter(s => !anyOf.has(s.id))) {
    if (s.status === "not_met" || (absentFails && s.status === "missing")) failing.push(s.id);
    else if (step.gate === "human_review" && s.status === "uncertain") failing.push(s.id);
    else if (["missing", "uncertain", "unknown", "concern"].includes(s.status)) open.push(s.id);
  }
  return { outcome: failing.length ? "fail" : open.length ? "unresolved" : "pass", failing, open };
}

const gateOutcome: Record<string, TreeOutcome> = { deny: "denied", human_review: "human_review", hold: "hold", conditional: "conditional", rfi: "rfi" };
export type StageResult = { stage: TreeStage; outcome: TreeOutcome | "pass"; steps: { step: TreeStep; outcome: StepOutcome; failing: string[]; open: string[] }[] };

/** Walk the tree: a confirmed denial anywhere decides; then the first routing stage; then open items; then pending arrangements/documents. */
export function evaluateTree(rules: RuleState[]): { outcome: TreeOutcome; stage: TreeStage | null; rule_ids: string[]; stages: StageResult[] } {
  const statuses = new Map(rules.map(r => [r.id, r.status]));
  const stages: StageResult[] = decisionTree.map(stage => {
    const steps = stage.steps.map(step => ({ step, ...evaluateStep(step, id => statuses.get(id)) }));
    const failed = steps.filter(s => s.outcome === "fail").map(s => gateOutcome[s.step.gate]!);
    const order: TreeOutcome[] = ["denied", "human_review", "hold", "conditional", "rfi"];
    const outcome = order.find(o => failed.includes(o))
      || (steps.some(s => s.outcome === "unresolved") ? "needs_review" : steps.some(s => s.outcome === "not_reviewed") ? "not_reviewed" : "pass");
    return { stage, outcome, steps };
  });
  const ids = (s: StageResult, kind: "failing" | "open") => s.steps.flatMap(x => x[kind]);
  const pick = (outcome: TreeOutcome, kind: "failing" | "open" = "failing") => {
    const hits = stages.filter(s => s.outcome === outcome);
    return hits.length ? { outcome, stage: hits[0]!.stage, rule_ids: hits.flatMap(s => ids(s, kind)), stages } : null;
  };
  if (stages.every(s => s.outcome === "not_reviewed")) return { outcome: "not_reviewed", stage: null, rule_ids: [], stages };
  return pick("denied")
    || stages.filter(s => s.outcome === "human_review" || s.outcome === "hold").map(s => ({ outcome: s.outcome as TreeOutcome, stage: s.stage, rule_ids: ids(s, "failing"), stages }))[0]
    || pick("needs_review", "open") || pick("not_reviewed")
    || pick("conditional") || pick("rfi")
    || { outcome: "approved", stage: null, rule_ids: [], stages };
}

export const outcomeLabels: Record<TreeOutcome | "pass", string> = {
  approved: "Approved", denied: "Denied", human_review: "Human review", hold: "Hold / RFI", conditional: "Conditional · pending arrangements",
  rfi: "RFI · pending documentation", needs_review: "Needs review", not_reviewed: "Not yet reviewed", pass: "Pass",
};

/** Full rubric before any analysis: every criterion present, none reviewed. */
export function unreviewedRules() {
  return catalog.map(r => ({ ...r, status: "not_reviewed", fact_ids: [] as string[], note: "", human_review: r.human_review || false }));
}
