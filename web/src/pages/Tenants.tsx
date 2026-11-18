import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, TenantDetail as TD, TenantRow, Tenancy } from "../api";
import { Icon } from "../components/icons";
import Shell from "../components/Shell";
import { Empty, Skeleton, StatusPill, useLoad, useToast } from "../components/ui";
import { EndTenancyForm, TenancyForm, TenantForm } from "../forms";
import { day, money, monthLabel, period, UTIL_LABEL } from "../format";

export function Tenants() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = useLoad(() => api.get<TenantRow[]>("/tenants"), [], 0, "/tenants");
  const [filter, setFilter] = useState<"current" | "past" | "all">("current");
  const [q, setQ] = useState("");
  const adding = params.get("new") === "1";
  const rows = (list.data ?? [])
    .filter((t) => filter === "all" || (filter === "current" ? t.status === "active" || t.status === "upcoming" : t.status === "past" || t.status === "none"))
    .filter((t) => !q || `${t.name} ${t.phone} ${t.current?.unit_name ?? ""} ${t.current?.property_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Shell title="Tenants" sub="Everyone who rents from you, their lease and what they owe."
      actions={<button className="btn primary" onClick={() => setParams({ new: "1" })}><Icon.plus />New tenancy</button>}>
      <div className="filters">
        <div className="seg">
          {(["current", "past", "all"] as const).map((k) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search name, phone, unit" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        {!list.data && <Skeleton h={120} />}
        {list.data && rows.length === 0 && (
          <Empty title={list.data.length ? "No tenants match" : "No tenants yet"}>
            {!list.data.length && <button className="btn primary" onClick={() => setParams({ new: "1" })}>Add your first tenancy</button>}
          </Empty>
        )}
        {rows.length > 0 && (
          <>
            <div className="tablewrap desk-table">
              <table>
                <thead>
                  <tr><th>Tenant</th><th>Unit</th><th>Lease</th><th className="r">Rent</th><th>Status</th><th className="r">Balance</th></tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => nav(`/tenants/${t.id}`)}>
                      <td><div style={{ fontWeight: 600 }}>{t.name}</div><div className="muted tiny">{t.phone}</div></td>
                      <td>{t.current ? <>{t.current.unit_name}<div className="muted tiny">{t.current.property_name}</div></> : <span className="muted">—</span>}</td>
                      <td>{t.current ? period(t.current.start_date, t.current.end_date) : "—"}</td>
                      <td className="r num">{t.current ? money(t.current.monthly_rent) : "—"}</td>
                      <td><StatusPill status={t.status} /></td>
                      <td className={`r num ${t.outstanding > 0 ? "down" : ""}`}>{t.outstanding > 0 ? money(t.outstanding) : "Paid up"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mcards">
              {rows.map((t) => (
                <Link key={t.id} to={`/tenants/${t.id}`} className="mcard">
                  <div className="row"><b>{t.name}</b><StatusPill status={t.status} /></div>
                  {t.current && <div className="row"><span className="muted tiny">{t.current.property_name} / {t.current.unit_name}</span><span className="num">{money(t.current.monthly_rent)}</span></div>}
                  <div className="row"><span className="muted tiny">{t.current ? period(t.current.start_date, t.current.end_date) : t.phone}</span>
                    <span className={`num tiny ${t.outstanding > 0 ? "down" : "muted"}`}>{t.outstanding > 0 ? `owes ${money(t.outstanding)}` : "paid up"}</span></div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
      {adding && <TenancyForm onClose={() => setParams({})} onSaved={(r) => nav(`/tenants/${r.tenant_id}`)} />}
    </Shell>
  );
}

function TenancyCard({ t, onEdit, onEnd }: { t: Tenancy; onEdit: () => void; onEnd: () => void }) {
  const recs = t.records ?? [];
  return (
    <div className="card mt">
      <h3>
        <span>
          <Link className="link" to={`/properties/${t.property_id}`}>{t.property_name}</Link> / {t.unit_name} <StatusPill status={t.status} />
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          {t.status === "active" && <button className="btn sm" onClick={onEnd}>Moving out</button>}
          <button className="btn sm" onClick={onEdit}><Icon.edit />Edit</button>
        </span>
      </h3>
      <div className="grid g4" style={{ gap: 10 }}>
        <div><div className="muted tiny">Lease</div><div>{period(t.start_date, t.end_date)}</div>
          {t.moved_out_on && <div className="muted tiny">Moved out {day(t.moved_out_on)}</div>}
          {t.days_left !== null && t.status === "active" && <div className={`tiny ${t.days_left <= 30 ? "down" : "muted"}`}>{t.days_left} days left</div>}</div>
        <div><div className="muted tiny">Rent</div><div className="num">{money(t.monthly_rent)} <span className="muted tiny">due day {t.rent_due_day}</span></div>
          <div className="muted tiny">{UTIL_LABEL[t.utilities_mode]}</div></div>
        <div><div className="muted tiny">Deposits held</div><div className="num">{money(t.security_deposit + t.utility_deposit)}</div>
          <div className="muted tiny">{money(t.security_deposit)} security · {money(t.utility_deposit)} utility</div>
          {t.deposit_returned !== null && <div className="muted tiny">Returned {money(t.deposit_returned)}</div>}</div>
        <div><div className="muted tiny">Balance</div>
          <div className={`num ${t.balance.outstanding > 0 ? "down" : "up"}`} style={{ fontWeight: 700 }}>{t.balance.outstanding > 0 ? money(t.balance.outstanding) : "Paid up"}</div>
          {t.balance.overdue_months.length > 0 && <div className="tiny down">Overdue: {t.balance.overdue_months.map((m) => monthLabel(m, false)).join(", ")}</div>}
          {t.balance.unrecorded_months.length > 0 && <div className="tiny muted">Not entered yet: {t.balance.unrecorded_months.map((m) => monthLabel(m, false)).join(", ")}</div>}</div>
      </div>
      {t.notes && <p className="muted tiny" style={{ whiteSpace: "pre-wrap" }}>{t.notes}</p>}
      <div className="section-title">Payment history</div>
      {recs.length === 0 ? (
        <div className="muted tiny">Nothing recorded yet. <Link className="link" to="/collect">Enter this month's payment</Link></div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Month</th><th className="r">Rent due</th><th className="r">Rent paid</th><th className="r hide-m">Bills</th><th className="r hide-m">Bills paid</th><th className="r">Balance</th><th className="hide-m">Paid on</th></tr>
            </thead>
            <tbody>
              {recs.map((r) => {
                const bal = r.rent_due + r.utilities_due - r.rent_paid - (t.utilities_mode === "charged" ? r.utilities_paid : 0);
                return (
                  <tr key={r.id}>
                    <td><Link className="link" to={`/collect?m=${r.month}`}>{monthLabel(r.month, false)}</Link></td>
                    <td className="r num">{money(r.rent_due)}</td>
                    <td className="r num">{money(r.rent_paid)}</td>
                    <td className="r num hide-m">{money(r.utility_bills)}</td>
                    <td className="r num hide-m">{t.utilities_mode === "charged" ? money(r.utilities_paid) : "—"}</td>
                    <td className={`r num ${bal > 0.004 ? "down" : "muted"}`}>{bal > 0.004 ? money(bal) : "✓"}</td>
                    <td className="hide-m muted">{r.paid_on ? day(r.paid_on, false) : ""}{r.method ? ` · ${r.method}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TenantDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const t = useLoad(() => api.get<TD>(`/tenants/${id}`), [id], 0, `/tenants/${id}`);
  const [dlg, setDlg] = useState<{ k: "edit" } | { k: "new" } | { k: "tenancy"; x: Tenancy } | { k: "end"; x: Tenancy } | null>(null);
  const [showId, setShowId] = useState(false);
  const done = () => {
    setDlg(null);
    t.reload();
  };
  const d = t.data;
  if (t.error) return <Shell title="Tenant"><div className="notice err">{t.error}</div></Shell>;
  if (!d) return <Shell title=" "><div className="card"><Skeleton h={160} /></div></Shell>;
  const wa = d.phone.replace(/\D/g, "").replace(/^0/, "60");

  const remove = async () => {
    if (!confirm(`Delete ${d.name}?`)) return;
    try {
      await api.del(`/tenants/${d.id}`);
      toast("Tenant deleted");
      nav("/tenants");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Shell title={d.name} sub={d.current ? `${d.current.property_name} / ${d.current.unit_name}` : "No current lease"}
      actions={<>
        <button className="btn" onClick={() => setDlg({ k: "edit" })}><Icon.edit />Edit</button>
        <button className="btn primary" onClick={() => setDlg({ k: "new" })}><Icon.plus />New tenancy</button>
      </>}>
      <div className="card">
        <div className="grid g4" style={{ gap: 12 }}>
          <div><div className="muted tiny">Phone</div>
            {d.phone ? <div><a className="link" href={`tel:${d.phone}`}>{d.phone}</a>{wa && <> · <a className="link" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a></>}</div> : "—"}</div>
          <div><div className="muted tiny">Email</div><div>{d.email || "—"}</div></div>
          <div><div className="muted tiny">IC / passport</div>
            <div className="mono">{d.id_number ? (showId ? d.id_number : d.id_number_masked) : "—"} {d.id_number && <button className="btn sm" style={{ padding: "2px 8px" }} onClick={() => setShowId((x) => !x)}>{showId ? "Hide" : "Show"}</button>}</div></div>
          <div><div className="muted tiny">Total owing</div><div className={`num ${d.outstanding > 0 ? "down" : "up"}`} style={{ fontWeight: 700 }}>{d.outstanding > 0 ? money(d.outstanding) : "Paid up"}</div></div>
          <div><div className="muted tiny">Occupation</div><div>{d.occupation || "—"}</div></div>
          <div><div className="muted tiny">Emergency contact</div><div>{d.emergency_contact || "—"}</div></div>
        </div>
        {d.notes && <p className="muted tiny" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{d.notes}</p>}
      </div>

      {d.tenancies.map((x) => (
        <TenancyCard key={x.id} t={x} onEdit={() => setDlg({ k: "tenancy", x })} onEnd={() => setDlg({ k: "end", x })} />
      ))}
      {d.tenancies.length === 0 && (
        <div className="card mt">
          <Empty title="No tenancy yet"><button className="btn primary" onClick={() => setDlg({ k: "new" })}>Put {d.name} in a unit</button></Empty>
          <div className="danger-zone"><button className="btn sm ghost-danger" onClick={remove}>Delete tenant</button></div>
        </div>
      )}

      {dlg?.k === "edit" && <TenantForm t={d} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "new" && <TenancyForm tenantId={d.id} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "tenancy" && <TenancyForm tenancy={dlg.x} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "end" && <EndTenancyForm tenancy={dlg.x} onClose={() => setDlg(null)} onSaved={done} />}
    </Shell>
  );
}
