import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, client, type User, type Workspace } from "./lib/api";

const STORAGE_KEY = "pdf-summary-workspace";

interface SessionValue {
  status: "loading" | "anonymous" | "ready";
  user: User | null;
  workspaces: Workspace[];
  workspaceId: string | null;
  workspace: Workspace | null;
  error: string | null;
  refresh: () => Promise<void>;
  selectWorkspace: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(localStorage.getItem(STORAGE_KEY));
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await client.me();
      setUser(result.user);
      setWorkspaces(result.workspaces);
      setWorkspaceId((current) => {
        const stored = current && result.workspaces.some((workspace) => workspace.id === current) ? current : result.workspaces[0]?.id ?? null;
        if (stored) localStorage.setItem(STORAGE_KEY, stored);
        return stored;
      });
      setStatus("ready");
      setError(null);
    } catch (caught) {
      setUser(null);
      setWorkspaces([]);
      setStatus("anonymous");
      if (!(caught instanceof ApiError) || caught.status !== 401) {
        setError(caught instanceof Error ? caught.message : "Could not load the session");
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<SessionValue>(() => ({
    status,
    user,
    workspaces,
    workspaceId,
    workspace: workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    error,
    refresh,
    selectWorkspace(id: string) {
      localStorage.setItem(STORAGE_KEY, id);
      setWorkspaceId(id);
    },
  }), [status, user, workspaces, workspaceId, error]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session is unavailable");
  return value;
}
