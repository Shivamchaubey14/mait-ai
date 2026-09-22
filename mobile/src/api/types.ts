/**
 * Types mirroring the API contract (docs/API_CONTRACT.md).
 *
 * Hand-written rather than generated, because the generated client would be another moving
 * part on a 30-day build. They must stay in step with `backend/openapi.yaml` — if a field
 * here disagrees with the schema, the schema is right.
 */

/** `store` is a store keeper: same app, same OTP sign-in, a different shell entirely. */
export type UserRole = 'super_admin' | 'admin' | 'mait' | 'store';

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
  /** The store a keeper works. Null for everyone else — and what decides which shell opens. */
  store?: { id: number; code: string; name: string } | null;
  /**
   * How much of the network this account sees, by name.
   *
   * `scoped` on an office account is what makes them a zonal manager rather than head
   * office, and it is the other half of what decides which shell opens. Optional because a
   * session written to disk before the zonal app existed has no such field, and reading one
   * back must not invalidate it.
   */
  zones?: { scoped: boolean; names: string[] };
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
  /**
   * The dairy this collection point reports into, and the only name the app has for where a
   * Mait's indent goes. There is no plant master — the code and the name ride on every MPP
   * row in the SAP export — so the app reads it off the MPPs it already loaded.
   */
  plant_code: string;
  plant_name: string;
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

/** Whose name `father_husband_name` is. Blank on rows registered before it was asked. */
export type Relation = 'father' | 'husband';

export interface NonMember {
  id: number;
  /**
   * The key the handset minted when she was registered, where one was.
   *
   * Absent on every farmer the back office created, and on rows that predate the field. What
   * it is for is the village: a farmer registered with no signal is carried through the
   * capture on a provisional id, and this is how the queue knows which local registration the
   * capture is waiting on (ADR 0003).
   */
  client_uuid?: string;
  name: string;
  father_husband_name: string;
  relation: Relation | '';
  mobile_no: string;
  address: string;
  /** Read-only and masked (SRS §16). The raw number never comes back to the handset. */
  masked_aadhar: string;
  /**
   * Whether each face of her Aadhaar card is on file — never where it is.
   *
   * The images are identity documents. The app is told the step is done; a URL to one has no
   * business in a handset's response cache.
   */
  aadhar_front_captured: boolean;
  aadhar_back_captured: boolean;
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

/**
 * Whether a farmer is already on file, asked while the Mait is still typing.
 *
 * `blocking` is the whole point of the shape. An Aadhaar match **is** the same person and the
 * form must not go on. A mobile match is a question — a mother and a daughter share a handset,
 * and one phone per household is ordinary — so it is put to the Mait rather than decided for
 * them. Two different facts, two different consequences, one response.
 */
export interface IdentityCheck {
  available: boolean;
  blocking: boolean;
  /** `member`, `non_member`, or empty when nobody was found. */
  kind: 'member' | 'non_member' | '';
  /** Named and placed, so the Mait can go and find her rather than guess. Empty when free. */
  detail: string;
}

export interface NonMemberDraft {
  /**
   * Minted on the handset when the Mait fills the form, before any network attempt.
   *
   * What makes a retry after a dropped response a no-op rather than a second farmer who can
   * be asked for cash again. Optional on the wire — the back office registers non-members too
   * — and always sent by the app.
   */
  client_uuid?: string;
  name: string;
  father_husband_name?: string;
  /** Which of the two that name is — a Mait standing in front of her knows. */
  relation?: Relation;
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

/**
 * One farmer on the handset's copy of a collection point's books.
 *
 * A name, a number and which of the two she is. It is what lets the registration form warn
 * about a duplicate **with no signal**, which is when a farmer is most likely to be registered
 * a second time — and it deliberately carries no Aadhaar, because twelve digits on a handset
 * is a set anybody could brute-force whatever it was hashed with.
 */
export interface FarmerRosterRow {
  name: string;
  mobile_no: string;
  kind: 'member' | 'non_member';
}

/** Both faces of the card, or whichever of them still needs sending after a failed try. */
export interface AadhaarImages {
  front?: string | null;
  back?: string | null;
}

/**
 * One row in the picker the capture flow offers before registering anybody (C4b).
 *
 * A different shape from `NonMember`: that one is a form being filled in, this is a roster
 * being read in a yard. The question is "which of these is the woman in front of me", and a
 * name does not answer it — the same names repeat in a village. So the row carries the
 * household, her number, and how her animals have been served.
 *
 * No Aadhaar. It is what proves she is not already a member, checked at registration; a
 * picker does not need it, and a screenful of identity numbers held up in a public place is
 * not a thing to build.
 */
export interface NonMemberSummary {
  id: number;
  name: string;
  father_husband_name: string;
  relation: Relation | '';
  relation_display: string;
  mobile_no: string;
  animal_count: number;
  ai_event_count: number;
  /** When she was last served, or null if she never has been. */
  last_ai_at: string | null;
  created_at: string;
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
  /**
   * What one insemination of this breed costs, as decimal strings.
   *
   * Two rates for one service, because they are settled in different worlds: a member's comes
   * out of a milk payment the dairy already owes her, a non-member's is cash handed to a Mait
   * in a yard. Served here so the steps asked *before* a breed is chosen can still say what
   * she will pay — see `features/aiFlow/rates.ts`. Null where nobody has priced it, which is
   * not zero and must never reach a farmer as free.
   */
  rate: string | null;
  non_member_rate: string | null;
  display_order: number;
}

export interface Animal {
  id: number;
  /**
   * The key the handset minted when this animal was registered, where one was.
   *
   * Absent on every animal registered from the portal, and on every row that predates the
   * field. What it is for is the yard: a cow registered with no signal is carried through the
   * capture on a provisional id, and this is how the queue knows which local registration the
   * capture is waiting on (ADR 0003).
   */
  client_uuid?: string;
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
  /**
   * Minted on the handset when the Mait fills the form, before any network attempt.
   *
   * What makes a retry after a dropped response a no-op rather than a second identical cow on
   * the farmer's roster. Optional on the wire — the portal registers animals too and has no
   * handset to mint one — and always sent by the app.
   */
  client_uuid?: string;
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

/**
 * One line of stock, with what became of it.
 *
 * `qty` is what is left; `issued` and `used` come from the ledger, which has carried them all
 * along. The pair is the difference between "2 straws" and "2 straws, because 8 of the 10 you
 * were issued have been used" — the second is a day's work accounted for, the first is a
 * number to worry about.
 */
export interface StockLot {
  qty: number;
  issued: number;
  used: number;
}

export interface StrawLot extends StockLot {
  breed: string;
  /** Blank for a breed the administrator has retired — the straws are real either way. */
  animal_type: AnimalTypeCode | '';
}

export interface SuppliesLot extends StockLot {
  code: string;
  name: string;
  unit: string;
  /** When it reached this Mait. What describes a piece of equipment they still hold. */
  issued_at: string | null;
}

export interface InventorySummary {
  total_straws: number;
  is_low_stock: boolean;
  by_breed: Record<string, number>;
  /** The same straws, grouped by species and carrying their history. */
  straws: StrawLot[];
  /** Used up and reordered — sheaths, gloves, liquid nitrogen. */
  consumables: SuppliesLot[];
  /** Issued once and kept — AI gun, thawing tray. */
  assets: SuppliesLot[];
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
  /**
   * Her SAP code, which is what the rest of the app names a member by.
   *
   * Empty for a non-member. Carried so a capture picked back up out of the Unfinished list can
   * re-fetch the farmer it belongs to — with only the row id it would hold a number no other
   * screen speaks.
   */
  member_code: string;
  non_member: number | null;
  owner_name: string;
  animal: number;
  animal_type: AnimalTypeCode;
  breed: string;
  ear_tag_no: string | null;
  /** The breed of straw held for this event. */
  semen_breed: string;
  /** How many straws of it the insemination used. One, unless the animal was difficult. */
  doses: number;
  /** What else came out of the Mait's bag for this visit. */
  consumables: { code: string; name: string; unit: string; qty: number }[];
  /**
   * What this insemination costs, in rupees, decided by the server.
   *
   * Null where the administrator has not priced the breed for this kind of farmer. The app
   * then says the service is chargeable without naming a figure — a number the system cannot
   * stand behind is heard by the farmer as final.
   */
  amount_due: string | null;
  /**
   * Just enough payment to read the row without opening it, or null before step 6.
   *
   * Null is normal rather than missing: an event in `straw_verified` has no payment yet. What
   * the app reads it for is the mode a resumed capture was already recorded under — a farmer
   * who chose UPI must not be picked back up into a cash record.
   */
  payment: {
    amount: string;
    mode: 'COD' | 'ONLINE' | 'DEDUCTION';
    mode_display: string;
    status: string;
    status_display: string;
    is_verified: boolean;
  } | null;
  straw_unique_no: string;
  /**
   * False on a record closed without a stock movement.
   *
   * The straw it holds had already left the Mait's holding, so no further one was spent on
   * it: the insemination happened and that straw is gone whatever the count says. The audit
   * trail carries the same fact in words.
   */
  stock_deducted: boolean;
  ai_photo_url: string;
  /**
   * Whether the proof photo was taken through the app's camera or chosen from the gallery.
   *
   * A live capture is evidence that this animal was served at this place and time; a chosen
   * one is a photograph. The record screen says which, because somebody settling a dispute
   * six months later cannot tell them apart by looking.
   */
  photo_source: 'camera' | 'gallery';
  gps_lat: string | null;
  gps_lng: string | null;
  /** Whose pin it is: the handset's own position, or what was written into the photograph. */
  gps_source: 'device' | 'photo';
  performed_at: string | null;
  completed_at: string | null;
  cancelled_reason: string;
  created_at: string;
}

/**
 * One step of an event's audit trail, from `GET /ai-events/{id}/timeline/`.
 *
 * Written by the server at each transition and never edited afterwards — which is the whole
 * point of it. The app renders `note`, the sentence the server wrote at the time; the two
 * statuses are carried so a note that was never written still has something to show.
 */
export interface AIEventTimelineEntry {
  id: number;
  from_status: string;
  to_status: string;
  note: string;
  /** Blank where the step was the handset's own doing rather than a person's. */
  actor_name: string;
  created_at: string;
}

/**
 * `client_uuid` is generated on the device before the first send, so an event queued offline
 * keeps one identity across however many retries it takes to land (ADR 0003). A repeat
 * returns the event that already exists rather than recording the insemination twice.
 */
export interface AIEventDraft {
  client_uuid: string;
  /**
   * The farmer's local key, where she was registered offline and has no row id yet.
   *
   * `non_member_id` then carries a provisional number the server has never seen, and this is
   * what the queue reads the real one from once her registration lands. Handset bookkeeping:
   * `api/sync` swaps the two and drops this before sending.
   */
  non_member_client_uuid?: string;
  /**
   * The handset's own bookkeeping, and the one field here the server never sees.
   *
   * Set only where the animal was registered offline moments earlier and has no row id yet:
   * `animal_id` then carries a provisional number and this says which queued registration to
   * read the real one from. `api/sync` swaps the two and drops this before sending.
   */
  animal_client_uuid?: string;
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
  /**
   * How many straws of that breed this insemination used.
   *
   * Two in one visit is ordinary practice on a difficult animal, and both come off the flask.
   * Omitted means one, which is what every build before this one meant.
   */
  doses?: number;
  /** What else the visit took, by catalogue code — sheaths, gloves. Never charged to her. */
  consumables?: { code: string; qty: number }[];
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
  requested_at: string;
  issued_at: string | null;
  /** Set when the Mait confirms they collected it. This is when the stock becomes theirs. */
  received_at: string | null;
  note: string;
  /**
   * The depot it is handed over at, and who approved it.
   *
   * Optional because the queue can replay an indent cached before stores existed; every one
   * the server sends now carries them.
   */
  store?: number | null;
  store_name?: string;
  approved_at?: string | null;
  approved_by_name?: string;
  approved_by_zone?: string;
  /** Approved and not yet handed over — what the next batch at the depot is for. */
  qty_open?: number;
  /** At a counter with the Mait's name on it right now: what *Confirm collection* is about. */
  qty_to_collect?: number;
  /** Collecting needs the four digits the store keeper reads out. Every store handover does. */
  needs_code?: boolean;
  handovers?: IndentHandoverSummary[];
}

/** One trip across a store's counter. Never carries the code — that is read aloud. */
export interface IndentHandoverSummary {
  id: number;
  qty: number;
  store_name: string;
  issued_at: string;
  collected_at: string | null;
  cancelled_at: string | null;
  state: 'waiting' | 'collected' | 'cancelled';
}

// ---- store keeper ------------------------------------------------------------------------

/** The keeper's first screen: their store and the four figures under its name. */
export interface StoreHome {
  store: { id: number; code: string; name: string; zone_name: string; plant_names: string[] };
  /** Every open indent in the queue. */
  waiting: number;
  ready: number;
  /** The shelf covers some of what is owed, not all of it. */
  short: number;
  /** The shelf covers none of it. */
  empty: number;
  issued_today: number;
  not_collected: number;
}

/**
 * An approved indent in the store's queue, with what the shelf can do about it.
 *
 * `in_store` is what can still be promised — on hand, less what is already set aside for other
 * Maits — and `readiness` is the word the row wears.
 */
export interface StoreIndent {
  id: number;
  mait_name: string;
  mait_code: string;
  product_type: 'straw' | 'consumable';
  breed: string;
  product_ref_id: number | null;
  item_name: string;
  item_name_hi: string;
  unit: string;
  qty_requested: number;
  qty_issued: number;
  qty_open: number;
  in_store: number;
  readiness: 'ready' | 'short' | 'waiting';
  short_by: number;
  waiting_days: number;
  requested_at: string;
  approved_at: string | null;
  approved_by_name: string;
  approved_by_zone: string;
  note: string;
  /**
   * Batches already handed over against this indent and still waiting on the Mait's code —
   * with the code, so the keeper can read it out again to a Mait who lost it.
   */
  waiting_handovers?: {
    id: number;
    qty: number;
    collection_code: string;
    issued_at: string;
    locked: boolean;
  }[];
}

/** A handover as the keeper sees it — with the code, which is theirs to read aloud. */
export interface StoreHandover {
  id: number;
  indent_id: number;
  mait_name: string;
  product_type: 'straw' | 'consumable';
  breed: string;
  item_name: string;
  item_name_hi: string;
  qty: number;
  qty_requested: number;
  /** Still owed on the indent after this handover. */
  qty_open: number;
  collection_code: string;
  flask_checked: boolean;
  issued_at: string;
  collected_at: string | null;
  cancelled_at: string | null;
  state: 'waiting' | 'collected' | 'cancelled';
  /** Too many wrong codes typed against it; the keeper has to read out a new one. */
  locked: boolean;
}

export interface StoreStockLine {
  product_type: 'straw' | 'consumable';
  breed: string;
  product_ref_id: number | null;
  item_name: string;
  item_name_hi: string;
  unit: string;
  /** Physically on the shelf, including what is set aside. */
  on_hand: number;
  /** Issued and waiting for a Mait to collect. */
  set_aside: number;
  /** What can still be promised. */
  available: number;
  /** Which kind of shelf it sits on. Absent from a server older than the grouped stock. */
  category?: 'straw' | 'consumable' | 'asset';
}

export interface StoreCatalogue {
  breeds: { code: string; name: string; name_hi: string; animal_type: string }[];
  products: { id: number; name: string; unit: string; category: 'consumable' | 'asset' }[];
}

export interface StoreReceipt {
  client_uuid: string;
  product_type: 'straw' | 'consumable';
  breed?: string;
  product_ref_id?: number;
  qty: number;
  note?: string;
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

/**
 * A pregnancy check — did the insemination take?
 *
 * Flattened by the server on purpose: a row on the list is a name, a village and a number of
 * days, and a handset in a village with one bar must not have to join three responses to draw
 * one. `days_until` is negative when the check is overdue.
 */
/**
 * What a visit produced. Three findings and a refusal.
 *
 * `declined` is not a finding — the owner would not have the animal examined, so nothing was
 * looked at. It closes the check, books nothing behind it and is never billed, and the server
 * keeps it out of the conception rate. Nothing on the handset should ever add it to
 * `not_pregnant`.
 */
export type PdOutcome = 'pregnant' | 'not_pregnant' | 'unsure' | 'declined';

export interface PregnancyCheck {
  id: number;
  ai_event_id: number;
  owner_name: string;
  owner_type: 'member' | 'non_member';
  mpp_id: number;
  mpp_code: string;
  mpp_name: string;
  /** Enough to start the next insemination without re-asking what the record already holds. */
  member_code: string;
  non_member_id: number | null;
  animal_id: number;
  animal_type: string;
  ear_tag_no: string | null;
  breed: string;
  /** The day of the insemination, `YYYY-MM-DD`. */
  served_on: string | null;
  due_on: string;
  /** Negative when overdue, zero on the day. What the badge on the row counts. */
  days_until: number;
  /** How long she has been carrying, if she is. */
  days_since_ai: number | null;
  outcome: PdOutcome | '';
  /**
   * What this visit costs *this* owner, already resolved by the server — a member and a
   * non-member are quoted different figures for the same work. A string, because it is money
   * and a float is not; `null` where the dairy has not set a rate, which is emphatically not
   * the same as free and must never be rendered as a zero.
   */
  price: string | null;
  /** What was actually charged, stamped when the visit was recorded. Null on a refusal. */
  amount_charged: string | null;
  outcome_display: string;
  checked_at: string | null;
  calving_due_on: string | null;
  photo_url: string;
  note: string;
}

/** The list carries its own counts, so every screen showing a number shows the same one. */
export interface PregnancyCheckPage extends Paginated<PregnancyCheck> {
  due_this_week: number;
  overdue: number;
}

/**
 * A stop on a planned round.
 *
 * `leg_km` is the distance from the stop before it — a straight line scaled for the fact that
 * roads wind, because there is no routing service behind this. Good enough to order stops;
 * the screen says what it is rather than letting a Mait read it as a road distance.
 */
export interface RouteStop extends PregnancyCheck {
  leg_km: number;
  lat: number | null;
  lng: number | null;
}

export interface RouteOption {
  total_km: number;
  /** Riding plus the checks themselves. */
  minutes_total: number;
  minutes_on_road: number;
  stops: RouteStop[];
}

export interface PdRoute {
  /** False when the handset had no fix, so the round is ordered from the first stop instead. */
  from_here: boolean;
  stop_count: number;
  options: { shortest: RouteOption; late_first: RouteOption };
  /** Checks with no recorded position. They cannot be placed, so they go last. */
  without_location: number;
}

// --------------------------------------------------------------------------------------
// The zonal manager's app
// --------------------------------------------------------------------------------------
/**
 * Who this is, and what is waiting on them.
 *
 * The small answer every screen needs and the tab bar's badge reads. `waiting` is what is
 * waiting on *them*; `at_depot` is what is waiting on a store keeper, which is a different
 * phone call. The zone's actual figures are `ZonalDashboard`.
 */
export interface ZonalHome {
  manager: { name: string; mobile_no: string; zones: string[]; sections: string[] };
  waiting: number;
  oldest_waiting_days: number;
  at_depot: number;
  maits: number;
  stores: number;
  scope: { scoped: boolean; zones: string[]; plant_codes: string[] | null };
}

/** One day of the trend, already bucketed by the server so the chart does no arithmetic. */
export interface ZonalTrendDay {
  date: string;
  label: string;
  short_label: string;
  completed: number;
}

/** A row in one of the two "busiest" panels. `share` is against the leader, not a target. */
export interface ZonalRanked {
  name: string;
  events: number;
  share: number;
  /** Maits carry their vendor code here; villages carry their chilling centre. */
  code?: string;
  mait_id?: number;
  mpp_code?: string;
  plant_name?: string;
}

/** One capture, as it lands — the feed that makes the zone feel live. */
export interface ZonalCapture {
  id: number;
  mait_name: string;
  mait_code: string;
  mpp_name: string;
  mpp_code: string;
  plant_name: string;
  breed: string;
  doses: number;
  when: string;
}

/** One row of `GET /zonal/events/` — every status, not only completed. */
export interface ZonalEventRow {
  id: number;
  status: string;
  status_display: string;
  owner_type: 'member' | 'non_member';
  owner_name: string;
  mpp_name: string;
  mpp_code: string;
  mait_name: string;
  mait_code: string;
  breed: string;
  doses: number;
  created_at: string;
  completed_at: string | null;
}

/** A page of the zone's events. `count` is the whole range, never the page. */
export interface ZonalEventPage {
  count: number;
  results: ZonalEventRow[];
  date_from: string | null;
  date_to: string | null;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** The zone's work: what a manager opens the app to see. */
export interface ZonalDashboard {
  days: number;
  today: number;
  yesterday: number;
  on_yesterday: number;
  week: number;
  month: number;
  maits_working_today: number;
  in_progress: number;
  payment_pending: number;
  trend: ZonalTrendDay[];
  best_day: ZonalTrendDay | null;
  busiest_maits: ZonalRanked[];
  busiest_villages: ZonalRanked[];
  happening: ZonalCapture[];
  scope: { scoped: boolean; zones: string[]; plant_codes: string[] | null };
}

/**
 * One indent awaiting a decision, with the facts the decision turns on.
 *
 * `in_store` is what the depot serving this Mait can still promise — and `-1` means no depot
 * serves them at all, which is a different answer from a depot holding nothing. `coverage`
 * says the same thing in one word, which is what the row wears.
 */
export interface ZonalApproval {
  id: number;
  mait: number;
  mait_name: string;
  mait_code: string;
  mpp_names: string[];
  product_type: 'straw' | 'consumable';
  breed: string;
  item_name: string;
  item_name_hi: string;
  unit: string;
  qty_requested: number;
  note: string;
  requested_at: string;
  waiting_days: number;
  status: string;
  store: number | null;
  store_name: string;
  in_store: number;
  mait_holds: number;
  coverage: 'ready' | 'short' | 'empty' | 'no-store';
}

/** What a Mait is holding, and which chilling centre they are counted under. */
export interface ZoneStockMait {
  mait_id: number;
  name: string;
  code: string;
  mobile_no: string;
  plant_code: string;
  plant_name: string;
  /** The other centres they cover — named, so an empty Mait can be placed on a map. */
  also_covers: string[];
  mpps: number;
  total: number;
  by_breed: Record<string, number>;
  state: 'at_zero' | 'low' | 'ok';
}

/** A depot's shelf, as the zone sees it. */
export interface ZoneStockStore {
  id: number;
  code: string;
  name: string;
  plant_codes: string[];
  plant_names: string[];
  straws_on_hand: number;
  straws_set_aside: number;
  straws_available: number;
  by_breed: Record<string, number>;
  open_indents: number;
}

/**
 * One chilling centre, with everything held under it.
 *
 * Each Mait appears at exactly one location — the centre most of their collection points
 * report into — so these rows sum to the figure in the tile above them.
 */
export interface ZoneStockLocation {
  plant_code: string;
  name: string;
  maits: number;
  at_zero: number;
  low: number;
  straws: number;
  by_breed: Record<string, number>;
  stores: { id: number; name: string; straws_available: number; open_indents: number }[];
}

/**
 * One item in the zone — a breed of straw, a consumable, a piece of equipment — with where it
 * is and what is on its way. `requested` waits on the manager, `approved` waits at a depot,
 * `set_aside` is packed and waiting to be collected.
 */
export interface ZoneStockProduct {
  key: string;
  category: 'straw' | 'consumable' | 'asset';
  name: string;
  name_hi: string;
  unit: string;
  with_maits: number;
  maits_holding: number;
  at_depots: number;
  set_aside: number;
  free: number;
  requested: number;
  approved: number;
}

export interface ZoneStock {
  summary: {
    total_straws: number;
    maits: number;
    at_zero: number;
    low: number;
    low_stock_threshold: number;
    locations: number;
    stores: number;
    store_straws: number;
  };
  locations: ZoneStockLocation[];
  maits: ZoneStockMait[];
  stores: ZoneStockStore[];
  /** Absent from a server older than the product view. */
  products?: Record<'straw' | 'consumable' | 'asset', ZoneStockProduct[]>;
  scope: { scoped: boolean; zones: string[]; plant_codes: string[] | null };
}

/**
 * One decision, with the request behind it and where it got to since.
 *
 * `status_label` is that last part in words — *Waiting at the depot* against something
 * approved three weeks ago is the row somebody opens their own history to find.
 */
export interface ZonalDecision {
  id: number;
  when: string;
  outcome: 'approved' | 'rejected';
  indent_id: number | null;
  mait_name: string;
  mait_code: string;
  item_name: string;
  item_name_hi: string;
  qty: number;
  status: string;
  status_label: string;
  status_tone: 'good' | 'waiting' | 'bad' | 'plain';
  store_name: string;
  /** The words the Mait was given. Only on a rejection. */
  reason: string;
  /** What it was for — absent from a server older than the coloured history. */
  product_type?: 'straw' | 'consumable' | '';
  unit?: string;
  /** How much has been handed over since, of `qty`. */
  qty_issued?: number;
}

export interface ZonalHistory {
  summary: {
    days: number;
    approved: number;
    rejected: number;
    total: number;
    last_signed_in: string | null;
  };
  outcome: 'all' | 'approved' | 'rejected';
  count: number;
  results: ZonalDecision[];
}

/**
 * One insemination, whole — what `/zonal/events/{id}/` answers.
 *
 * The same record the portal's AI event detail screen draws, in one response rather than
 * three: a manager opening this in a yard on one bar of signal wants one spinner, and there
 * is no offline cache here for the halves to arrive into separately.
 *
 * Extends the event the Mait's own screens read, and adds the three things a manager needs
 * that a Mait does not: **whose** capture it was, whether it took, and the trail.
 */
export interface ZonalEvent extends AIEvent {
  /**
   * Whose capture it was.
   *
   * The server has always sent these three; the Mait's own screens have never needed them,
   * because every event they open is theirs. A manager's always does.
   */
  mait: number;
  mait_name: string;
  mait_code: string;
  /** Whether it took. An insemination is finished ninety days later, not at the straw. */
  pregnancy_checks: PregnancyCheck[];
  timeline: AIEventTimelineEntry[];
}
