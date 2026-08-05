/**
 * Types mirroring the API contract (docs/API_CONTRACT.md).
 *
 * Hand-written rather than generated, because the generated client would be another moving
 * part on a 30-day build. They must stay in step with `backend/openapi.yaml` — if a field
 * here disagrees with the schema, the schema is right.
 */

export type UserRole = 'super_admin' | 'admin' | 'mpp_operator' | 'mait';

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface CurrentUser {
  id: number;
  username: string;
  full_name: string;
  email: string;
  mobile_no: string;
  role: UserRole;
  role_display: string;
  is_active: boolean;
  last_login_at: string | null;
  mait_id: number | null;
  sahayak_vendor_code: string | null;
  /** The MPPs this Mait may work at. Scopes everything the app shows (SRS §6.2.3). */
  assigned_mpp_codes: string[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface MPP {
  id: number;
  mpp_code: string;
  mpp_name: string;
  district_code: string;
  tehsil_code: string;
  village_code: string;
  mobile_no: string;
  is_active: boolean;
  mait: number | null;
  mait_name: string | null;
}

export interface Member {
  id: number;
  member_code: string;
  member_name: string;
  father_husband_name: string;
  mobile_no: string;
  mpp_code: string;
  activation_status: string;
}

export interface MemberDetail extends Member {
  gender: string;
  age: number | null;
  cattle_holding: number | null;
  /** Aadhaar arrives masked (XXXXXXXX1234) and is never available in full here. */
  aadhar_no: string;
  bank_name: string;
  folio_no: string;
  mpp_name: string;
  /**
   * Whether a payment can be authorised for this member.
   *
   * 1.5% of the real SAP member records carry an unusable mobile number. Checking before
   * the flow starts avoids stranding a Mait at the payment step with the insemination
   * already performed and no way to close the event (docs/DATA_FINDINGS.md §2).
   */
  can_receive_otp: boolean;
}

export interface NonMember {
  id: number;
  name: string;
  mobile_no: string;
  address: string;
  mpp: number;
  created_by_mait: number;
  created_at: string;
}

export interface NonMemberDraft {
  name: string;
  mobile_no: string;
  address?: string;
  mpp: number;
}

/** RFC 7807 problem details — the shape of every API error (SRS §9.11). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: Record<string, string[]>;
  request_id?: string;
}
