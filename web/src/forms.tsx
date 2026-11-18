import { useState } from "react";
import { api, Commitment, Expense, PropertyBase, Tenancy, TenantRow, Unit, UtilMode } from "./api";
import { Field, Modal, MoneyInput, num, str, useForm, useLoad, useSubmit } from "./components/ui";
import { todayMYT, UTIL_LABEL } from "./format";

type Done = () => void;

function Actions({ busy, err, onClose, label, danger }: { busy: boolean; err: string; onClose: Done; label: string; danger?: { label: string; run: () => void } }) {
  return (
    <>
      {err && <div className="error">{err}</div>}
      <div className="modal-actions">
        {danger && (
          <button type="button" className="btn ghost-danger" style={{ marginRight: "auto" }} onClick={danger.run}>
            {danger.label}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : label}</button>
      </div>
    </>
  );
}

const COMMON_COMMITMENTS: [string, "loan" | "fee" | "other", "monthly" | "yearly"][] = [
  ["Loan instalment", "loan", "monthly"],
  ["Maintenance fee", "fee", "monthly"],
  ["Sinking fund", "fee", "monthly"],
  ["Fire insurance", "fee", "yearly"],
  ["Quit rent", "fee", "yearly"],
  ["Assessment tax", "fee", "yearly"],
  ["Internet", "other", "monthly"],
];

export function PropertyForm({ p, onClose, onSaved }: { p?: PropertyBase; onClose: Done; onSaved: (id: number) => void }) {
  const { f, set, ev } = useForm({
    name: p?.name ?? "",
    address: p?.address ?? "",
    purchase_date: p?.purchase_date ?? "",
    purchase_price: str(p?.purchase_price),
    down_payment: str(p?.down_payment),
    upfront_costs: str(p?.upfront_costs),
    loan_amount: str(p?.loan_amount),
    current_value: str(p?.current_value),
    notes: p?.notes ?? "",
    loan_instalment: "",
    maintenance: "",
    rooms: "",
  });
  const s = useSubmit(async () => {
    const body = {
      name: f.name,
      address: f.address,
      purchase_date: f.purchase_date || null,
      purchase_price: num(f.purchase_price),
      down_payment: num(f.down_payment),
      upfront_costs: num(f.upfront_costs),
      loan_amount: num(f.loan_amount),
      current_value: f.current_value ? num(f.current_value) : null,
      notes: f.notes,
    };
    if (p) {
      await api.put(`/properties/${p.id}`, body);
      onSaved(p.id);
    } else {
      const commitments = [];
      if (num(f.loan_instalment)) commitments.push({ name: "Loan instalment", kind: "loan", amount: num(f.loan_instalment) });
      if (num(f.maintenance)) commitments.push({ name: "Maintenance fee", kind: "fee", amount: num(f.maintenance) });
      const rooms = f.rooms.split(",").map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
      const r = await api.post<{ id: number }>("/properties", { ...body, commitments, units: rooms });
      onSaved(r.id);
    }
  });
  return (
    <Modal title={p ? "Edit property" : "Add a property"} sub="The purchase figures are what the return calculations use." onClose={onClose} wide>
      <form onSubmit={s.submit}>
        <div className="f2">
          <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={ev("name")} placeholder="e.g. Sky Residence A-12-3" /></Field>
          <Field label="Purchase / handover date"><input className="input" type="date" value={f.purchase_date} onChange={ev("purchase_date")} /></Field>
        </div>
        <Field label="Address"><input className="input" value={f.address} onChange={ev("address")} /></Field>
        <div className="section-title">Investment</div>
        <div className="f3">
          <Field label="Purchase price"><MoneyInput value={f.purchase_price} onChange={set("purchase_price")} /></Field>
          <Field label="Down payment" hint="Your own cash paid"><MoneyInput value={f.down_payment} onChange={set("down_payment")} /></Field>
          <Field label="Upfront costs" hint="Legal, stamp duty, reno, furniture"><MoneyInput value={f.upfront_costs} onChange={set("upfront_costs")} /></Field>
          <Field label="Loan amount"><MoneyInput value={f.loan_amount} onChange={set("loan_amount")} /></Field>
          <Field label="Market value today" hint="Optional, for total return"><MoneyInput value={f.current_value} onChange={set("current_value")} placeholder="—" /></Field>
        </div>
        {!p && (
          <>
            <div className="section-title">Quick start (you can add more later)</div>
            <div className="f3">
              <Field label="Loan instalment / month"><MoneyInput value={f.loan_instalment} onChange={set("loan_instalment")} /></Field>
              <Field label="Maintenance fee / month"><MoneyInput value={f.maintenance} onChange={set("maintenance")} /></Field>
              <Field label="Rooms to rent" hint="Comma separated. Empty = whole unit">
                <input className="input" value={f.rooms} onChange={ev("rooms")} placeholder="Master, Room 2, Room 3" />
              </Field>
            </div>
          </>
        )}
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={ev("notes")} /></Field>
        <Actions busy={s.busy} err={s.err} onClose={onClose} label={p ? "Save" : "Add property"} />
      </form>
    </Modal>
  );
}

export function UnitForm({ propertyId, u, onClose, onSaved }: { propertyId: number; u?: Unit; onClose: Done; onSaved: Done }) {
  const { f, set, ev } = useForm({ name: u?.name ?? "", target_rent: str(u?.target_rent), active: u?.active ?? true, notes: u?.notes ?? "" });
  const s = useSubmit(async () => {
    const body = { ...f, target_rent: num(f.target_rent) };
    if (u) await api.put(`/units/${u.id}`, body);
    else await api.post(`/properties/${propertyId}/units`, body);
    onSaved();
  });
  const remove = async () => {
    if (!u || !confirm(`Delete ${u.name}?`)) return;
    try {
      await api.del(`/units/${u.id}`);
      onSaved();
    } catch (e) {
      s.setErr((e as Error).message);
    }
  };
  return (
    <Modal title={u ? "Edit unit" : "Add a unit"} sub="A unit is anything you rent out on its own: the whole apartment, a room, a parking bay." onClose={onClose}>
      <form onSubmit={s.submit}>
        <div className="f2">
          <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={ev("name")} placeholder="Master room" /></Field>
          <Field label="Asking rent / month"><MoneyInput value={f.target_rent} onChange={set("target_rent")} /></Field>
        </div>
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={ev("notes")} /></Field>
        {u && (
          <label className="check" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={f.active} onChange={(e) => set("active")(e.target.checked)} />
            <span>Available for rent <small className="muted">(untick to retire it but keep its history)</small></span>
          </label>
        )}
        <Actions busy={s.busy} err={s.err} onClose={onClose} label={u ? "Save" : "Add unit"}
          danger={u && u.tenancy_count === 0 ? { label: "Delete", run: remove } : undefined} />
      </form>
    </Modal>
  );
}

export function CommitmentForm({ propertyId, c, onClose, onSaved }: { propertyId: number; c?: Commitment; onClose: Done; onSaved: Done }) {
  const { f, setF, set, ev } = useForm({
    name: c?.name ?? "",
    kind: c?.kind ?? ("fee" as Commitment["kind"]),
    amount: str(c?.amount),
    frequency: c?.frequency ?? ("monthly" as Commitment["frequency"]),
    start_date: c?.start_date ?? "",
    end_date: c?.end_date ?? "",
  });
  const s = useSubmit(async () => {
    const body = { ...f, amount: num(f.amount), start_date: f.start_date || null, end_date: f.end_date || null };
    if (c) await api.put(`/commitments/${c.id}`, body);
    else await api.post(`/properties/${propertyId}/commitments`, body);
    onSaved();
  });
  const remove = async () => {
    if (!c || !confirm(`Delete ${c.name}? Past months will no longer count it.`)) return;
    await api.del(`/commitments/${c.id}`);
    onSaved();
  };
  return (
    <Modal title={c ? "Edit commitment" : "Add a commitment"} sub="A cost you pay every month or every year to hold the property." onClose={onClose}>
      <form onSubmit={s.submit}>
        {!c && (
          <div className="quick" style={{ marginBottom: 14 }}>
            {COMMON_COMMITMENTS.map(([n, k, fr]) => (
              <button type="button" key={n} className={`btn sm ${f.name === n ? "primary" : ""}`} onClick={() => setF({ ...f, name: n, kind: k, frequency: fr })}>{n}</button>
            ))}
          </div>
        )}
        <div className="f2">
          <Field label="Name"><input className="input" required value={f.name} onChange={ev("name")} /></Field>
          <Field label="Amount"><MoneyInput value={f.amount} onChange={set("amount")} /></Field>
          <Field label="How often">
            <select className="select" value={f.frequency} onChange={ev("frequency")}>
              <option value="monthly">Every month</option>
              <option value="yearly">Once a year</option>
            </select>
          </Field>
          <Field label="Type" hint="Loan is left out of net yield">
            <select className="select" value={f.kind} onChange={ev("kind")}>
              <option value="loan">Loan instalment</option>
              <option value="fee">Fee / tax / insurance</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="From" hint="Empty = purchase date"><input className="input" type="date" value={f.start_date} onChange={ev("start_date")} /></Field>
          <Field label="Until" hint="Empty = ongoing"><input className="input" type="date" value={f.end_date} onChange={ev("end_date")} /></Field>
        </div>
        <Actions busy={s.busy} err={s.err} onClose={onClose} label={c ? "Save" : "Add"} danger={c ? { label: "Delete", run: remove } : undefined} />
      </form>
    </Modal>
  );
}

const EXPENSE_CATS = ["Repair", "Renovation", "Furniture", "Appliance", "Agent fee", "Cleaning", "Legal", "Other"];

export function ExpenseForm({ propertyId, e, onClose, onSaved }: { propertyId: number; e?: Expense; onClose: Done; onSaved: Done }) {
  const { f, set, ev } = useForm({ spent_on: e?.spent_on ?? todayMYT(), category: e?.category ?? "Repair", amount: str(e?.amount), note: e?.note ?? "" });
  const s = useSubmit(async () => {
    const body = { ...f, amount: num(f.amount) };
    if (e) await api.put(`/expenses/${e.id}`, body);
    else await api.post(`/properties/${propertyId}/expenses`, body);
    onSaved();
  });
  const remove = async () => {
    if (!e || !confirm("Delete this expense?")) return;
    await api.del(`/expenses/${e.id}`);
    onSaved();
  };
  return (
    <Modal title={e ? "Edit expense" : "Add an expense"} sub="One-off costs after purchase, such as repairs or an agent's fee." onClose={onClose}>
      <form onSubmit={s.submit}>
        <div className="f3">
          <Field label="Date"><input className="input" type="date" required value={f.spent_on} onChange={ev("spent_on")} /></Field>
          <Field label="Category">
            <select className="select" value={f.category} onChange={ev("category")}>
              {EXPENSE_CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount"><MoneyInput value={f.amount} onChange={set("amount")} autoFocus /></Field>
        </div>
        <Field label="Note"><input className="input" value={f.note} onChange={ev("note")} placeholder="e.g. Aircond service, master room" /></Field>
        <Actions busy={s.busy} err={s.err} onClose={onClose} label={e ? "Save" : "Add"} danger={e ? { label: "Delete", run: remove } : undefined} />
      </form>
    </Modal>
  );
}

function tenantFields(t?: Partial<TenantRow> & { id_number?: string }) {
  return {
    name: t?.name ?? "",
    phone: t?.phone ?? "",
    email: t?.email ?? "",
    id_number: t?.id_number ?? "",
    occupation: t?.occupation ?? "",
    emergency_contact: t?.emergency_contact ?? "",
    notes: t?.notes ?? "",
  };
}

function TenantInputs({ f, ev }: { f: ReturnType<typeof tenantFields>; ev: (k: keyof ReturnType<typeof tenantFields>) => (e: { target: { value: string } }) => void }) {
  return (
    <>
      <div className="f2">
        <Field label="Full name"><input className="input" required value={f.name} onChange={ev("name")} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={ev("phone")} placeholder="012-345 6789" /></Field>
        <Field label="IC / passport no." hint="Stored encrypted"><input className="input mono" value={f.id_number} onChange={ev("id_number")} autoComplete="off" /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={ev("email")} /></Field>
        <Field label="Occupation / employer"><input className="input" value={f.occupation} onChange={ev("occupation")} /></Field>
        <Field label="Emergency contact"><input className="input" value={f.emergency_contact} onChange={ev("emergency_contact")} placeholder="Name, relation, phone" /></Field>
      </div>
    </>
  );
}

export function TenantForm({ t, onClose, onSaved }: { t: TenantRow & { id_number: string }; onClose: Done; onSaved: Done }) {
  const { f, ev } = useForm(tenantFields(t));
  const s = useSubmit(async () => {
    await api.put(`/tenants/${t.id}`, f);
    onSaved();
  });
  return (
    <Modal title="Edit tenant" onClose={onClose} wide>
      <form onSubmit={s.submit}>
        <TenantInputs f={f} ev={ev} />
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={ev("notes")} /></Field>
        <Actions busy={s.busy} err={s.err} onClose={onClose} label="Save" />
      </form>
    </Modal>
  );
}

export function TenancyForm({ tenancy, unitId, tenantId, onClose, onSaved }: { tenancy?: Tenancy; unitId?: number; tenantId?: number; onClose: Done; onSaved: (r: { id: number; tenant_id: number }) => void }) {
  const units = useLoad(() => api.get<Unit[]>("/units"), [], 0, "/units");
  const tenants = useLoad(() => api.get<TenantRow[]>("/tenants"), [], 0, "/tenants");
  const [who, setWho] = useState<"new" | "existing">(tenantId ? "existing" : "new");
  const nt = useForm(tenantFields());
  const today = todayMYT();
  const { f, set, ev, setF } = useForm({
    unit_id: String(tenancy?.unit_id ?? unitId ?? ""),
    tenant_id: String(tenancy?.tenant_id ?? tenantId ?? ""),
    start_date: tenancy?.start_date ?? today,
    end_date: tenancy?.end_date ?? "",
    monthly_rent: str(tenancy?.monthly_rent),
    rent_due_day: String(tenancy?.rent_due_day ?? 1),
    security_deposit: str(tenancy?.security_deposit),
    utility_deposit: str(tenancy?.utility_deposit),
    access_card_deposit: str(tenancy?.access_card_deposit),
    utilities_mode: (tenancy?.utilities_mode ?? "charged") as UtilMode,
    moved_out_on: tenancy?.moved_out_on ?? "",
    deposit_returned: str(tenancy?.deposit_returned),
    notes: tenancy?.notes ?? "",
  });
  const unitList = (units.data ?? []).filter((u) => u.active || String(u.id) === f.unit_id);
  const pickUnit = (id: string) => {
    const u = unitList.find((x) => String(x.id) === id);
    setF({ ...f, unit_id: id, monthly_rent: f.monthly_rent || str(u?.target_rent) });
  };
  const setTerm = (months: number) => {
    const d = new Date(f.start_date + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(d.getUTCDate() - 1);
    set("end_date")(d.toISOString().slice(0, 10));
  };
  const s = useSubmit(async () => {
    const body = {
      start_date: f.start_date,
      end_date: f.end_date || null,
      monthly_rent: num(f.monthly_rent),
      rent_due_day: parseInt(f.rent_due_day) || 1,
      security_deposit: num(f.security_deposit),
      utility_deposit: num(f.utility_deposit),
      access_card_deposit: num(f.access_card_deposit),
      utilities_mode: f.utilities_mode,
      moved_out_on: f.moved_out_on || null,
      deposit_returned: f.deposit_returned === "" ? null : num(f.deposit_returned),
      notes: f.notes,
    };
    if (tenancy) {
      await api.put(`/tenancies/${tenancy.id}`, body);
      onSaved({ id: tenancy.id, tenant_id: tenancy.tenant_id });
    } else {
      if (!f.unit_id) throw new Error("Choose a unit");
      const extra = who === "existing" ? { tenant_id: Number(f.tenant_id) || null } : { tenant: nt.f };
      onSaved(await api.post<{ id: number; tenant_id: number }>("/tenancies", { unit_id: Number(f.unit_id), ...extra, ...body }));
    }
  });
  const remove = async () => {
    if (!tenancy || !confirm("Delete this tenancy and every rent record in it? This cannot be undone.")) return;
    await api.del(`/tenancies/${tenancy.id}`);
    onSaved({ id: 0, tenant_id: tenancy.tenant_id });
  };
  return (
    <Modal title={tenancy ? "Edit tenancy" : "New tenancy"} sub={tenancy ? `${tenancy.tenant_name} · ${tenancy.property_name} / ${tenancy.unit_name}` : "Put a tenant into a unit."} onClose={onClose} wide>
      <form onSubmit={s.submit}>
        {!tenancy && (
          <>
            <Field label="Unit">
              <select className="select" required value={f.unit_id} onChange={(e) => pickUnit(e.target.value)}>
                <option value="">Choose a unit…</option>
                {unitList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.property_name} / {u.name}{u.current ? ` (let to ${u.current.tenant_name})` : " (vacant)"}
                  </option>
                ))}
              </select>
            </Field>
            <div className="section-title">Tenant</div>
            <div className="seg" style={{ marginBottom: 14 }}>
              <button type="button" className={who === "new" ? "on" : ""} onClick={() => setWho("new")}>New tenant</button>
              <button type="button" className={who === "existing" ? "on" : ""} onClick={() => setWho("existing")}>Existing tenant</button>
            </div>
            {who === "existing" ? (
              <Field label="Tenant">
                <select className="select" required value={f.tenant_id} onChange={ev("tenant_id")}>
                  <option value="">Choose…</option>
                  {(tenants.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.phone ? ` · ${t.phone}` : ""}</option>)}
                </select>
              </Field>
            ) : (
              <TenantInputs f={nt.f} ev={nt.ev} />
            )}
            <div className="section-title">Lease</div>
          </>
        )}
        <div className="f3">
          <Field label="Start date"><input className="input" type="date" required value={f.start_date} onChange={ev("start_date")} /></Field>
          <Field label="End date">
            <input className="input" type="date" value={f.end_date} onChange={ev("end_date")} />
          </Field>
          <Field label="Quick term">
            <div className="quick">
              {[6, 12, 24].map((m) => <button type="button" key={m} className="btn sm" onClick={() => setTerm(m)}>{m}m</button>)}
            </div>
          </Field>
          <Field label="Monthly rent"><MoneyInput value={f.monthly_rent} onChange={set("monthly_rent")} /></Field>
          <Field label="Rent due on day"><input className="input" type="number" min={1} max={31} value={f.rent_due_day} onChange={ev("rent_due_day")} /></Field>
          <Field label="Utilities">
            <select className="select" value={f.utilities_mode} onChange={ev("utilities_mode")}>
              {Object.entries(UTIL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Security deposit"><MoneyInput value={f.security_deposit} onChange={set("security_deposit")} /></Field>
          <Field label="Utility deposit"><MoneyInput value={f.utility_deposit} onChange={set("utility_deposit")} /></Field>
          <Field label="Access card deposit"><MoneyInput value={f.access_card_deposit} onChange={set("access_card_deposit")} /></Field>
        </div>
        {tenancy && (
          <div className="f3">
            <Field label="Moved out on" hint="Set when the tenant leaves"><input className="input" type="date" value={f.moved_out_on} onChange={ev("moved_out_on")} /></Field>
            <Field label="Deposit returned"><MoneyInput value={f.deposit_returned} onChange={set("deposit_returned")} placeholder="—" /></Field>
          </div>
        )}
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={ev("notes")} placeholder="Agreement details, inventory, parking…" /></Field>
        <Actions busy={s.busy} err={s.err} onClose={onClose} label={tenancy ? "Save" : "Create tenancy"} danger={tenancy ? { label: "Delete tenancy", run: remove } : undefined} />
      </form>
    </Modal>
  );
}

export function EndTenancyForm({ tenancy, onClose, onSaved }: { tenancy: Tenancy; onClose: Done; onSaved: Done }) {
  const deposits = tenancy.security_deposit + tenancy.utility_deposit + tenancy.access_card_deposit;
  const owed = Math.max(0, tenancy.balance.outstanding);
  const { f, set, ev } = useForm({ moved_out_on: todayMYT(), deposit_returned: str(Math.max(0, deposits - owed)) });
  const s = useSubmit(async () => {
    await api.put(`/tenancies/${tenancy.id}`, {
      start_date: tenancy.start_date,
      end_date: tenancy.end_date,
      monthly_rent: tenancy.monthly_rent,
      rent_due_day: tenancy.rent_due_day,
      security_deposit: tenancy.security_deposit,
      utility_deposit: tenancy.utility_deposit,
      access_card_deposit: tenancy.access_card_deposit,
      utilities_mode: tenancy.utilities_mode,
      notes: tenancy.notes,
      moved_out_on: f.moved_out_on,
      deposit_returned: num(f.deposit_returned),
    });
    onSaved();
  });
  return (
    <Modal title="Tenant moving out" sub={`${tenancy.tenant_name} · ${tenancy.property_name} / ${tenancy.unit_name}`} onClose={onClose}>
      <form onSubmit={s.submit}>
        <div className="notice" style={{ marginBottom: 14 }}>
          Deposits held: <b>&nbsp;{deposits.toFixed(2)}</b>. Still owing: <b>&nbsp;{owed.toFixed(2)}</b>.
        </div>
        <div className="f2">
          <Field label="Move-out date"><input className="input" type="date" required value={f.moved_out_on} onChange={ev("moved_out_on")} /></Field>
          <Field label="Deposit returned"><MoneyInput value={f.deposit_returned} onChange={set("deposit_returned")} /></Field>
        </div>
        <Actions busy={s.busy} err={s.err} onClose={onClose} label="End tenancy" />
      </form>
    </Modal>
  );
}
