const MYT = "Asia/Kuala_Lumpur";

let CUR = "RM";
export const setCurrency = (c: string) => {
  CUR = c || "RM";
};
export const currency = () => CUR;

export function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function money(n: number | null | undefined, opts: { sign?: boolean; d?: number } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const d = opts.d ?? (Math.abs(n) >= 100000 ? 0 : 2);
  return (opts.sign && n > 0 ? "+" : "") + (n < 0 ? "-" : "") + CUR + " " + fmt(Math.abs(n), d);
}

export function short(n: number) {
  const a = Math.abs(n);
  const s = a >= 1e6 ? fmt(a / 1e6, 1) + "m" : a >= 1e3 ? fmt(a / 1e3, a >= 1e4 ? 0 : 1) + "k" : fmt(a, 0);
  return (n < 0 ? "-" : "") + s;
}

export function pct(n: number | null | undefined, sign = false, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (sign && n > 0 ? "+" : "") + fmt(n, d) + "%";
}

export const cls = (n: number | null | undefined) => ((n ?? 0) >= 0 ? "up" : "down");

export function day(iso: string | null | undefined, withYear = true) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function monthLabel(ym: string, long = true) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: long ? "long" : "short",
    year: long ? "numeric" : "2-digit",
    timeZone: "UTC",
  });
}

export function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

export function todayMYT() {
  return new Date().toLocaleDateString("en-CA", { timeZone: MYT });
}

export function thisMonth() {
  return todayMYT().slice(0, 7);
}

export function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const UTIL_LABEL: Record<string, string> = {
  charged: "Tenant pays you back",
  included: "Included in rent",
  tenant_direct: "Tenant pays providers",
};

export const RECEIPT_LABEL: Record<string, string> = {
  security_deposit: "Security deposit",
  utility_deposit: "Utility deposit",
  access_card_deposit: "Access card deposit",
  admin_fee: "Admin fee",
  other_fee: "Other fee",
};

export function period(start: string, end: string | null) {
  return `${day(start)} – ${end ? day(end) : "open-ended"}`;
}
