import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { currency, money, short } from "../format";

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Skeleton({ h = 18, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? "" : "off"}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const show = useCallback((m: string) => setMsg(m), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

const loadCache = new Map<string, unknown>();
export function clearLoadCache() {
  loadCache.clear();
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], refreshMs = 0, cacheKey?: string) {
  const [data, setDataRaw] = useState<T | null>(() => (cacheKey && loadCache.has(cacheKey) ? (loadCache.get(cacheKey) as T) : null));
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const setData = (d: T | null) => {
    if (cacheKey) d === null ? loadCache.delete(cacheKey) : loadCache.set(cacheKey, d);
    setDataRaw(d);
  };
  useEffect(() => {
    let alive = true;
    // new key (e.g. another filter): show what we have for it, else keep the
    // previous data on screen until the answer arrives
    if (cacheKey && loadCache.has(cacheKey)) setDataRaw(loadCache.get(cacheKey) as T);
    fn()
      .then((d) => {
        if (!alive) return;
        if (cacheKey) loadCache.set(cacheKey, d);
        setDataRaw(d);
        setError(null);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, cacheKey]);
  useEffect(() => {
    if (!refreshMs) return;
    // Refresh only while the tab is visible, and at once when it comes back.
    const t = setInterval(() => {
      if (!document.hidden) setTick((x) => x + 1);
    }, refreshMs);
    const onShow = () => {
      if (!document.hidden) setTick((x) => x + 1);
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refreshMs]);
  return { data, error, reload: () => setTick((x) => x + 1), setData };
}

export function Modal({ title, sub, children, onClose, wide }: { title: string; sub?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {sub ? <p className="sub">{sub}</p> : <div style={{ height: 14 }} />}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function MoneyInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="money">
      <span className="cur">{currency()}</span>
      <input className="input" inputMode="decimal" value={value} placeholder={placeholder ?? "0.00"} autoFocus={autoFocus}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
    </div>
  );
}

export const num = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : v === 0 ? "" : String(v));

export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [f, setF] = useState<T>(initial);
  const set = <K extends keyof T>(k: K) => (v: T[K]) => setF((x) => ({ ...x, [k]: v }));
  const ev = <K extends keyof T>(k: K) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value as T[K] }));
  return { f, setF, set, ev };
}

export function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await fn();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, submit, setErr };
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    active: ["up", "Active"],
    upcoming: ["acc", "Upcoming"],
    ended: ["gray", "Ended"],
    past: ["gray", "Past"],
    none: ["gray", "No lease"],
  };
  const [c, t] = map[status] ?? ["gray", status];
  return <span className={`pill ${c}`}>{t}</span>;
}

export function Bars({ data, height = 240, onPick, picked }: { data: { label: string; income: number; outgo: number; net: number }[]; height?: number; onPick?: (i: number) => void; picked?: number | null }) {
  if (!data.length) return <Empty title="No data yet" />;
  const w = 800;
  const pad = { l: 8, r: 58, t: 12, b: 26 };
  const hi = Math.max(1, ...data.map((d) => Math.max(d.income, d.outgo)));
  const lo = Math.min(0, ...data.map((d) => d.net));
  const max = hi * 1.1;
  const min = lo * 1.1;
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
  const slot = (w - pad.l - pad.r) / data.length;
  const bw = Math.min(16, slot / 3.2);
  const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
  const line = data.map((d, i) => `${i ? "L" : "M"}${(pad.l + slot * i + slot / 2).toFixed(1)} ${y(d.net).toFixed(1)}`).join(" ");
  return (
    <svg className="bar-chart" viewBox={`0 0 ${w} ${height}`} style={{ height }} preserveAspectRatio="none">
      {ticks.map((v, i) => (
        <g key={i}>
          <line className="grid-l" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
          <text x={w - pad.r + 8} y={y(v) + 4}>{short(v)}</text>
        </g>
      ))}
      <line className="zero" x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} />
      {data.map((d, i) => {
        const cx = pad.l + slot * i + slot / 2;
        return (
          <g key={i} className={onPick ? "bar-slot" : undefined} onClick={onPick ? () => onPick(i) : undefined}>
            <title>{`${d.label}: in ${money(d.income)}, out ${money(d.outgo)}, net ${money(d.net)}`}</title>
            {onPick && <rect x={pad.l + slot * i} y={0} width={slot} height={height} className={`bar-hit${picked === i ? " on" : ""}`} rx={6} />}
            <rect x={cx - bw - 1} y={y(d.income)} width={bw} height={Math.max(0, y(0) - y(d.income))} rx={3} fill="var(--accent)" />
            <rect x={cx + 1} y={y(d.outgo)} width={bw} height={Math.max(0, y(0) - y(d.outgo))} rx={3} fill="var(--peach)" opacity={0.85} />
            <text x={cx} y={height - 8} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
      <path d={line} fill="none" stroke="var(--up)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
      {data.map((d, i) => (
        <circle key={i} cx={pad.l + slot * i + slot / 2} cy={y(d.net)} r={3} fill={d.net >= 0 ? "var(--up)" : "var(--down)"} />
      ))}
    </svg>
  );
}
