import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Icon } from "./icons";

export default function Shell({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!me) return null;
  const items: [string, string, () => JSX.Element][] = [
    ["/", "Overview", Icon.home],
    ["/collect", "Rent & bills", Icon.cash],
    ["/properties", "Properties", Icon.building],
    ["/tenants", "Tenants", Icon.users],
    ["/settings", "Settings", Icon.gear],
  ];
  const initials = me.name
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="shell">
      <div className="app">
        <aside className="side">
          <div className="brand">
            <img src="/logo.png" alt="" />
            <div>
              LemonRent<small>Rental investment tracker</small>
            </div>
          </div>
          <nav className="nav">
            {items.map(([to, label, Ic]) => (
              <NavLink key={to} to={to} end={to === "/"}>
                <Ic />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="scroll">
          <main className="main">
            <div className="top">
              <div className="top-title">
                <h1>{title}</h1>
                {sub && <p>{sub}</p>}
              </div>
              {actions && <div className="top-actions">{actions}</div>}
              <div className="top-me" ref={menuRef}>
                <button className="avatar" onClick={() => setMenu((m) => !m)} aria-label="Account menu">
                  {initials || "?"}
                </button>
                {menu && (
                  <div className="menu">
                    <div className="who">
                      <b>{me.name}</b>
                      <div className="muted" style={{ fontSize: 12 }}>{me.email}</div>
                    </div>
                    <button onClick={() => { setMenu(false); nav("/settings"); }}>Settings</button>
                    <button
                      onClick={async () => {
                        await logout();
                        nav("/login");
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
            {children}
          </main>
        </div>
        <nav className="tabbar" style={{ ["--tabs" as string]: items.length }}>
          {items.map(([to, label, Ic]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Ic />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
