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
  /** Annotated by the list endpoint. Members registered at this collection point. */
  member_count: number;
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
  father_husband_name: string;
  mobile_no: string;
  address: string;
  /** Read-only and masked (SRS §16). The raw number never comes back to the handset. */
  masked_aadhar: string;
  mpp: number;
  created_by_mait: number;
  created_at: string;
}

/** Exactly one of the two ways to name a farmer to the API. */
export type FarmerKey = { member_code: string } | { non_member_id: number };

export interface FarmerOtpSent {
  /** Masked — `••••• 20448`. Enough to read out, not enough to copy off the screen. */
  mobile_no: string;
  expires_in_seconds: number;
}

export interface NonMemberDraft {
  name: string;
  father_husband_name?: string;
  mobile_no: string;
  address?: string;
  /** Twelve digits, or omitted. Write-only — the server stores it encrypted. */
  aadhar_no?: string;
  mpp: number;
  /**
   * She agreed to her details being held. Write-only; the server stamps the time.
   *
   * Sent rather than assumed: the tick on the handset gates the button, but a gate is not a
   * record, and the record is what SRS §7 asks for.
   */
  consent?: boolean;
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
  /** Her portrait, taken at registration. Empty when nobody has photographed her. */
  photo_url: string;
  ai_event_count: number;
  /** When this animal was last served. Null until she has been. */
  last_ai_at: string | null;
  created_at: string;
}

export interface AnimalDraft {
  member_code?: string;
  non_member_id?: number;
  animal_type: AnimalTypeCode;
  /**
   * Her own breed, not the straw's — and optional, because the capture flow does not ask for
   * it. A Mait registering a cow in a yard often cannot say what she is, and a required field
   * there would collect guesses. The portal and `PATCH /animals/{id}/` can fill it in later.
   */
  breed?: string;
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
  reason: 'not_in_stock' | 'already_used' | 'breed_required' | null;
  straw: SemenBatch | null;
  available_straws: number;
  /**
   * Breeds held as unnumbered stock, sent with `breed_required`.
   *
   * Straws issued as a quantity carry no numbers until used, so a number the server has
   * never seen is not a mistake — but with two bundles in the flask, only the Mait can say
   * which one the straw came out of.
   */
  breed_choices?: string[];
}

export interface StockLine {
  code: string;
  name: string;
  unit: string;
  qty: number;
}

export interface InventorySummary {
  total_straws: number;
  is_low_stock: boolean;
  by_breed: Record<string, number>;
  /** Used up and reordered — sheaths, gloves, liquid nitrogen. */
  consumables: StockLine[];
  /** Issued once and kept — AI gun, thawing tray. */
  assets: StockLine[];
}

/** A product a Mait can ask for. Straws are absent: those are requested by breed. */
export interface Product {
  id: number;
  code: string;
  name: string;
  category: 'consumable' | 'asset';
  category_display: string;
  unit: string;
  display_order: number;
}

// ---- payment -------------------------------------------------------------------------
/** How one insemination was paid for. A member's is a deduction; a non-member's is collected. */
export interface Payment {
  id: number;
  ai_event: number;
  amount: string;
  mode: 'DEDUCT' | 'COD' | 'ONLINE';
  mode_display: string;
  status: 'pending' | 'verified' | 'failed';
  status_display: string;
  is_verified: boolean;
  member_otp_verified: boolean;
  cod_otp_verified: boolean;
  utr_number: string;
  payment_screenshot_url: string;
  failure_reason: string;
  created_at: string;
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
  /** The breed of straw held for this event. */
  semen_breed: string;
  /**
   * What this insemination costs, in rupees, decided by the server.
   *
   * Null where the administrator has not priced the breed for this kind of farmer. The app
   * then says the service is chargeable without naming a figure — a number the system cannot
   * stand behind is heard by the farmer as final.
   */
  amount_due: string | null;
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
  /**
   * Breed of the straw used.
   *
   * Only needed when the number is not on record yet and the Mait carries unnumbered stock
   * in more than one breed — the number alone cannot say which bundle it came from.
   */
  semen_breed?: string;
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

// ---- indents -------------------------------------------------------------------------
export type IndentStatus = 'requested' | 'approved' | 'issued' | 'rejected';

export interface Indent {
  id: number;
  breed: string;
  item: string;
  qty_requested: number;
  qty_issued: number;
  status: IndentStatus;
  status_display: string;
  sync_status: 'pending' | 'synced' | 'failed';
  sync_status_display: string;
  requested_at: string;
  issued_at: string | null;
  /** Set when the Mait confirms they collected it. This is when the stock becomes theirs. */
  received_at: string | null;
  note: string;
}

export interface IndentDraft {
  /** Carried as the idempotency key: the app queues indents offline beside AI events. */
  client_uuid: string;
  product_type: 'straw' | 'consumable';
  breed?: string;
  /** Catalogue id for anything that is not a straw. Without it the request has no name. */
  product_ref_id?: number;
  qty_requested: number;
  note?: string;
}
