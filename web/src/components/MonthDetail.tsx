import { Link } from "react-router-dom";
import { api, CashflowItem, CashflowMonth } from "../api";
import { money, monthLabel, day, RECEIPT_LABEL } from "../format";
import { Modal, Skeleton, useLoad } from "./ui";

function Items({ title, items, tone, empty }: { title: string; items: CashflowItem[]; tone?: string; empty: string }) {
  const total = items.reduce((a, i) => a + i.amount, 0);
  return (
    <>
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span><span className={`num ${tone ?? ""}`}>{money(total)}</span>
      </div>
      {items.length === 0 && <div className="muted tiny">{empty}</div>}
      {items.map((i, k) => (
        <div key={k} className="unit-row" style={{ padding: "9px 0" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{RECEIPT_LABEL[i.kind] ?? i.label}</div>
            <div className="muted tiny">
              {i.tenant_id ? <Link className="link" to={`/tenants/${i.tenant_id}`}>{i.who}</Link> : i.who}
              {i.date ? `${i.who ? " · " : ""}${day(i.date)}` : ""}
            </div>
          </div>
          <span className="num">{money(i.amount)}</span>
        </div>
      ))}
    </>
  );
}

export function MonthDetail({ month, propertyId, onClose }: { month: string; propertyId?: number; onClose: () => void }) {
  const q = propertyId ? `?property_id=${propertyId}` : "";
  const d = useLoad(() => api.get<CashflowMonth>(`/cashflow/${month}${q}`), [month, q], 0, `/cashflow/${month}${q}`);
  const t = d.data?.total;
  const props = (d.data?.properties ?? []).filter((p) => !!propertyId || p.income.length + p.outgo.length + p.deposits.length + p.unpaid.length > 0);
  return (
    <Modal title={monthLabel(month)} sub={propertyId ? props[0]?.name : "All properties"} onClose={onClose} wide>
      {!d.data && !d.error && <Skeleton h={200} />}
      {d.error && <div className="notice err">{d.error}</div>}
      {t && (
        <div className="mini-stats">
          <div><span>In</span><b className="num up">{money(t.income)}</b></div>
          <div><span>Out</span><b className="num">{money(t.outgo)}</b></div>
          <div><span>Net</span><b className={`num ${t.net >= 0 ? "up" : "down"}`}>{money(t.net, { sign: true })}</b></div>
        </div>
      )}
      {props.map((p) => (
        <div key={p.id} style={{ marginTop: 10 }}>
          {!propertyId && <h3 style={{ margin: "14px 0 0" }}>{p.name} <span className={`num tiny ${p.flow.net >= 0 ? "up" : "down"}`}>{money(p.flow.net, { sign: true })}</span></h3>}
          <Items title="Money in" items={p.income} tone="up" empty="Nothing received this month." />
          <Items title="Money out" items={p.outgo} empty="Nothing paid out this month." />
          {p.unpaid.length > 0 && (
            <>
              <div className="section-title">Not paid</div>
              {p.unpaid.map((u, k) => (
                <div key={k} className="unit-row" style={{ padding: "9px 0" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{u.who}</div>
                    <div className="muted tiny">{u.entered ? "Balance still owed" : "Not entered yet"}</div>
                  </div>
                  <Link className="btn sm" to={`/collect?m=${month}&t=${u.tenancy_id}`}><span className="num down">{money(u.amount)}</span>&nbsp;Enter</Link>
                </div>
              ))}
            </>
          )}
          {p.deposits.length > 0 && <Items title="Deposits received (held, not income)" items={p.deposits} empty="" />}
        </div>
      ))}
      {d.data && props.length === 0 && <div className="muted">Nothing happened this month.</div>}
    </Modal>
  );
}
