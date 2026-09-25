import type { IdentityKeys } from "../identity.ts";

export type AcademicKind =
  | "CREATE_YEAR"
  | "CREATE_CLASSES"
  | "NEW_STUDENTS"
  | "TRANSFER_IN"
  | "ENROLLMENT"
  | "MOVE"
  | "PROMOTION"
  | "TRANSFER_OUT"
  | "UNDO";
export type Resources = {
  yearIds: string[];
  classIds: string[];
  studentIds: string[];
  historicalYearIds: string[];
};
export type AccessRequest = {
  action: AcademicKind | "READ_YEARS" | "READ_ROSTER";
  stage: "preview" | "confirm" | "read";
  resources: Resources;
  historyReason: string | null;
};
/** Implemented by trusted server authentication/authorization in Phase 3A/3B, never a request body. */
export type AccessGrant = {
  adminId: string;
  sessionId: string;
  recentGoogleAuthentication: boolean;
};
export type AcademicDependencies = {
  db: D1Database;
  authorize?: (request: AccessRequest) => Promise<AccessGrant | null>;
  identityKeys?: () => IdentityKeys;
  now?: () => number;
};
export type HistoryOptions = { historyReason?: string };
export type NewStudent = {
  name: string;
  birthDate: string;
  studentNumber: string;
  identityNumber: string;
  classId: string;
  seatNumber: number;
  effectiveFrom: string;
};
export type EnrollmentInput = {
  studentId: string;
  classId: string;
  seatNumber: number;
  effectiveFrom: string;
};
export type PromotionOverride = {
  studentId: string;
  classId: string;
  seatNumber: number;
};
export type Value = string | number | null;
export type Row = Record<string, Value>;
export type Table =
  | "academic_years"
  | "academic_terms"
  | "classes"
  | "students"
  | "student_enrollments"
  | "student_identity_lookup_hashes"
  | "retention_events";
export type Change = { table: Table; key: Row; before: Row | null; after: Row };
export type Plan = {
  kind: AcademicKind;
  changes: Change[];
  resources: Resources;
  display: Row[];
  undoOf: string | null;
  keyVersions: string | null;
};
export type Preview = {
  id: string;
  kind: AcademicKind;
  revision: number;
  rows: Row[];
  requiresConfirmation: true;
};
export type Receipt = {
  operationId: string;
  kind: AcademicKind;
  revision: number;
  studentIds: string[];
  yearIds: string[];
  classIds: string[];
  replayed: boolean;
};

export class AcademicError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AcademicError";
    this.code = code;
  }
}
