import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { useSession } from "./session";
import { AuthPage } from "./pages/AuthPage";
import { ChatPage } from "./pages/ChatPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentPage } from "./pages/DocumentPage";
import { LandingPage } from "./pages/LandingPage";
import { LibraryPage } from "./pages/LibraryPage";
import { OperationsPage } from "./pages/OperationsPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/app" element={<RequireAuth><Shell><DashboardPage /></Shell></RequireAuth>} />
      <Route path="/app/library" element={<RequireAuth><Shell><LibraryPage /></Shell></RequireAuth>} />
      <Route path="/app/documents/:id" element={<RequireAuth><Shell><DocumentPage /></Shell></RequireAuth>} />
      <Route path="/app/chat" element={<RequireAuth><Shell><ChatPage /></Shell></RequireAuth>} />
      <Route path="/app/chat/:conversationId" element={<RequireAuth><Shell><ChatPage /></Shell></RequireAuth>} />
      <Route path="/app/operations" element={<RequireAuth><Shell><OperationsPage /></Shell></RequireAuth>} />
      <Route path="/app/settings" element={<RequireAuth><Shell><SettingsPage /></Shell></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.status === "loading") return <p className="p-6 text-sm text-muted">Checking your session…</p>;
  if (session.status === "anonymous") return <Navigate to="/login" replace />;
  if (session.error) return <p className="p-6 text-sm text-red-700" role="alert">{session.error}</p>;
  return children;
}
