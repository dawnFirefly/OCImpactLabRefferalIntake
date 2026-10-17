Decisioning criteria 

[Inbound Referral Packet Received]
  │
  ▼
Stage 1: General & Payer Eligibility Gate
  ├── [Fail: Not unhoused / no risk / >182 days CalAIM] ──► DENIED (GEN-1/2/3, CalAIM Cap)
  └── [Pass] ──► Stage 2

Stage 2: Safety, Behavioral & Cognitive Filter
  ├── [Aggressive / SI / Hallucinations / 5150 / Conservatorship / Non-compliant] ──► DENIED
  ├── [Sex Offender / Neurosurgery] ──► HUMAN REVIEW (OTH-2 / NEU-X6)
  ├── [Uncleared Acute Alcohol Intoxication] ──► HOLD / RFI (72-hr hold & CIWA-AR required)
  └── [Pass] ──► Stage 3

Stage 3: Functional Mobility & ADL Filter
  ├── [Dependent ADLs / Transfer assist needed / Unable to walk 100 ft] ──► DENIED (ADL-1/2/3, MOB-3/4)
  └── [Pass] ──► Stage 4

Stage 4: Medical Stability & Clinical Exclusions
  ├── [Sepsis / BiPAP / Open Fx / Cirrhosis / Active Sepsis / IV BP Meds / EF <25%] ──► DENIED (System Ineligible)
  └── [Pass] ──► Stage 5

Stage 5: Conditional Services Verification
  ├── [Home Health, O2, Dialysis, or Follow-ups unconfirmed] ──► CONDITIONAL PENDING ARRANGEMENTS
  └── [Pass / Arrangements Confirmed] ──► Stage 6

Stage 6: Required Documentation Completeness
  ├── [Missing MRSA, COVID, 5 Vitals, 5 Glucoses, or PT/OT notes] ──► RFI / PENDING DOCUMENTATION
  └── [All Present] ──► APPROVED





Stage
Condition / Failure Criteria
Outcome / Next Step
Stage 1: General & Payer Eligibility
Not unhoused / no risk / >182 days CalAIM
DENIED (GEN-1/2/3, CalAIM Cap)
Stage 1 (Pass)
Passes general eligibility checks
Proceed to Stage 2
Stage 2: Safety & Behavioral
Aggressive / Suicidal / Hallucinations / 5150 / Conservatorship / Non-compliant
DENIED
Stage 2: Special Review
Registered Sex Offender / Neurosurgery
HUMAN REVIEW (OTH-2 / NEU-X6)
Stage 2: Alcohol Clearance
Uncleared Acute Alcohol Intoxication
HOLD / RFI (72-hr hold & CIWA-AR required)
Stage 2 (Pass)
Passes behavioral and safety filters
Proceed to Stage 3
Stage 3: Mobility & ADL
Dependent ADLs / Transfer assist needed / Unable to walk 100 ft
DENIED (ADL-1/2/3, MOB-3/4)
Stage 3 (Pass)
Passes mobility and functional checks
Proceed to Stage 4
Stage 4: Medical Stability
Sepsis / BiPAP / Open Fx / Cirrhosis / IV BP Meds / EF <25%
DENIED (System Ineligible)
Stage 4 (Pass)
Passes clinical exclusion criteria
Proceed to Stage 5
Stage 5: Conditional Services
Home Health, O2, Dialysis, or Follow-ups unconfirmed
CONDITIONAL PENDING ARRANGEMENTS
Stage 5 (Pass)
Required services arranged or confirmed
Proceed to Stage 6
Stage 6: Documentation
Missing MRSA, COVID, 5 Vitals, 5 Glucoses, or PT/OT notes
RFI / PENDING DOCUMENTATION
Stage 6 (Complete)
All documentation verified and present
APPROVED

Stage 1: General & Payer Eligibility Gate
The AI evaluator checks baseline qualifications. The internal admission criteria outline supersedes all hospital referral forms.
Step 1.1: Qualifying Living Situation
Does the patient meet at least one of the general criteria?
Homeless or at risk of homelessness, and too ill/frail to recover outside (GEN-1).
Lives alone with no formal supports, and too ill/frail to recover (GEN-2).
At risk of hospitalization or re-hospitalization (GEN-3).
Evaluation:
If NO to all three  DENY (GEN-1/2/3: Ineligible living situation).
If YES  Proceed to Step 1.2.
Step 1.2: Cumulative CalAIM Cap Verification
Does the referral indicate >182 days of combined Recuperative Care, Short-Term Post-Hospitalization Housing (STPHH), or Transitional Rent in a rolling 12-month period?
If YES  DENY (Exceeded CalAIM 182-day global cap).
If NO  Proceed to Stage 2.
Stage 2: Behavioral Safety, Mental Health & Cognition Filter
Evaluates psychiatric safety, legal boundaries, and cognitive independence.
Step 2.1: Behavioral and Legal Hard Exclusions
Is the patient verbally or physically aggressive toward staff or other patients (OTH-1, FORM-X7)?
Does the patient have active suicidal ideation (MH-2)?
Does the patient have commanding auditory or visual hallucinations (MH-3)?
Does the patient have a history of, or currently remain under, a conservatorship or Full Service Partnership (FSP) (MH-5)?
Is the patient non-compliant with detox treatment or refusing to abstain from substance abuse (FORM-X5)?
Evaluation:
If YES to any  DENY (Specify matching rule ID).
If NO  Proceed to Step 2.2.
Step 2.2: Sex Offender Evaluation (Precedence Rule)
Is the patient a registered sex offender (OTH-2)?
Evaluation:
Note: The outline supersedes FORM-X6. Do not auto-deny.
If YES  Route to HUMAN REVIEW (OTH-2: Case-by-case review; violent offenses will likely be denied).
If NO  Proceed to Step 2.3.
Step 2.3: Cognitive & Self-Administration Independence
Is the patient Alert & Oriented 4 (COG-2, FORM-M3)?
Does the patient have dementia, Alzheimer's, or severe neurocognitive impairment (NEU-X5, FORM-X1)?
Is the patient capable of self-administering all medications (including insulin if diabetic) and receiving health education (COG-1, FORM-M5)?
Evaluation:
If Not A&Ox4, has dementia, or cannot self-administer medications  DENY (COG-1, COG-2, or NEU-X5).
If PASS  Proceed to Step 2.4.
Step 2.4: Acute Alcohol Intoxication Clearance
Was the patient admitted for acute alcohol intoxication (MH-4)?
Evaluation:
If YES, have they been held for 72 hours and maintained CIWA-AR <8 without active withdrawal signs?
If NO  HOLD / RFI (Must complete 72-hour hold and reach CIWA-AR <8).
If YES / PASS  Proceed to Stage 3.
Stage 3: Functional Mobility & ADL Filter
Evaluates physical ability. Physical therapy and occupational therapy notes govern these decisions.
Step 3.1: Basic Activities of Daily Living (ADLs)
Is the patient able to complete all ADLs independently (ADL-1, FORM-M4)?
Can the patient gather supplies, transfer, and shower/bathe independently (seated shower bench allowed) (ADL-2)?
Can the patient toilet independently and/or change briefs/diapers independently without staff assist (ADL-3)?
Evaluation:
If NO to any  DENY (ADL-1/2/3: Requires SNF-level personal assistance).
If YES  Proceed to Step 3.2.
Step 3.2: Mobility and Transfers (Precedence Rule)
Does the patient use a wheelchair (MOB-4)?
If YES: Can the patient transfer independently (MOB-4) and self-propel/use the wheelchair independently (MOB-1)?
If YES  PASS MOBILITY (The internal criteria outline supersedes the referral form's 100 ft walk mandate; wheelchair patients who transfer independently are eligible).
If NO (requires 1-person or 2-person assist to transfer)  DENY (MOB-4: Wheelchair-dependent patient cannot transfer independently).
If NO (Non-wheelchair dependent): Can the patient ambulate 100 feet at modified independence (rest breaks allowed) using DME independently if needed (MOB-1, MOB-3)?
If NO (e.g., non-weight-bearing without single-leg hopping, or requires human assistance)  DENY (MOB-3: Unable to ambulate 100 ft at modified independence).
If YES  Proceed to Stage 4.
Stage 4: Clinical & Organ System Exclusion Matrix
Examines specific clinical conditions and vital signs across body systems. Any positive match in this table triggers an AUTO-DENIAL.

Body System
Ineligible Trigger Conditions
Governing Rule ID
Infection & Vitals
Sepsis physiology on last 5 vitals (sustained fever, tachycardia, hypotension); active uncleared MRSA, Tuberculosis, or C. diff; uncleared medical isolation.
ID-1, OTH-4, FORM-X4


Integumentary
Complicated wounds requiring skin grafting; complicated large abscess; burns with inhalation injury; burns $\ge 15\%$ BSA.
INT-X1, INT-X2, INT-X3, INT-E7


Respiratory
Respiratory conditions requiring BiPAP; pneumothorax; hemothorax; trach with ventilator; pulmonary embolism (acute).
RSP-X1 through RSP-X5


Musculoskeletal
Open fractures; osteomyelitis; external fixation devices; immediate post-amputation with wounds; facial trauma requiring jaw wiring.
MSK-X1 through MSK-X5


Gastrointestinal
Decompensated cirrhosis (portal hypertension, ascites, variceal bleed, hepatic encephalopathy, jaundice); immediate post-hospitalization for bleeding ulcer or varices; active C. diff.
GI-X1, GI-X2, GI-X3


Endocrine
Diabetic ketoacidosis (DKA); alcoholic ketoacidosis (AKA); started on insulin regimen <24 hours prior to admission; immediate s/p parathyroidectomy.
DM-3, END-X1, END-X2, END-X3


Genitourinary
Intermittent catheterization requiring medical staff administration.
GU-X1


Circulatory
IV blood pressure medications required within last 24 hours; symptomatic/unresponsive hypertension (SBP170 or DBP100); unstable cardiac arrhythmias; baseline Ejection Fraction (EF) $<25\%$; immediately discharged post-heart attack with lowered EF or on chemotherapy.
CARD-5, CARD-6, CIR-E4, CIR-X1, CIR-X2


Neurology
Stroke syndrome with persistent residual/deficit; new onset seizure with impairment; moderate/severe traumatic brain injury; cervical or lumbar fusion.
NEU-X1, NEU-X2, NEU-X3, NEU-X4



Neurosurgery Escalation Check: Is the patient immediately status-post neurosurgery (NEU-X6)?
If YES  Route to HUMAN REVIEW (NEU-X6: Escalate for specialized clinical review).
System Pass Check:
If any trigger condition is confirmed  DENY (List specific rule ID).
If clear of all exclusions  Proceed to Stage 5.
Stage 5: Conditional Requirements Verification
Certain active treatments are eligible only if mandatory external orders and schedules are established before intake.



IF condition exists:
  ├── Wound care / Ulcers / Burns / Hard-to-reach wounds (INT-E2, INT-E6, INT-E7)
  │     └── CHECK: Home Health Agency (HHA) ordered and scheduled?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD (Must coordinate HHA prior to arrival)
  │
  ├── IV Access / IV Antibiotics (OTH-3, ID-3, INT-E3)
  │     └── CHECK: HHA ordered to maintain IV and administer medication?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD (HHA must be ordered before admission)
  │
  ├── Continuous Oxygen Therapy (RESP-3)
  │     └── CHECK: Hospital ordered O2 tank/concentrator to arrive at site the day BEFORE arrival?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD (O2 must be delivered 1 day prior)
  │
  ├── Surgical Staples or Sutures Present (INT-E5)
  │     └── CHECK: Follow-up scheduled for removal?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD (Removal follow-up must be scheduled)
  │
  ├── Indwelling / Self-Catheterization (GU-E5, GU-E6)
  │     └── CHECK: Self-cath verified OR removal follow-up scheduled?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD
  │
  ├── Hemodialysis Dependent (GU-E7)
  │     └── CHECK: Dialysis chair, clinic location, and transportation schedule confirmed?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD
  │
  ├── Cardiac Surgery (CABG / Valve replacement) (CIR-E5)
  │     └── CHECK: Stable BP, normal Hgb/Hct, normal EF, no arrhythmias, HHA ordered, cardiology f/u booked?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD
  │
  ├── Hospice Patient (EOL-1)
  │     └── CHECK: Hospice services arranged; family/patient notified IHH staff do not administer meds?
  │           ├── YES ──► PASS
  │           └── NO  ──► CONDITIONAL HOLD
  │
  └── Poorly Controlled Diabetes from Emergency Department (DM-4)
        └── CHECK: PCP f/u scheduled within 5-7 days, no hypoglycemia in last week, written plan provided?
              ├── YES ──► PASS
              └── NO  ──► CONDITIONAL HOLD


Evaluation:
If any required arrangement is missing  Issue CONDITIONAL APPROVAL (PENDING EXTERNAL ARRANGEMENTS) specifying the missing order.
If all necessary arrangements are in place (or not applicable)  Proceed to Stage 6.
Stage 6: Required Documentation Completeness Gate
Verifies that all required clinical documentation has been transmitted in the referral packet.
Step 6.1: Document Checklist (DOC-1 through DOC-10)
IHH Referral Form (or equivalent facesheet clinical referral).
Demographic / Patient Facesheet.
CalOptima / Payer Community Supports Authorization Request.
Complete History & Physical (H&P).
Current Physician Progress Notes.
Medication Administration Record (eMAR) / 30-day medication supply confirmation.
Step 6.2: Clinical Objective Verification Tests
PT/OT or Nursing ADL Notes (MOB-2, DOC-8): Must be present to substantiate functional ambulation and transfer claims.
Infection Control Swabs (Inpatient Discharges):
Documented negative MRSA swab (INF-1).
Documented negative COVID swab within 24 hours of arrival (INF-2)[cite: 249, 250].
Vital Sign Trends (ID-1, RESP-2, CARD-1): Last 5 consecutive sets of vital signs confirming hemodynamic stability without sepsis physiology[cite: 249, 250].
Blood Glucose Logs (Inpatient Diabetics) (DM-1): 5 consecutive glucose readings showing stabilization and improvement[cite: 249, 250].
Troponins (If tested) (CARD-2): At least 3 consecutive troponin results with 2 negative results[cite: 249, 250].
EKG & Chest Imaging (CARD-3, RESP-1): Attached if admitted for cardiac or respiratory conditions[cite: 249, 250].
Evaluation:
If critical diagnostic evidence is missing (e.g., pending PT note, missing MRSA/COVID swab, missing 5-vital trend)  REQUEST FOR INFORMATION (RFI) / PENDING DOCUMENTATION.
If all documentation is validated  Proceed to Stage 7.
