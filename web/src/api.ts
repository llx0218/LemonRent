
export class ApiError extends Error {
  status: number;
  detail: any;
  constructor(status: number, message: string, detail?: any) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-LemonRent": "1",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const d = data?.detail;
    let msg = "Something went wrong";
    if (typeof d === "string") msg = d;
    else if (d?.message) msg = d.message;
    else if (Array.isArray(d)) msg = d.map((x: any) => x.msg).join("; ");
    if (res.status === 401 && path !== "/auth/login") {
      window.dispatchEvent(new Event("lemonrent:signed-out"));
    }
    throw new ApiError(res.status, msg, d);
  }
  return data as T;
}

export async function shrinkImage(file: File, max = 1600): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't a photo the browser can open"));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Could not process the photo"))), "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhoto(propertyId: number, file: File): Promise<string> {
  const blob = await shrinkImage(file);
  const res = await fetch(`/api/properties/${propertyId}/photo`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "X-LemonRent": "1", "Content-Type": "image/jpeg" },
    body: blob,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, typeof data?.detail === "string" ? data.detail : "Upload failed", data?.detail);
  return data.photo;
}

export const api = {
  get: <T,>(p: string) => request<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  del: <T,>(p: string) => request<T>("DELETE", p),
};

export interface Me {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
  sub_account: boolean;
  totp_enabled: boolean;
  currency: string;
}

export interface AccountUser {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
  sub_account: boolean;
  parent: string | null;
  disabled: boolean;
  totp: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AccountInvite {
  code: string;
  note: string;
  kind: "sub" | "separate";
  role: string;
  created_at: string;
  used_by: string | null;
  used_at: string | null;
  revoked: boolean;
}

export interface Accounts {
  can_invite_separate: boolean;
  members: AccountUser[];
  invites: AccountInvite[];
  users?: AccountUser[];
  audit?: { ts: string; actor: string; action: string }[];
}

export type UtilMode = "charged" | "included" | "tenant_direct";

export interface Balance {
  due: number;
  paid: number;
  outstanding: number;
  overdue: number;
  overdue_months: string[];
  unrecorded_months: string[];
}

export interface Rec {
  id: number;
  tenancy_id: number;
  month: string;
  rent_due: number;
  rent_paid: number;
  paid_on: string | null;
  electricity: number;
  water: number;
  internet: number;
  other_utility: number;
  utilities_paid: number;
  utility_bills: number;
  utilities_due: number;
  method: string;
  note: string;
}

export type ReceiptKind = "security_deposit" | "utility_deposit" | "access_card_deposit" | "admin_fee" | "other_fee";
export type DepositKind = "security_deposit" | "utility_deposit" | "access_card_deposit";

export interface Receipt {
  id: number;
  tenancy_id: number;
  kind: ReceiptKind;
  amount: number;
  received_on: string;
  method: string;
  note: string;
  is_deposit: boolean;
}

export interface Tenancy {
  id: number;
  unit_id: number;
  unit_name: string;
  room_type: string;
  property_id: number;
  property_name: string;
  tenant_id: number;
  tenant_name: string;
  tenant_phone: string;
  start_date: string;
  end_date: string | null;
  moved_out_on: string | null;
  monthly_rent: number;
  rent_due_day: number;
  security_deposit: number;
  utility_deposit: number;
  access_card_deposit: number;
  admin_fee: number;
  deposits: {
    collected: Record<DepositKind, number>;
    pending: Record<DepositKind, number>;
    total_agreed: number;
    total_collected: number;
    held: number;
  };
  fees: {
    admin_fee_agreed: number;
    admin_fee_collected: number;
    admin_fee_pending: number;
    other_fees_collected: number;
  };
  deposit_returned: number | null;
  utilities_mode: UtilMode;
  notes: string;
  status: "active" | "upcoming" | "ended";
  days_left: number | null;
  balance: Balance;
  records?: Rec[];
  receipts?: Receipt[];
}

export interface Stats {
  cash_invested: number;
  months_owned: number;
  rent_now: number;
  target_rent: number;
  commitment_monthly: number;
  commitment_loan_monthly: number;
  expected_net_monthly: number;
  gross_yield_pct: number | null;
  net_yield_pct: number | null;
  projected_cash_on_cash_pct: number | null;
  cash_on_cash_pct: number | null;
  last12: { months: number; income: number; outgo: number; net: number; annualised_net: number };
  to_date: {
    income: number;
    outgo: number;
    net: number;
    rent_in: number;
    commitments: number;
    expenses: number;
    utilities_cost: number;
    utilities_in: number;
    fees_in: number;
  };
  payback_pct: number | null;
  appreciation: number | null;
  total_return_pct: number | null;
  units_active: number;
  units_occupied: number;
  arrears: number;
  deposits_held: number;
}

export interface Flow {
  month: string;
  rent_expected: number;
  rent_in: number;
  utilities_in: number;
  fees_in: number;
  utilities_cost: number;
  commitments: number;
  expenses: number;
  income: number;
  outgo: number;
  net: number;
}

export interface Unit {
  id: number;
  property_id: number;
  property_name: string;
  name: string;
  room_type: string;
  target_rent: number;
  active: boolean;
  notes: string;
  current: Tenancy | null;
  upcoming: Tenancy | null;
  tenancy_count: number;
}

export interface Commitment {
  id: number;
  name: string;
  kind: "loan" | "fee" | "other";
  amount: number;
  frequency: "monthly" | "yearly";
  monthly: number;
  start_date: string | null;
  end_date: string | null;
}

export interface Expense {
  id: number;
  spent_on: string;
  category: string;
  amount: number;
  note: string;
}

export interface PropertyBase {
  id: number;
  name: string;
  address: string;
  purchase_date: string | null;
  purchase_price: number;
  down_payment: number;
  upfront_costs: number;
  loan_amount: number;
  current_value: number | null;
  notes: string;
  photo: string | null;
  stats: Stats;
}

export interface PropertySummary extends PropertyBase {
  units: { id: number; name: string; active: boolean; occupied: boolean }[];
}

export interface PropertyDetail extends PropertyBase {
  units: Unit[];
  commitments: Commitment[];
  expenses: Expense[];
  series: Flow[];
}

export interface TenantRow {
  id: number;
  name: string;
  phone: string;
  email: string;
  id_number_masked: string;
  occupation: string;
  emergency_contact: string;
  notes: string;
  current: Tenancy | null;
  status: "active" | "upcoming" | "past" | "none";
  outstanding: number;
  properties: [number, string][];
}

export interface CashflowItem {
  kind: string;
  label?: string;
  who: string;
  amount: number;
  date?: string;
  tenant_id?: number;
  tenancy_id?: number;
  entered?: boolean;
}

export interface CashflowMonth {
  month: string;
  total: Flow;
  properties: { id: number; name: string; flow: Flow; income: CashflowItem[]; outgo: CashflowItem[]; deposits: CashflowItem[]; unpaid: (CashflowItem & { tenancy_id: number; entered: boolean })[] }[];
}

export interface TenantDetail extends TenantRow {
  id_number: string;
  tenancies: Tenancy[];
}

export interface Overview {
  month: string;
  today: string;
  portfolio: {
    series: Flow[];
    cash_invested: number;
    rent_now: number;
    commitment_monthly: number;
    expected_net_monthly: number;
    cash_on_cash_pct: number | null;
    projected_cash_on_cash_pct: number | null;
    gross_yield_pct: number | null;
    net_yield_pct: number | null;
    net_to_date: number;
    payback_pct: number | null;
    units_active: number;
    units_occupied: number;
    arrears: number;
    deposits_held: number;
  };
  month_expected: number;
  month_collected: number;
  owing: {
    tenancy_id: number;
    tenant_id: number;
    tenant_name: string;
    unit_name: string;
    property_name: string;
    outstanding: number;
    overdue: number;
    overdue_months: string[];
  }[];
  ending_soon: Tenancy[];
  vacant: { id: number; name: string; property_name: string; target_rent: number }[];
  properties: { id: number; name: string; stats: Stats }[];
}

export interface CollectRow {
  tenancy_id: number;
  tenant_id: number;
  tenant_name: string;
  tenant_phone: string;
  unit_name: string;
  room_type: string;
  property_id: number;
  property_name: string;
  monthly_rent: number;
  rent_due_day: number;
  utilities_mode: UtilMode;
  record: Rec | null;
  previous_balance: number;
  prev_bills: { electricity: number; water: number; internet: number; other_utility: number } | null;
}
