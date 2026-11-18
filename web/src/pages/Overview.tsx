import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Overview as OV } from "../api";
import Shell from "../components/Shell";
import { Bars, Empty, Skeleton, useLoad } from "../components/ui";
import { PropertyForm } from "../forms";
import { cls, day, money, monthLabel, pct } from "../format";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value num ${tone ?? ""}`}>{value}</div>
      {sub && <div className="sub muted">{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const nav = useNavigate();
  const ov = useLoad(() => api.get<OV>("/overview"), [], 0, "/overview");
  const [adding, setAdding] = useState(false);
  const d = ov.data;
  const p = d?.portfolio;

  if (d && d.properties.length === 0) {
    return (
      <Shell title="Welcome to LemonRent" sub="Start by adding the property you rent out.">
        <div className="card">
          <Empty title="No properties yet">
            Add your apartment with its purchase price, loan and monthly fees. Then add tenants and record rent each month.
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => setAdding(true)}>Add property</button></div>
          </Empty>
        </div>
        {adding && <PropertyForm onClose={() => setAdding(false)} onSaved={(id) => nav(`/properties/${id}`)} />}
      </Shell>
    );
  }

  const collectedPct = d && d.month_expected ? Math.min(100, (d.month_collected / d.month_expected) * 100) : 0;

  return (
    <Shell title="Overview" sub={d ? `${monthLabel(d.month)} · all properties` : " "}>
      {!d || !p ? (
        <div className="grid g4">{[0, 1, 2, 3].map((i) => <div key={i} className="card"><Skeleton h={60} /></div>)}</div>
      ) : (
        <>
          <div className="grid g4">
            <Stat label="Rent per month" value={money(p.rent_now)} sub={<>{p.units_occupied} of {p.units_active} units let</>} />
            <Stat label="Monthly commitment" value={money(p.commitment_monthly)} sub="Loan, fees, insurance, taxes" />
            <Stat label="Net cashflow per month" value={money(p.expected_net_monthly, { sign: true })} tone={cls(p.expected_net_monthly)} sub="Current rent minus commitments" />
            <Stat label="Cash-on-cash ROI" value={pct(p.cash_on_cash_pct)} tone={cls(p.cash_on_cash_pct)}
              sub={<>Last 12 months · projected {pct(p.projected_cash_on_cash_pct)}</>} />
          </div>
          <div className="grid g4 mt">
            <Stat label="Cash invested" value={money(p.cash_invested)} sub="Down payment + upfront costs" />
            <Stat label="Net cashflow to date" value={money(p.net_to_date, { sign: true })} tone={cls(p.net_to_date)}
              sub={<>Payback {pct(p.payback_pct)} of cash invested</>} />
            <Stat label="Rental yield" value={pct(p.gross_yield_pct)} sub={<>Gross · net of fees {pct(p.net_yield_pct)}</>} />
            <Stat label="Overdue rent" value={money(p.arrears)} tone={p.arrears > 0 ? "down" : ""} sub={p.arrears > 0 ? `${d.owing.filter((o) => o.overdue > 0).length} tenant(s) behind` : "Everyone is up to date"} />
          </div>

          <div className="grid g21 mt">
            <div className="card">
              <h3>
                Cashflow, last 12 months
                <span className="legend">
                  <span><i style={{ background: "var(--accent)" }} />Money in</span>
                  <span><i style={{ background: "var(--peach)" }} />Money out</span>
                  <span><i style={{ background: "var(--up)" }} />Net</span>
                </span>
              </h3>
              <Bars data={p.series.map((m) => ({ label: monthLabel(m.month, false), income: m.income, outgo: m.outgo, net: m.net }))} />
            </div>
            <div className="card">
              <h3>{monthLabel(d.month)} collection <Link className="link tiny" to="/collect">Enter payments →</Link></h3>
              <div className="value num" style={{ fontSize: 24, fontWeight: 700 }}>{money(d.month_collected)}</div>
              <div className="muted tiny" style={{ margin: "4px 0 10px" }}>of {money(d.month_expected)} expected</div>
              <div className="meter"><div style={{ width: `${collectedPct}%` }} /></div>
              <div className="section-title">Who owes</div>
              {d.owing.length === 0 && <div className="muted tiny">Nobody owes anything.</div>}
              {d.owing.slice(0, 6).map((o) => (
                <Link key={o.tenancy_id} to={`/tenants/${o.tenant_id}`} className="status-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>{o.tenant_name}</div>
                    <div className="muted tiny">{o.property_name} / {o.unit_name}{o.overdue_months.length ? ` · ${o.overdue_months.length} month(s) overdue` : ""}</div>
                  </div>
                  <span className={`num ${o.overdue > 0 ? "down" : ""}`} style={{ fontWeight: 600 }}>{money(o.outstanding)}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="grid g2 mt">
            <div className="card">
              <h3>Leases ending in 60 days</h3>
              {d.ending_soon.length === 0 && <div className="muted tiny">None.</div>}
              {d.ending_soon.map((t) => (
                <Link key={t.id} to={`/tenants/${t.tenant_id}`} className="status-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.tenant_name}</div>
                    <div className="muted tiny">{t.property_name} / {t.unit_name}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div>{day(t.end_date)}</div>
                    <div className={`tiny ${(t.days_left ?? 99) <= 30 ? "down" : "muted"}`}>{t.days_left} days left</div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="card">
              <h3>Vacant units</h3>
              {d.vacant.length === 0 && <div className="muted tiny">Every unit is let.</div>}
              {d.vacant.map((u) => (
                <div key={u.id} className="status-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>{u.name}</div>
                    <div className="muted tiny">{u.property_name}</div>
                  </div>
                  <span className="muted">{u.target_rent ? `asking ${money(u.target_rent)}` : ""}</span>
                </div>
              ))}
            </div>
          </div>

          {d.properties.length > 1 && (
            <div className="card mt">
              <h3>By property</h3>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr><th>Property</th><th className="r">Rent / mo</th><th className="r">Commitment / mo</th><th className="r">Net / mo</th><th className="r">Cash-on-cash</th><th className="r">Let</th></tr>
                  </thead>
                  <tbody>
                    {d.properties.map((x) => (
                      <tr key={x.id} className="clickable" onClick={() => nav(`/properties/${x.id}`)}>
                        <td style={{ fontWeight: 600 }}>{x.name}</td>
                        <td className="r num">{money(x.stats.rent_now)}</td>
                        <td className="r num">{money(x.stats.commitment_monthly)}</td>
                        <td className={`r num ${cls(x.stats.expected_net_monthly)}`}>{money(x.stats.expected_net_monthly, { sign: true })}</td>
                        <td className={`r num ${cls(x.stats.cash_on_cash_pct)}`}>{pct(x.stats.cash_on_cash_pct)}</td>
                        <td className="r">{x.stats.units_occupied}/{x.stats.units_active}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
