import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, Me } from "../api";
import { useAuth } from "../auth";
import Shell from "../components/Shell";
import { useLoad, useToast } from "../components/ui";
import { relTime } from "../format";

function TwoFactorRow() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ password: "", code: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const on = !!me?.totp_enabled;

  async function disable(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      setMe(await api.post<Me>("/auth/2fa/disable", f));
      setF({ password: "", code: "" });
      setOpen(false);
      toast("Two-factor authentication is off");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "4px 0 12px", borderBottom: "1px solid var(--border)" }}>
      <div className="row">
        <div>
          <b>Two-factor authentication</b>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {on ? "Sign-in asks for a code from your authenticator app" : "Optional · recommended, tenant details are stored here"}
          </div>
        </div>
        {on
          ? (!open && <button className="btn sm" onClick={() => setOpen(true)}>Turn off</button>)
          : <Link className="btn sm primary" to="/setup-2fa">Turn on</Link>}
      </div>
      {on && open && (
        <form onSubmit={disable} style={{ marginTop: 12 }}>
          <div className="field"><label>Password</label><input className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
          <div className="field"><label>6-digit code</label><input className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} required /></div>
          {err && <div className="error">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn danger block" disabled={busy}>{busy ? "Checking…" : "Turn off 2FA"}</button>
            <button type="button" className="btn block" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function SecurityCard() {
  const toast = useToast();
  const sessions = useLoad(() => api.get<{ id: string; current: boolean; ip: string; user_agent: string; last_seen_at: string }[]>("/auth/sessions"), [], 0, "/auth/sessions");
  const [pw, setPw] = useState({ current: "", new: "" });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  async function change(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/auth/password", pw);
      setPw({ current: "", new: "" });
      setOpen(false);
      toast("Password changed. Other devices were signed out.");
      sessions.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  const device = (ua: string) =>
    `${/iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device"} · ${/Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "Browser"}`;

  return (
    <div className="card">
      <h3>Security</h3>
      <TwoFactorRow />
      <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
        <div className="row">
          <div><b>Password</b></div>
          {!open && <button className="btn sm" onClick={() => setOpen(true)}>Change</button>}
        </div>
        {open && (
          <form onSubmit={change} style={{ marginTop: 12 }}>
            <div className="field"><label>Current password</label><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></div>
            <div className="field"><label>New password (10+ characters)</label><input className="input" type="password" autoComplete="new-password" minLength={10} value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} required /></div>
            {err && <div className="error">{err}</div>}
            <div className="row" style={{ gap: 8 }}><button className="btn primary block">Save</button><button type="button" className="btn block" onClick={() => setOpen(false)}>Cancel</button></div>
          </form>
        )}
      </div>
      <div style={{ paddingTop: 12 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <b>Signed-in devices</b>
          {(sessions.data?.length ?? 0) > 1 && (
            <button className="btn sm" onClick={async () => { await api.post("/auth/sessions/revoke-others"); sessions.reload(); toast("Other devices signed out"); }}>Sign out others</button>
          )}
        </div>
        {sessions.data?.map((s) => (
          <div className="status-row" key={s.id}>
            <div><div>{device(s.user_agent)}{s.current && <span className="pill acc" style={{ marginLeft: 8 }}>This device</span>}</div><div className="muted" style={{ fontSize: 12 }}>{s.ip}</div></div>
            <span className="muted" style={{ fontSize: 12.5 }}>{relTime(s.last_seen_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <Shell title="Settings" sub="Your sign-in and security.">
      <div className="grid g2">
        <SecurityCard />
        <div className="card" style={{ alignSelf: "start" }}>
          <h3>Export</h3>
          <p className="muted" style={{ marginTop: 0 }}>Download every rent and utility record as a spreadsheet (CSV), for your tax filing or accountant.</p>
          <a className="btn" href="/api/records.csv">Download all records</a>
        </div>
      </div>
    </Shell>
  );
}
