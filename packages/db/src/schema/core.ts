import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceIdNullable, json, bool } from './_helpers.js';

/* ---------- M02 Organisation & Shareholding ---------- */
export const legalEntities = sqliteTable('legal_entities', {
  id: id(),
  type: text('type').notNull(), // holding | mso | property | professional_holding | practice | hub | external_partner
  registeredName: text('registered_name').notNull(),
  tradingName: text('trading_name'),
  cipcNo: text('cipc_no'),
  vatNo: text('vat_no'),
  taxNo: text('tax_no'),
  bhfPracticeNo: text('bhf_practice_no'),
  accessionPrefix: text('accession_prefix'), // 4 letters for practices
  financialYearEnd: text('financial_year_end'), // MM-DD
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const entityRelationships = sqliteTable('entity_relationships', {
  id: id(),
  parentId: text('parent_id').notNull().references(() => legalEntities.id),
  childId: text('child_id').notNull().references(() => legalEntities.id),
  type: text('type').notNull(), // subsidiary | jv | management_agreement | lease | reading_services | referral_partner
  feeModel: json<{ basis: string; rate?: number; perStudyCents?: number }>('fee_model'),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  createdAt: createdAt(),
});

export const shareholdings = sqliteTable('shareholdings', {
  id: id(),
  entityId: text('entity_id').notNull().references(() => legalEntities.id),
  shareholderEntityId: text('shareholder_entity_id').references(() => legalEntities.id),
  shareholderUserId: text('shareholder_user_id'),
  shareholderName: text('shareholder_name').notNull(),
  shareClass: text('share_class').notNull().default('ordinary'),
  shares: integer('shares').notNull(),
  votingPct: integer('voting_pct'),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  createdAt: createdAt(),
});

export const sites = sqliteTable(
  'sites',
  {
    id: id(),
    practiceId: text('practice_id').notNull().references(() => legalEntities.id),
    code: text('code').notNull(), // short code e.g. UMH
    name: text('name').notNull(),
    address: text('address'),
    province: text('province'),
    lat: integer('lat'),
    lng: integer('lng'),
    phone: text('phone'),
    openingHours: json<Record<string, string>>('opening_hours'),
    hospitalPartnerId: text('hospital_partner_id'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sites_practice').on(t.practiceId)],
);

export const rooms = sqliteTable('rooms', {
  id: id(),
  siteId: text('site_id').notNull().references(() => sites.id),
  practiceId: text('practice_id').notNull(),
  name: text('name').notNull(),
  roomType: text('room_type').notNull(), // XR | CT | MR | US | MG | RF | DXA | PX
  licenceNo: text('licence_no'),
  licenceExpiry: text('licence_expiry'),
  rpoUserId: text('rpo_user_id'),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
});

export const modalities = sqliteTable('modalities', {
  id: id(),
  roomId: text('room_id').notNull().references(() => rooms.id),
  siteId: text('site_id').notNull(),
  practiceId: text('practice_id').notNull(),
  type: text('type').notNull(), // DX | CR | CT | MR | US | MG | RF | DXA | PX | NM
  vendor: text('vendor'),
  model: text('model'),
  serial: text('serial'),
  aeTitle: text('ae_title'),
  installDate: text('install_date'),
  warrantyUntil: text('warranty_until'),
  status: text('status').notNull().default('active'), // active | down | maintenance | decommissioned
  lastQaAt: text('last_qa_at'),
  nextQaDue: text('next_qa_due'),
  nextPmDue: text('next_pm_due'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------- M01 Identity & Access ---------- */
export const users = sqliteTable(
  'users',
  {
    id: id(),
    practiceId: practiceIdNullable(), // null = Group scope
    persona: text('persona').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    hpcsaNo: text('hpcsa_no'),
    hpcsaVerifiedAt: text('hpcsa_verified_at'),
    passwordHash: text('password_hash').notNull(),
    mfaEnabled: bool('mfa_enabled').notNull().default(false),
    language: text('language').notNull().default('en'),
    siteIds: json<string[]>('site_ids'),
    patientId: text('patient_id'), // for PAT users
    referrerId: text('referrer_id'), // for REF users
    status: text('status').notNull().default('active'),
    lastLoginAt: text('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email').on(t.email)],
);

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  practiceId: practiceIdNullable(), // selected tenant for group users
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
});

/* ---------- M21 Platform core ---------- */
export const events = sqliteTable(
  'events',
  {
    id: id(),
    practiceId: practiceIdNullable(),
    name: text('name').notNull(), // e.g. study.signed.v1
    aggregateType: text('aggregate_type'),
    aggregateId: text('aggregate_id'),
    payload: json<Record<string, unknown>>('payload').notNull(),
    actorUserId: text('actor_user_id'),
    createdAt: createdAt(),
    processedAt: text('processed_at'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('events_unprocessed').on(t.processedAt, t.createdAt)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    practiceId: practiceIdNullable(),
    userId: text('user_id'),
    persona: text('persona'),
    action: text('action').notNull(),
    objectType: text('object_type'),
    objectId: text('object_id'),
    details: json<Record<string, unknown>>('details'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_object').on(t.objectType, t.objectId)],
);

export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  practiceId: practiceIdNullable(),
  updatedAt: updatedAt(),
});

/** Versioned, effective-dated reference data: tariffs, ICD-10, DRLs, scheme rules, statements. */
export const referenceData = sqliteTable(
  'reference_data',
  {
    id: id(),
    kind: text('kind').notNull(), // tariff | icd10 | drl | scheme | rule_pack | statement | nmc | ...
    key: text('key').notNull(),
    practiceId: practiceIdNullable(),
    value: json<Record<string, unknown>>('value').notNull(),
    effectiveFrom: text('effective_from').notNull().default('2000-01-01'),
    effectiveTo: text('effective_to'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index('refdata_kind_key').on(t.kind, t.key)],
);

export const sequences = sqliteTable('sequences', {
  key: text('key').primaryKey(), // e.g. accession:<practiceId>:<yy>
  value: integer('value').notNull().default(0),
});

/* ---------- M03 Patient Master Index ---------- */
export const patients = sqliteTable(
  'patients',
  {
    id: id(),
    practiceId: text('practice_id').notNull(),
    epid: text('epid').notNull(), // enterprise patient id (12 digits + Luhn)
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: text('date_of_birth'),
    sex: text('sex'), // F | M | X
    language: text('language').notNull().default('en'),
    mobile: text('mobile'),
    email: text('email'),
    idType: text('id_type'), // sa_id | passport | none | temp
    idNumber: text('id_number'),
    idCountry: text('id_country'),
    idVerifiedAt: text('id_verified_at'),
    schemeId: text('scheme_id'),
    schemeName: text('scheme_name'),
    schemeOption: text('scheme_option'),
    memberNo: text('member_no'),
    dependantCode: text('dependant_code'),
    address: text('address'),
    guardianPatientId: text('guardian_patient_id'),
    consents: json<Record<string, { granted: boolean; at: string; channel?: string }>>('consents'),
    flags: json<string[]>('flags'), // e.g. contrast_reaction, pacemaker, interpreter:zu
    status: text('status').notNull().default('active'), // active | merged | deceased
    mergedIntoId: text('merged_into_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('patients_practice').on(t.practiceId), index('patients_epid').on(t.epid), index('patients_name').on(t.lastName, t.firstName)],
);

export const patientIdentifiers = sqliteTable('patient_identifiers', {
  id: id(),
  patientId: text('patient_id').notNull().references(() => patients.id),
  type: text('type').notNull(), // sa_id | passport | scheme | mrn | epid
  assigningAuthority: text('assigning_authority'),
  value: text('value').notNull(),
  verifiedAt: text('verified_at'),
  createdAt: createdAt(),
});

/* ---------- Referrer master (M04, shared) ---------- */
export const referrers = sqliteTable('referrers', {
  id: id(),
  practiceId: text('practice_id'), // null = shared across Group
  name: text('name').notNull(),
  hpcsaNo: text('hpcsa_no'),
  hpcsaVerifiedAt: text('hpcsa_verified_at'),
  bhfPracticeNo: text('bhf_practice_no'),
  discipline: text('discipline'), // GP | orthopaedics | oncology | casualty | occupational | ...
  practiceName: text('practice_name'),
  phone: text('phone'),
  email: text('email'),
  deliveryPrefs: json<{ whatsapp?: boolean; portal?: boolean; fhir?: boolean; phoneCritical?: string }>('delivery_prefs'),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
