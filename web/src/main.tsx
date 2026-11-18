import { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { ToastProvider } from "./components/ui";
import { Login, Register, Setup2FA } from "./pages/AuthPages";
import Collect from "./pages/Collect";
import Overview from "./pages/Overview";
import { Properties, PropertyDetail } from "./pages/Properties";
import Settings from "./pages/Settings";
import { TenantDetail, Tenants } from "./pages/Tenants";
import "./styles.css";

function Guard({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function Public({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function TwoFA() {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (me.totp_enabled) return <Navigate to="/settings" replace />;
  return <Setup2FA />;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Public><Login /></Public>} />
          <Route path="/register" element={<Public><Register /></Public>} />
          <Route path="/setup-2fa" element={<TwoFA />} />
          <Route path="/" element={<Guard><Overview /></Guard>} />
          <Route path="/collect" element={<Guard><Collect /></Guard>} />
          <Route path="/properties" element={<Guard><Properties /></Guard>} />
          <Route path="/properties/:id" element={<Guard><PropertyDetail /></Guard>} />
          <Route path="/tenants" element={<Guard><Tenants /></Guard>} />
          <Route path="/tenants/:id" element={<Guard><TenantDetail /></Guard>} />
          <Route path="/settings" element={<Guard><Settings /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  </BrowserRouter>,
);
