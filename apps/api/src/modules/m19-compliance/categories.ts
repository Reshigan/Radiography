/**
 * Reportable imaging result categories (docs/24 §3). The statements are legally reviewed standard
 * wording; free text is never generated for them (M19-R-302). The Platform never notifies a regulator
 * from a report: the referrer acknowledges and the practitioner notifies.
 */
export interface ReportableCategory {
  id: string;
  label: string;
  basis: string;
  notifier: string;
  ackWindowHours: number;
  pack: string;
  withholdPatientRelease: boolean;
  statement: string;
}

export const REPORTABLE_CATEGORIES: ReportableCategory[] = [
  {
    id: 'tb_suggestive', label: 'TB-suggestive: consider notifiable medical condition',
    basis: 'Regulations relating to the Surveillance and the Control of Notifiable Medical Conditions (GN R1434 of 2017); category and period per the current schedule [confirm]',
    notifier: 'The health care provider who makes the clinical or laboratory diagnosis (usually the referrer)',
    ackWindowHours: 24, pack: 'NMC guidance and notification channel', withholdPatientRelease: false,
    statement: 'The appearances raise the possibility of pulmonary tuberculosis. This is a radiological appearance and not a diagnosis. Tuberculosis is a notifiable medical condition; the diagnosing practitioner should consider notification through the NMC system.',
  },
  {
    id: 'nai_child', label: 'Suspected non-accidental injury (child)',
    basis: 'Children’s Act 38 of 2005, s.110 (mandatory reporting by listed professionals including medical practitioners)',
    notifier: 'Radiologist and referrer; the institution supports the report',
    ackWindowHours: 1, pack: 'Children’s Act s.110 form pre-filled from demographics; skeletal survey protocol offered', withholdPatientRelease: true,
    statement: 'The pattern of injury is of concern for non-accidental injury. The Children’s Act s.110 places a reporting duty on listed professionals who on reasonable grounds conclude that a child has been abused. A safeguarding case has been opened and patient-facing release is withheld pending clinician review.',
  },
  {
    id: 'elder_abuse', label: 'Suspected abuse of an older person',
    basis: 'Older Persons Act 13 of 2006, s.26 (duty on any person who suspects abuse)',
    notifier: 'Radiologist and referrer', ackWindowHours: 4, pack: 'Older Persons Act s.26 report route', withholdPatientRelease: true,
    statement: 'The findings raise concern for abuse or neglect of an older person. The Older Persons Act s.26 places a duty on any person who suspects such abuse to report it to the Director-General or a police official.',
  },
  {
    id: 'sexual_offence', label: 'Findings suggesting a sexual offence against a child or a person with a mental disability',
    basis: 'Criminal Law (Sexual Offences and Related Matters) Amendment Act 32 of 2007, s.54',
    notifier: 'Any person with knowledge', ackWindowHours: 1, pack: 'Sexual Offences Act s.54 report route; safeguarding case', withholdPatientRelease: true,
    statement: 'The findings raise concern for a sexual offence against a child or a person who is mentally disabled. Section 54 of the Sexual Offences Act places a reporting duty on any person with such knowledge. A safeguarding case has been opened.',
  },
  {
    id: 'occupational_lung', label: 'Possible occupational lung disease (ILO classification)',
    basis: 'COIDA occupational disease reporting; ODMWA for mineworkers with MBOD certification',
    notifier: 'Employer reports; treating practitioner completes the medical reports; MBOD certifies for miners',
    ackWindowHours: 24, pack: 'ODMWA / MBOD pack for the employer and the occupational health practitioner', withholdPatientRelease: false,
    statement: 'The appearances are consistent with possible occupational lung disease. Where the examination is an ODMWA benefit medical examination, an ILO-classified reading by a qualified reader applies and the record is retained under the occupational retention class.',
  },
  {
    id: 'radiation_incident', label: 'Radiation incident: wrong-patient or unintended exposure',
    basis: 'Hazardous Substances Act 15 of 1973 and SAHPRA Radiation Control licence conditions [confirm reporting period]',
    notifier: 'The licence holder through the RPO and CMP', ackWindowHours: 4, pack: 'SAHPRA notification drafted by the Compliance Hand; internal investigation', withholdPatientRelease: false,
    statement: 'An unintended exposure has been recorded against this study. The Radiation Protection Officer has been informed, the patient dose has been estimated and an incident investigation is open under the licence conditions.',
  },
  {
    id: 'malignancy_followup', label: 'Suspicious for malignancy: follow-up tracking',
    basis: 'Standard of care and the HPCSA duty to communicate; National Cancer Registry notification is a duty of laboratories and treating clinicians [confirm scope]',
    notifier: 'Treating clinician', ackWindowHours: 24, pack: 'Follow-up loop with the Follow-up Hand; oncology referral tracking', withholdPatientRelease: true,
    statement: 'The appearances are suspicious for malignancy. This is a radiological appearance and not a tissue diagnosis. Referrer acknowledgement is required and the follow-up recommendation is tracked to closure.',
  },
  {
    id: 'nmc_other', label: 'Other notifiable medical condition pattern',
    basis: 'NMC Regulations (GN R1434 of 2017) [confirm imaging-relevant list]',
    notifier: 'Diagnosing practitioner', ackWindowHours: 24, pack: 'NMC reference list and notification channel', withholdPatientRelease: false,
    statement: 'The appearances may be associated with a notifiable medical condition. This is a radiological appearance and not a diagnosis; the diagnosing practitioner should consider notification.',
  },
  {
    id: 'incidental_followup', label: 'Incidental finding requiring follow-up',
    basis: 'Standard of care and the HPCSA duty to communicate',
    notifier: 'Treating clinician', ackWindowHours: 48, pack: 'Follow-up recommendation with interval; Follow-up Hand tracking', withholdPatientRelease: false,
    statement: 'An incidental finding requiring interval follow-up has been recorded. The recommendation and its interval are tracked to closure.',
  },
];

const byId = new Map(REPORTABLE_CATEGORIES.map((c) => [c.id, c]));
const ALIASES: Record<string, string> = {
  tb: 'tb_suggestive', tuberculosis: 'tb_suggestive', 'tb-suggestive': 'tb_suggestive',
  nai: 'nai_child', non_accidental_injury: 'nai_child', safeguarding: 'nai_child',
  malignancy: 'malignancy_followup', cancer: 'malignancy_followup', suspicious_for_malignancy: 'malignancy_followup',
  occupational: 'occupational_lung', ilo: 'occupational_lung', silicosis: 'occupational_lung',
  radiation: 'radiation_incident', wrong_patient: 'radiation_incident', overexposure: 'radiation_incident',
  elder: 'elder_abuse', incidental: 'incidental_followup',
};

/** Resolve a category code from a report.signed.v1 payload; unknown codes fall back to the generic NMC row. */
export function categoryFor(code: string): ReportableCategory {
  const key = code.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return byId.get(key) ?? byId.get(ALIASES[key] ?? '') ?? byId.get('nmc_other')!;
}
