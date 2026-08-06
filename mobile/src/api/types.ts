/**
 * Types mirroring the API contract (docs/API_CONTRACT.md).
 *
 * Hand-written rather than generated, because the generated client would be another moving
 * part on a 30-day build. They must stay in step with `backend/openapi.yaml` — if a field
 * here disagrees with the schema, the schema is right.
 */

export type UserRole = 'super_admin' | 'admin' | 'mait';

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
  /** Step 3 picks from these, so the screen costs no second round trip (SRS §6.3). */
  animals: Animal[];
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

/** Non-member detail carries the animals already registered to them (SRS §6.3 step 3). */
export interface NonMemberDetail extends NonMember {
  animals: Animal[];
}

// ---- animals -------------------------------------------------------------------------
export type AnimalTypeCode = 'COW' | 'BUFF';

/**
 * A breed option.
 *
 * Config-driven rather than an enum in the app: the authoritative list is still open
 * (SRS §18.2) and has to be changeable without shipping a new build to every handset.
 */
export interface BreedConfig {
  code: string;
  name: string;
  name_hi: string;
  animal_type: AnimalTypeCode;
  display_order: number;
}

export interface Animal {
  id: number;
  owner_type: 'member' | 'non_member';
  member: number | null;
  non_member: number | null;
  owner_name: string;
  animal_type: AnimalTypeCode;
  animal_type_display: string;
  breed: string;
  ear_tag_no: string | null;
  ai_event_count: number;
  created_at: string;
}

export interface AnimalDraft {
  member_code?: string;
  non_member_id?: number;
  animal_type: AnimalTypeCode;
  breed: string;
  ear_tag_no?: string;
}

// ---- inventory -----------------------------------------------------------------------
export interface SemenBatch {
  id: number;
  unique_straw_no: string;
  breed: string;
  bull_id: string;
  semen_station: string;
  received_date: string;
}

/**
 * The answer to a scan.
 *
 * `reason` is a stable code, never a message: "not in your stock" means raise an indent and
 * "already used" means report it, and those are different actions. Branching on translated
 * prose would break the moment the app runs in Hindi.
 */
export interface StrawValidation {
  valid: boolean;
  reason: 'not_in_stock' | 'already_used' | null;
  straw: SemenBatch | null;
  available_straws: number;
}

export interface InventorySummary {
  total_straws: number;
  is_low_stock: boolean;
  by_breed: Record<string, number>;
  consumables: { name: string; qty: number }[];
}

// ---- AI event ------------------------------------------------------------------------
export type AIEventStatus =
  'draft' | 'straw_verified' | 'photo_captured' | 'payment_pending' | 'completed' | 'cancelled';

export interface AIEvent {
  id: number;
  client_uuid: string;
  status: AIEventStatus;
  status_display: string;
  mpp: number;
  mpp_code: string;
  mpp_name: string;
  owner_type: 'member' | 'non_member';
  member: number | null;
  non_member: number | null;
  owner_name: string;
  animal: number;
  animal_type: AnimalTypeCode;
  breed: string;
  ear_tag_no: string | null;
  straw_unique_no: string;
  ai_photo_url: string;
  gps_lat: string | null;
  gps_lng: string | null;
  performed_at: string | null;
  completed_at: string | null;
  cancelled_reason: string;
  created_at: string;
}

/**
 * `client_uuid` is generated on the device before the first send, so an event queued offline
 * keeps one identity across however many retries it takes to land (ADR 0003). A repeat
 * returns the event that already exists rather than recording the insemination twice.
 */
export interface AIEventDraft {
  client_uuid: string;
  mpp_code: string;
  member_code?: string;
  non_member_id?: number;
  animal_id: number;
  straw_unique_no?: string;
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
