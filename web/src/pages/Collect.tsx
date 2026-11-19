import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, CollectRow, Rec } from "../api";
import { Icon } from "../components/icons";
import Shell from "../components/Shell";
import { Empty, Field, MoneyInput, num, Skeleton, useLoad, useToast } from "../components/ui";
import { currency, money, monthLabel, shiftMonth, thisMonth, todayMYT, UTIL_LABEL } from "../format";

interface Draft {
  rent_due: string;
  rent_paid: string;
  paid_on: string;
  electricity: string;
  water: string;
  internet: string;
  other_utility: string;
  utilities_paid: string;
  method: string;
  note: string;
}

const METHODS = ["", "Bank transfer", "DuitNow", "Cash", "Cheque", "Other"];
const s2 = (n: number | null | undefined) => (n ? String(n) : "");

function toDraft(r: CollectRow): Draft {
  const rec = r.record;
  return {
    rent_due: rec ? s2(rec.rent_due) : String(r.monthly_rent),
    rent_paid: s2(rec?.rent_paid),
    paid_on: rec?.paid_on ?? "",
    electricity: s2(rec?.electricity),
    water: s2(rec?.water),
    internet: s2(rec?.internet),
    other_utility: s2(rec?.other_utility),
    utilities_paid: s2(rec?.utilities_paid),
    method: rec?.method ?? "",
    note: rec?.note ?? "",
  };
}

const bills = (d: Draft) => num(d.electricity) + num(d.water) + num(d.internet) + num(d.other_utility);
const utilDue = (d: Draft, r: CollectRow) => (r.utilities_mode === "charged" ? bills(d) : 0);
const totalDue = (d: Draft, r: CollectRow) => num(d.rent_due) + utilDue(d, r);
const totalPaid = (d: Draft, r: CollectRow) => num(d.rent_paid) + (r.utilities_mode === "charged" ? num(d.utilities_paid) : 0);

function waLink(phone: string, text: string) {
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("0")) p = "6" + p;
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : "";
}

function PayCard({ row, month, draft, dirty, onChange, onSave, saving, focus }: { row: CollectRow; month: string; draft: Draft; dirty: boolean; onChange: (d: Draft) => void; onSave: () => void; saving: boolean; focus?: boolean }) {
  const set = (k: keyof Draft) => (v: string) => onChange({ ...draft, [k]: v });
  const due = totalDue(draft, row);
  const paid = totalPaid(draft, row);
  const left = due - paid;
  const saved = !!row.record;
  const status = !saved && !dirty ? ["gray", "Not entered"] : left <= 0.004 ? ["up", "Paid"] : paid > 0 ? ["warn", "Part paid"] : ["down", "Unpaid"];
  const charged = row.utilities_mode === "charged";
  const owingAll = left + row.previous_balance;
  const msg = `Hi ${row.tenant_name.split(" ")[0]}, a friendly reminder that ${currency()} ${owingAll.toFixed(2)} is due for ${row.unit_name} (${monthLabel(month)}${row.previous_balance > 0 ? " incl. earlier months" : ""}). Thank you!`;
  const wa = row.tenant_phone && owingAll > 0 ? waLink(row.tenant_phone, msg) : "";

  return (
    <div id={`pay-${row.tenancy_id}`} className={`pay ${status[1] === "Paid" ? "done" : status[1] === "Part paid" ? "part" : ""}${focus ? " focus" : ""}`}>
      <div className="pay-head">
        <div style={{ minWidth: 0 }}>
          <Link to={`/tenants/${row.tenant_id}`}><b>{row.tenant_name}</b></Link>
          <div className="muted tiny">
            {row.property_name} / {row.unit_name} · due on day {row.rent_due_day}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {row.previous_balance > 0.004 && <span className="pill down">Owes {money(row.previous_balance)} from before</span>}
          {row.previous_balance < -0.004 && <span className="pill up">Credit {money(-row.previous_balance)}</span>}
          <span className={`pill ${status[0]}`}>{status[1]}</span>
        </div>
      </div>
      <div className="pay-grid">
        <div className="pay-box">
          <div className="t">
            <span>Rent</span>
            <button type="button" className="btn sm primary" onClick={() => onChange({ ...draft, rent_paid: draft.rent_due, paid_on: draft.paid_on || todayMYT() })}>Paid in full</button>
          </div>
          <div className="f2">
            <Field label="Due"><MoneyInput value={draft.rent_due} onChange={set("rent_due")} /></Field>
            <Field label="Received"><MoneyInput value={draft.rent_paid} onChange={set("rent_paid")} /></Field>
            <Field label="Paid on"><input className="input" type="date" value={draft.paid_on} onChange={(e) => set("paid_on")(e.target.value)} /></Field>
            <Field label="Method">
              <select className="select" value={draft.method} onChange={(e) => set("method")(e.target.value)}>
                {METHODS.map((m) => <option key={m} value={m}>{m || "—"}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div className="pay-box">
          <div className="t">
            <span>Utility bills · <span className="faint" style={{ fontWeight: 500 }}>{UTIL_LABEL[row.utilities_mode]}</span></span>
            {row.prev_bills && (
              <button type="button" className="btn sm" onClick={() => onChange({ ...draft, ...Object.fromEntries(Object.entries(row.prev_bills!).map(([k, v]) => [k, s2(v)])) })}>Same as last month</button>
            )}
          </div>
          <div className="f2">
            <Field label="Electricity (TNB)"><MoneyInput value={draft.electricity} onChange={set("electricity")} /></Field>
            <Field label="Water"><MoneyInput value={draft.water} onChange={set("water")} /></Field>
            <Field label="Internet"><MoneyInput value={draft.internet} onChange={set("internet")} /></Field>
            <Field label="Other (gas, IWK…)"><MoneyInput value={draft.other_utility} onChange={set("other_utility")} /></Field>
          </div>
          {charged ? (
            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><Field label={`Tenant paid back (of ${money(bills(draft))})`}><MoneyInput value={draft.utilities_paid} onChange={set("utilities_paid")} /></Field></div>
              <button type="button" className="btn sm" style={{ marginBottom: 14 }} onClick={() => set("utilities_paid")(String(bills(draft).toFixed(2)))}>Full</button>
            </div>
          ) : (
            <div className="muted tiny">{row.utilities_mode === "included" ? "You pay these. They count as your cost." : "For your reference only. Not counted in cashflow."}</div>
          )}
        </div>
        <div className="pay-box" style={{ display: "flex", flexDirection: "column" }}>
          <div className="t"><span>This month</span></div>
          <div className="kv"><span>Rent</span><span className="num">{money(num(draft.rent_due))}</span></div>
          {charged && <div className="kv"><span>Utilities</span><span className="num">{money(utilDue(draft, row))}</span></div>}
          <div className="kv"><span>Received</span><span className="num up">{money(paid)}</span></div>
          <div className="kv"><span>Balance</span><span className={`num ${left > 0.004 ? "down" : ""}`}>{money(left)}</span></div>
          <input className="input" style={{ marginTop: 10 }} placeholder="Note (optional)" value={draft.note} onChange={(e) => set("note")(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {wa && <a className="btn sm" href={wa} target="_blank" rel="noreferrer">WhatsApp reminder</a>}
            <button className={`btn sm ${dirty ? "primary" : ""}`} style={{ marginLeft: "auto" }} disabled={!dirty || saving} onClick={onSave}>
              {saving ? "Saving…" : dirty ? "Save" : saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Collect() {
  const [params, setParams] = useSearchParams();
  const month = params.get("m") || thisMonth();
  const focusId = Number(params.get("t")) || 0;
  const setMonth = (m: string) => setParams(m === thisMonth() ? {} : { m });
  const toast = useToast();
  const data = useLoad(() => api.get<{ month: string; rows: CollectRow[] }>(`/collect?month=${month}`), [month], 0, `/collect/${month}`);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [prop, setProp] = useState<string>("all");

  useEffect(() => {
    if (!data.data || data.data.month !== month) return;
    setDrafts(Object.fromEntries(data.data.rows.map((r) => [r.tenancy_id, toDraft(r)])));
    setDirty({});
  }, [data.data, month]);

  const ready = !!drafts[focusId];
  useEffect(() => {
    if (!focusId || !ready) return;
    const el = document.getElementById(`pay-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  }, [focusId, ready, month]);

  const rows = useMemo(() => (data.data?.month === month ? data.data.rows : []).filter((r) => prop === "all" || String(r.property_id) === prop), [data.data, month, prop]);
  const props = useMemo(() => {
    const m = new Map<number, string>();
    (data.data?.rows ?? []).forEach((r) => m.set(r.property_id, r.property_name));
    return [...m.entries()];
  }, [data.data]);

  const body = (r: CollectRow, d: Draft) => ({
    tenancy_id: r.tenancy_id,
    month,
    rent_due: num(d.rent_due),
    rent_paid: num(d.rent_paid),
    paid_on: d.paid_on || null,
    electricity: num(d.electricity),
    water: num(d.water),
    internet: num(d.internet),
    other_utility: num(d.other_utility),
    utilities_paid: r.utilities_mode === "charged" ? num(d.utilities_paid) : 0,
    method: d.method,
    note: d.note,
  });

  const saveOne = async (r: CollectRow) => {
    setSaving((x) => ({ ...x, [r.tenancy_id]: true }));
    try {
      await api.put<Rec>("/records", body(r, drafts[r.tenancy_id]));
      setDirty((x) => ({ ...x, [r.tenancy_id]: false }));
      toast(`Saved ${r.tenant_name}`);
      data.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving((x) => ({ ...x, [r.tenancy_id]: false }));
    }
  };

  const dirtyRows = rows.filter((r) => dirty[r.tenancy_id]);
  const saveAll = async () => {
    try {
      await api.post("/records/batch", { records: dirtyRows.map((r) => body(r, drafts[r.tenancy_id])) });
      setDirty({});
      toast(`Saved ${dirtyRows.length} tenant${dirtyRows.length > 1 ? "s" : ""}`);
      data.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const allPaid = () => {
    const nd = { ...drafts };
    const nf = { ...dirty };
    rows.forEach((r) => {
      const d = nd[r.tenancy_id];
      nd[r.tenancy_id] = { ...d, rent_paid: d.rent_due, paid_on: d.paid_on || todayMYT(), utilities_paid: r.utilities_mode === "charged" ? bills(d).toFixed(2) : d.utilities_paid };
      nf[r.tenancy_id] = true;
    });
    setDrafts(nd);
    setDirty(nf);
  };

  const totals = rows.reduce(
    (a, r) => {
      const d = drafts[r.tenancy_id];
      if (!d) return a;
      a.due += totalDue(d, r);
      a.paid += totalPaid(d, r);
      if (totalDue(d, r) - totalPaid(d, r) <= 0.004 && (r.record || dirty[r.tenancy_id])) a.done += 1;
      return a;
    },
    { due: 0, paid: 0, done: 0 },
  );

  return (
    <Shell
      title="Rent & bills"
      sub="Enter what each tenant owed and paid this month."
      actions={
        <div className="month-nav">
          <button className="iconbtn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon.left /></button>
          <span className="lbl">{monthLabel(month)}</span>
          <button className="iconbtn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><Icon.right /></button>
        </div>
      }
    >
      <div className="grid g4">
        <div className="card stat"><div className="label">Expected</div><div className="value num">{money(totals.due)}</div></div>
        <div className="card stat"><div className="label">Received</div><div className="value num up">{money(totals.paid)}</div></div>
        <div className="card stat"><div className="label">Still to collect</div><div className={`value num ${totals.due - totals.paid > 0.004 ? "down" : ""}`}>{money(totals.due - totals.paid)}</div></div>
        <div className="card stat">
          <div className="label">Settled</div>
          <div className="value num">{totals.done} / {rows.length}</div>
          <div className="meter" style={{ marginTop: 10 }}><div style={{ width: `${rows.length ? (totals.done / rows.length) * 100 : 0}%` }} /></div>
        </div>
      </div>

      <div className="row mt" style={{ flexWrap: "wrap" }}>
        {props.length > 1 ? (
          <div className="seg">
            <button className={prop === "all" ? "on" : ""} onClick={() => setProp("all")}>All</button>
            {props.map(([id, n]) => <button key={id} className={prop === String(id) ? "on" : ""} onClick={() => setProp(String(id))}>{n}</button>)}
          </div>
        ) : <span />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {month !== thisMonth() && <button className="btn sm" onClick={() => setMonth(thisMonth())}>This month</button>}
          {rows.length > 0 && <button className="btn sm" onClick={allPaid}>Mark everyone paid in full</button>}
          <a className="btn sm" href={`/api/records.csv?year=${month.slice(0, 4)}`}>Export {month.slice(0, 4)} CSV</a>
        </div>
      </div>

      <div className="grid mt">
        {!data.data && !data.error && [0, 1].map((i) => <div key={i} className="card"><Skeleton h={120} /></div>)}
        {data.error && <div className="notice err">{data.error}</div>}
        {data.data && rows.length === 0 && (
          <div className="card">
            <Empty title={`No tenancies in ${monthLabel(month)}`}>
              Add a tenant to a unit first. <Link className="link" to="/tenants?new=1">New tenancy</Link>
            </Empty>
          </div>
        )}
        {rows.map((r) =>
          drafts[r.tenancy_id] ? (
            <PayCard
              key={r.tenancy_id}
              row={r}
              month={month}
              draft={drafts[r.tenancy_id]}
              dirty={!!dirty[r.tenancy_id]}
              saving={!!saving[r.tenancy_id]}
              onChange={(d) => {
                setDrafts((x) => ({ ...x, [r.tenancy_id]: d }));
                setDirty((x) => ({ ...x, [r.tenancy_id]: true }));
              }}
              onSave={() => saveOne(r)}
              focus={r.tenancy_id === focusId}
            />
          ) : null,
        )}
      </div>

      {dirtyRows.length > 0 && (
        <div className="savebar">
          <button className="btn primary" style={{ boxShadow: "0 8px 24px rgba(0,0,0,.3)" }} onClick={saveAll}>
            Save all changes ({dirtyRows.length})
          </button>
        </div>
      )}
    </Shell>
  );
}
