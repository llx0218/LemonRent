import { FormEvent, useState } from "react";
import { AccountInvite, AccountUser, Accounts, api } from "../api";
import { Skeleton, useLoad, useToast } from "../components/ui";
import { useAuth } from "../auth";
import { relTime } from "../format";

function inviteText(code: string, kind: "sub" | "separate") {
  const what = kind === "sub" ? "join my LemonRent account" : "create your LemonRent account";
  return `Use this code to ${what}: ${code}\n${window.location.origin}/register?code=${encodeURIComponent(code)}`;
}

function PersonRow({ u, onToggle, showParent, self }: { u: AccountUser; onToggle: (u: AccountUser) => void; showParent?: boolean; self?: boolean }) {
  return (
    <div className="unit-row" style={{ opacity: u.disabled ? 0.55 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {u.name}{" "}
          {u.role === "admin" && <span className="pill acc">Admin</span>}{" "}
          {u.sub_account && <span className="pill gray">Sub-account</span>}{" "}
          {u.disabled && <span className="pill down">Access off</span>}
        </div>
        <div className="muted tiny">
          {u.email}
          {showParent && u.parent ? ` · under ${u.parent}` : ""}
          {` · ${u.last_login_at ? `last seen ${relTime(u.last_login_at)}` : "never signed in"}`}
          {u.totp ? " · 2FA on" : ""}
        </div>
      </div>
      {self ? <span className="muted tiny">You</span> : <button className="btn sm" onClick={() => onToggle(u)}>{u.disabled ? "Turn on" : "Turn off"}</button>}
    </div>
  );
}

function InviteRow({ i, onRevoke, onCopy }: { i: AccountInvite; onRevoke: (i: AccountInvite) => void; onCopy: (i: AccountInvite) => void }) {
  const open = !i.used_by && !i.revoked;
  return (
    <div className="unit-row" style={{ opacity: open ? 1 : 0.6 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }} className="num">{i.code} <span className={`pill ${i.kind === "sub" ? "gray" : "acc"}`}>{i.kind === "sub" ? "Sub-account" : "Separate"}</span></div>
        <div className="muted tiny">
          {i.note ? `${i.note} · ` : ""}
          {i.used_by ? `used by ${i.used_by}` : i.revoked ? "revoked" : `created ${relTime(i.created_at)}, not used yet`}
        </div>
      </div>
      {open && (
        <div className="row-actions">
          <button className="btn sm" onClick={() => onCopy(i)}>Copy</button>
          <button className="btn sm" onClick={() => onRevoke(i)}>Revoke</button>
        </div>
      )}
    </div>
  );
}

export default function PeopleCard() {
  const toast = useToast();
  const { me } = useAuth();
  const d = useLoad(() => api.get<Accounts>("/accounts"), [], 0, "/accounts");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"sub" | "separate">("sub");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ code: string; kind: "sub" | "separate" } | null>(null);
  const [showUsed, setShowUsed] = useState(false);

  const copy = async (code: string, k: "sub" | "separate") => {
    const text = inviteText(code, k);
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast("Invite copied"); }
    } catch {
      /* cancelled */
    }
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ code: string }>("/accounts/invites", { note, kind });
      setFresh({ code: r.code, kind });
      setNote("");
      d.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create the invite");
    } finally {
      setBusy(false);
    }
  }

  const toggle = async (u: AccountUser) => {
    const off = !u.disabled;
    if (off && !confirm(`Turn off access for ${u.name}? They will be signed out straight away.`)) return;
    try {
      await api.post(`/accounts/users/${u.id}`, { action: off ? "disable" : "enable" });
      toast(off ? `${u.name} can no longer sign in` : `${u.name} can sign in again`);
      d.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change access");
    }
  };

  const revoke = async (i: AccountInvite) => {
    if (!confirm(`Revoke invite ${i.code}? Nobody will be able to use it.`)) return;
    await api.del(`/accounts/invites/${i.code}`);
    if (fresh?.code === i.code) setFresh(null);
    d.reload();
  };

  if (d.error) return <div className="card"><h3>People</h3><div className="notice err">{d.error}</div></div>;
  const a = d.data;
  const invites = (a?.invites ?? []).filter((i) => showUsed || (!i.used_by && !i.revoked));
  const usedCount = (a?.invites ?? []).filter((i) => i.used_by || i.revoked).length;

  return (
    <div className="card" style={{ alignSelf: "start" }}>
      <h3>People</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        A <b>sub-account</b> signs in with their own email and password, and sees and edits your properties, tenants and rent.
        {a?.can_invite_separate && <> A <b>separate account</b> starts empty with its own properties.</>}
      </p>
      {!a && <Skeleton h={90} />}
      {a && (
        <>
          <form onSubmit={create} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" style={{ flex: "1 1 160px" }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who is it for? e.g. Wife" maxLength={120} />
            {a.can_invite_separate && (
              <select className="select" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as "sub" | "separate")} aria-label="Account type">
                <option value="sub">Sub-account</option>
                <option value="separate">Separate account</option>
              </select>
            )}
            <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create invite"}</button>
          </form>
          {fresh && (
            <div className="notice" style={{ marginTop: 12, display: "block" }}>
              <div>Send this code to them. They open <b>{window.location.host}/register</b> and enter it with their own email and password. It works once.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <b className="num" style={{ fontSize: 18, letterSpacing: ".04em" }}>{fresh.code}</b>
                <button className="btn sm" onClick={() => copy(fresh.code, fresh.kind)}>Copy / share</button>
              </div>
            </div>
          )}

          <div className="section-title">Your sub-accounts</div>
          {a.members.length === 0 ? <div className="muted tiny">Nobody yet.</div> : a.members.map((u) => <PersonRow key={u.id} u={u} onToggle={toggle} />)}

          <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Invite codes</span>
            {usedCount > 0 && <button className="btn sm" onClick={() => setShowUsed((x) => !x)}>{showUsed ? "Hide used" : `Show used (${usedCount})`}</button>}
          </div>
          {invites.length === 0 ? <div className="muted tiny">No open invites.</div> : invites.map((i) => <InviteRow key={i.code} i={i} onRevoke={revoke} onCopy={(x) => copy(x.code, x.kind)} />)}

          {a.users && (
            <>
              <div className="section-title">All users (admin)</div>
              {a.users.map((u) => <PersonRow key={u.id} u={u} onToggle={toggle} showParent self={u.id === me?.id} />)}
              {a.audit && a.audit.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary className="muted tiny" style={{ cursor: "pointer" }}>Recent activity</summary>
                  {a.audit.slice(0, 30).map((x, k) => (
                    <div key={k} className="tiny" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted">{relTime(x.ts)} · {x.actor}</span> — {x.action}
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
