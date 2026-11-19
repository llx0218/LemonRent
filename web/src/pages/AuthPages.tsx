import QRCode from "qrcode";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, Me } from "../api";
import { useAuth } from "../auth";

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <img src="/logo.png" alt="" />
          <div>LemonRent</div>
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2>
            Every unit, every tenant,
            <br />
            every ringgit.
          </h2>
          <p>
            Track leases, rent and utilities month by month, and see what your rental property really returns
            after the loan and fees.
          </p>
        </div>
        <div className="muted" style={{ fontSize: 12, position: "relative", zIndex: 1 }}>
          Tenant IC numbers are stored encrypted.
        </div>
        <svg className="waves" viewBox="0 0 800 220" preserveAspectRatio="none" aria-hidden>
          <path d="M0 120 C150 70 250 170 400 120 S650 70 800 120 V220 H0Z" fill="rgba(6,188,193,.10)" />
          <path d="M0 150 C160 110 260 190 420 150 S660 110 800 150 V220 H0Z" fill="rgba(6,188,193,.14)" />
        </svg>
      </div>
      <div className="login-form">
        <div className="box">
          <div className="brand show-m" style={{ padding: "0 0 24px" }}>
            <img src="/logo.png" alt="" />
            <div>LemonRent</div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { setMe } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api.post<Me | { need_code: true }>("/auth/login", {
        email,
        password,
        code: needCode ? code : undefined,
      });
      if ("need_code" in r) {
        setNeedCode(true);
      } else {
        setMe(r);
        nav("/");
      }
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>{needCode ? "Two-factor check" : "Welcome back"}</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>
        {needCode ? "Enter the 6-digit code from your authenticator app." : "Sign in to your LemonRent account."}
      </p>
      <form onSubmit={submit}>
        {!needCode ? (
          <>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="code">Authenticator code</label>
            <input id="code" className="input num" inputMode="numeric" autoComplete="one-time-code" autoFocus
              maxLength={6} pattern="[0-9]{6}" required value={code}
              style={{ fontSize: 22, letterSpacing: ".4em", textAlign: "center" }}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
        )}
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? "Signing in…" : needCode ? "Verify" : "Sign in"}
        </button>
      </form>
      <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 18 }}>
        New here? <Link className="link" to="/register">Create an account</Link> with your invite code.
      </p>
    </AuthLayout>
  );
}

export function Register() {
  const { setMe } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ invite_code: (params.get("code") ?? "").toUpperCase().slice(0, 32), name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (f.password.length < 10) return setErr("Use at least 10 characters for your password.");
    setBusy(true);
    try {
      setMe(await api.post<Me>("/auth/register", f));
      nav("/");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Create your account</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>LemonRent is invite only. Enter the invite code you were given.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="inv">Invite code</label>
          <input id="inv" className="input mono" required placeholder="RENT-XXXX-XXXX" value={f.invite_code}
            onChange={(e) => setF({ ...f, invite_code: e.target.value.toUpperCase() })} />
        </div>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" className="input" required autoComplete="name" value={f.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label htmlFor="em">Email</label>
          <input id="em" className="input" type="email" required autoComplete="username" value={f.email} onChange={set("email")} />
        </div>
        <div className="field">
          <label htmlFor="pw">Password (10+ characters)</label>
          <input id="pw" className="input" type="password" required autoComplete="new-password" value={f.password} onChange={set("password")} />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 18 }}>
        Already have an account? <Link className="link" to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export function Setup2FA() {
  const { setMe } = useAuth();
  const nav = useNavigate();
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .post<{ secret: string; uri: string }>("/auth/2fa/setup")
      .then(async (r) => {
        setSecret(r.secret);
        setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 360 }));
      })
      .catch((e) => setErr(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      setMe(await api.post<Me>("/auth/2fa/enable", { code }));
      nav("/settings");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Protect your account</h1>
      <p className="muted" style={{ margin: "0 0 12px", lineHeight: 1.55 }}>
        Scan this code with Google Authenticator, Authy or 1Password, then enter the 6-digit code it shows.
        After this, signing in will also ask for that code.
      </p>
      <div className="qr">{qr && <img src={qr} alt="Authenticator QR code" />}</div>
      {secret && (
        <p className="muted" style={{ textAlign: "center", fontSize: 12, margin: "0 0 16px" }}>
          Can't scan? Enter this key: <span className="mono" style={{ color: "var(--text)" }}>{secret}</span>
        </p>
      )}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="code">6-digit code</label>
          <input id="code" className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            pattern="[0-9]{6}" required value={code}
            style={{ fontSize: 22, letterSpacing: ".4em", textAlign: "center" }}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy || !secret}>{busy ? "Checking…" : "Turn on 2FA"}</button>
      </form>
      <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 18 }}>
        <Link className="link" to="/settings">Cancel</Link>
      </p>
    </AuthLayout>
  );
}
