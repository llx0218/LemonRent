import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Commitment, Expense, PropertyDetail as PD, PropertySummary, Unit } from "../api";
import { Icon } from "../components/icons";
import Shell from "../components/Shell";
import { Bars, Empty, Skeleton, useLoad, useToast } from "../components/ui";
import { CommitmentForm, ExpenseForm, PropertyForm, TenancyForm, UnitForm } from "../forms";
import { MonthDetail } from "../components/MonthDetail";
import { cls, day, money, monthLabel, pct, period } from "../format";

export function Properties() {
  const nav = useNavigate();
  const list = useLoad(() => api.get<PropertySummary[]>("/properties"), [], 0, "/properties");
  const [adding, setAdding] = useState(false);
  return (
    <Shell title="Properties" sub="Each property, its units and what it returns."
      actions={<button className="btn primary" onClick={() => setAdding(true)}><Icon.plus />Add property</button>}>
      {!list.data && <div className="grid g2">{[0, 1].map((i) => <div key={i} className="card"><Skeleton h={120} /></div>)}</div>}
      {list.data?.length === 0 && (
        <div className="card"><Empty title="No properties yet"><button className="btn primary" onClick={() => setAdding(true)}>Add your first property</button></Empty></div>
      )}
      <div className="grid g2">
        {list.data?.map((p) => (
          <Link key={p.id} to={`/properties/${p.id}`} className="card prop-card">
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                <div className="muted tiny">{p.address || "No address"}</div>
              </div>
              <span className={`pill ${p.stats.units_occupied === p.stats.units_active ? "up" : "warn"}`}>
                {p.stats.units_occupied}/{p.stats.units_active} let
              </span>
            </div>
            <div className="nums">
              <div><span>Rent / mo</span><b className="num">{money(p.stats.rent_now)}</b></div>
              <div><span>Commitment / mo</span><b className="num">{money(p.stats.commitment_monthly)}</b></div>
              <div><span>Net / mo</span><b className={`num ${cls(p.stats.expected_net_monthly)}`}>{money(p.stats.expected_net_monthly, { sign: true })}</b></div>
            </div>
            <div className="nums">
              <div><span>Cash-on-cash</span><b className={`num ${cls(p.stats.cash_on_cash_pct)}`}>{pct(p.stats.cash_on_cash_pct)}</b></div>
              <div><span>Gross yield</span><b className="num">{pct(p.stats.gross_yield_pct)}</b></div>
              <div><span>Payback</span><b className="num">{pct(p.stats.payback_pct)}</b></div>
            </div>
          </Link>
        ))}
      </div>
      {adding && <PropertyForm onClose={() => setAdding(false)} onSaved={(id) => nav(`/properties/${id}`)} />}
    </Shell>
  );
}

type Dlg =
  | { k: "edit" }
  | { k: "unit"; u?: Unit }
  | { k: "let"; unitId: number }
  | { k: "commit"; c?: Commitment }
  | { k: "expense"; e?: Expense }
  | null;

function KV({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="kv"><span>{k}</span><span className={`num ${tone ?? ""}`}>{v}</span></div>;
}

export function PropertyDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const p = useLoad(() => api.get<PD>(`/properties/${id}`), [id], 0, `/properties/${id}`);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [order, setOrder] = useState<number[] | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const done = () => {
    setDlg(null);
    p.reload();
  };
  useEffect(() => setOrder(null), [p.data]);

  const saveOrder = async (ids: number[]) => {
    try {
      await api.put(`/properties/${id}/units/order`, { ids });
      toast("Unit order saved");
      p.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the order");
      setOrder(null);
    }
  };

  const startDrag = (uid: number, ev: React.PointerEvent) => {
    if (!p.data) return;
    ev.preventDefault();
    let ids = order ?? p.data.units.map((u) => u.id);
    const startIds = ids.join(",");
    setDragId(uid);
    setOrder(ids);
    const move = (e: PointerEvent) => {
      const y = e.clientY;
      const others = ids.filter((x) => x !== uid);
      let at = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = rowRefs.current[others[i]]?.getBoundingClientRect();
        if (r && y < r.top + r.height / 2) { at = i; break; }
      }
      const next = [...others.slice(0, at), uid, ...others.slice(at)];
      if (next.join(",") !== ids.join(",")) { ids = next; setOrder(next); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragId(null);
      if (ids.join(",") !== startIds) saveOrder(ids);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const d = p.data;
  if (p.error) return <Shell title="Property"><div className="notice err">{p.error}</div></Shell>;
  if (!d) return <Shell title=" "><div className="card"><Skeleton h={200} /></div></Shell>;
  const st = d.stats;
  const totalCommit = d.commitments.reduce((a, c) => a + c.monthly, 0);

  const remove = async () => {
    if (prompt(`This deletes ${d.name}, its units, tenancies and every rent record. Type the property name to confirm.`) !== d.name) return;
    await api.del(`/properties/${d.id}`);
    toast("Property deleted");
    nav("/properties");
  };

  return (
    <Shell title={d.name} sub={d.address || (d.purchase_date ? `Owned since ${day(d.purchase_date)}` : undefined)}
      actions={<button className="btn" onClick={() => setDlg({ k: "edit" })}><Icon.edit />Edit</button>}>
      <div className="grid g4">
        <div className="card stat"><div className="label">Net cashflow / month</div><div className={`value num ${cls(st.expected_net_monthly)}`}>{money(st.expected_net_monthly, { sign: true })}</div>
          <div className="sub muted">{money(st.rent_now)} rent − {money(st.commitment_monthly)} commitments</div></div>
        <div className="card stat"><div className="label">Cash-on-cash ROI</div><div className={`value num ${cls(st.cash_on_cash_pct)}`}>{pct(st.cash_on_cash_pct)}</div>
          <div className="sub muted">Actual, last {st.last12.months} mo · projected {pct(st.projected_cash_on_cash_pct)}</div></div>
        <div className="card stat"><div className="label">Rental yield</div><div className="value num">{pct(st.gross_yield_pct)}</div>
          <div className="sub muted">Gross · net of fees {pct(st.net_yield_pct)}</div></div>
        <div className="card stat"><div className="label">Payback</div><div className="value num">{pct(st.payback_pct)}</div>
          <div className="meter" style={{ marginTop: 10 }}><div style={{ width: `${Math.max(0, Math.min(100, st.payback_pct ?? 0))}%` }} /></div>
          <div className="sub muted">of {money(st.cash_invested)} cash invested</div></div>
      </div>

      <div className="grid g21 mt">
        <div className="card">
          <h3>
            Cashflow, last 12 months
            <span className="legend">
              <span><i style={{ background: "var(--accent)" }} />In</span>
              <span><i style={{ background: "var(--peach)" }} />Out</span>
              <span><i style={{ background: "var(--up)" }} />Net</span>
            </span>
          </h3>
          <Bars data={d.series.map((m) => ({ label: monthLabel(m.month, false), income: m.income, outgo: m.outgo, net: m.net }))} onPick={setPick} picked={pick} />
          <div className="muted tiny" style={{ marginTop: 6 }}>Tap a month to see the details.</div>
          {pick !== null && d.series[pick] && <MonthDetail month={d.series[pick].month} propertyId={d.id} onClose={() => setPick(null)} />}
        </div>
        <div className="card">
          <h3>Since purchase <span className="muted">{st.months_owned} months</span></h3>
          <KV k="Rent received" v={money(st.to_date.rent_in)} tone="up" />
          <KV k="Utilities paid back" v={money(st.to_date.utilities_in)} />
          <KV k="Admin & other fees" v={money(st.to_date.fees_in)} tone={st.to_date.fees_in > 0 ? "up" : undefined} />
          <KV k="Utility bills" v={money(-st.to_date.utilities_cost)} />
          <KV k="Commitments" v={money(-st.to_date.commitments)} />
          <KV k="One-off expenses" v={money(-st.to_date.expenses)} />
          <KV k="Net cashflow" v={money(st.to_date.net, { sign: true })} tone={cls(st.to_date.net)} />
          <KV k="Deposits held (not income)" v={money(st.deposits_held)} />
          {st.appreciation !== null && (
            <>
              <KV k="Value gain" v={money(st.appreciation, { sign: true })} tone={cls(st.appreciation)} />
              <KV k="Total return on cash" v={pct(st.total_return_pct)} tone={cls(st.total_return_pct)} />
            </>
          )}
        </div>
      </div>

      <div className="grid g2 mt">
        <div className="card">
          <h3>Units
            <span style={{ display: "flex", gap: 6 }}>
              {d.units.length > 1 && <button className="btn sm" onClick={() => saveOrder([...d.units].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).map((u) => u.id))}>Sort A–Z</button>}
              <button className="btn sm" onClick={() => setDlg({ k: "unit" })}><Icon.plus />Add unit</button>
            </span>
          </h3>
          {d.units.length > 1 && <div className="muted tiny" style={{ marginTop: -4 }}>Drag ⠿ to change the order.</div>}
          {(order ? order.map((uid) => d.units.find((u) => u.id === uid)!).filter(Boolean) : d.units).map((u) => (
            <div key={u.id} ref={(el) => { rowRefs.current[u.id] = el; }} className={`unit-row${dragId === u.id ? " dragging" : ""}`} style={{ opacity: u.active ? 1 : 0.55 }}>
              {d.units.length > 1 && <span className="drag-handle" aria-label={`Drag to reorder ${u.name}`} onPointerDown={(e) => startDrag(u.id, e)}>⠿</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{u.name} {!u.active && <span className="pill gray">Inactive</span>}</div>
                {u.current ? (
                  <div className="muted tiny">
                    <Link className="link" to={`/tenants/${u.current.tenant_id}`}>{u.current.tenant_name}</Link> · {money(u.current.monthly_rent)}/mo · {period(u.current.start_date, u.current.end_date)}
                  </div>
                ) : (
                  <div className="muted tiny">Vacant{u.target_rent ? ` · asking ${money(u.target_rent)}` : ""}{u.upcoming ? ` · ${u.upcoming.tenant_name} from ${day(u.upcoming.start_date)}` : ""}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!u.current && u.active && <button className="btn sm primary" onClick={() => setDlg({ k: "let", unitId: u.id })}>Let</button>}
                <button className="btn sm" onClick={() => setDlg({ k: "unit", u })} aria-label="Edit unit"><Icon.edit /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Monthly commitment <button className="btn sm" onClick={() => setDlg({ k: "commit" })}><Icon.plus />Add</button></h3>
          {d.commitments.length === 0 && <div className="muted tiny">Add the loan instalment, maintenance fee, sinking fund, insurance and yearly taxes.</div>}
          {d.commitments.map((c) => (
            <div key={c.id} className="unit-row clickable" onClick={() => setDlg({ k: "commit", c })}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.name} {c.kind === "loan" && <span className="pill acc">Loan</span>}</div>
                <div className="muted tiny">
                  {money(c.amount)} {c.frequency === "yearly" ? "a year" : "a month"}
                  {c.end_date ? ` · until ${day(c.end_date)}` : ""}
                </div>
              </div>
              <span className="num" style={{ fontWeight: 600 }}>{money(c.monthly)}<span className="muted tiny"> /mo</span></span>
            </div>
          ))}
          {d.commitments.length > 0 && <div className="kv" style={{ borderTop: "1px solid var(--border2)" }}><span>Total per month</span><span className="num">{money(totalCommit)}</span></div>}
        </div>
      </div>

      <div className="grid g2 mt">
        <div className="card">
          <h3>One-off expenses <button className="btn sm" onClick={() => setDlg({ k: "expense" })}><Icon.plus />Add</button></h3>
          {d.expenses.length === 0 && <div className="muted tiny">Repairs, agent fees, new furniture after you started renting.</div>}
          {d.expenses.slice(0, 12).map((e) => (
            <div key={e.id} className="unit-row clickable" onClick={() => setDlg({ k: "expense", e })}>
              <div>
                <div style={{ fontWeight: 600 }}>{e.category}</div>
                <div className="muted tiny">{day(e.spent_on)}{e.note ? ` · ${e.note}` : ""}</div>
              </div>
              <span className="num">{money(e.amount)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Investment</h3>
          <KV k="Purchase price" v={money(d.purchase_price)} />
          <KV k="Down payment" v={money(d.down_payment)} />
          <KV k="Upfront costs" v={money(d.upfront_costs)} />
          <KV k="Cash invested" v={money(st.cash_invested)} />
          <KV k="Loan" v={money(d.loan_amount)} />
          <KV k="Market value" v={d.current_value ? money(d.current_value) : "—"} />
          {d.notes && <p className="muted tiny" style={{ whiteSpace: "pre-wrap" }}>{d.notes}</p>}
          <div className="danger-zone">
            <button className="btn sm ghost-danger" onClick={remove}>Delete property</button>
          </div>
        </div>
      </div>

      {dlg?.k === "edit" && <PropertyForm p={d} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "unit" && <UnitForm propertyId={d.id} u={dlg.u} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "let" && <TenancyForm unitId={dlg.unitId} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "commit" && <CommitmentForm propertyId={d.id} c={dlg.c} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "expense" && <ExpenseForm propertyId={d.id} e={dlg.e} onClose={() => setDlg(null)} onSaved={done} />}
    </Shell>
  );
}
