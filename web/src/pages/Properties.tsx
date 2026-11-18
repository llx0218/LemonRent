import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Commitment, Expense, PropertyDetail as PD, PropertySummary, Unit } from "../api";
import { Icon } from "../components/icons";
import Shell from "../components/Shell";
import { Bars, Empty, Skeleton, useLoad, useToast } from "../components/ui";
import { CommitmentForm, ExpenseForm, PropertyForm, TenancyForm, UnitForm } from "../forms";
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
  const done = () => {
    setDlg(null);
    p.reload();
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
          <Bars data={d.series.map((m) => ({ label: monthLabel(m.month, false), income: m.income, outgo: m.outgo, net: m.net }))} />
        </div>
        <div className="card">
          <h3>Since purchase <span className="muted">{st.months_owned} months</span></h3>
          <KV k="Rent received" v={money(st.to_date.rent_in)} tone="up" />
          <KV k="Utilities paid back" v={money(st.to_date.utilities_in)} />
          <KV k="Utility bills" v={money(-st.to_date.utilities_cost)} />
          <KV k="Commitments" v={money(-st.to_date.commitments)} />
          <KV k="One-off expenses" v={money(-st.to_date.expenses)} />
          <KV k="Net cashflow" v={money(st.to_date.net, { sign: true })} tone={cls(st.to_date.net)} />
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
          <h3>Units <button className="btn sm" onClick={() => setDlg({ k: "unit" })}><Icon.plus />Add unit</button></h3>
          {d.units.map((u) => (
            <div key={u.id} className="unit-row" style={{ opacity: u.active ? 1 : 0.55 }}>
              <div style={{ minWidth: 0 }}>
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
