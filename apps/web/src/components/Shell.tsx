import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { client } from "../lib/api";
import { useSession } from "../session";

const links = [
  ["Dashboard", "/app"],
  ["Library", "/app/library"],
  ["Chat", "/app/chat"],
  ["Operations", "/app/operations"],
  ["Settings", "/app/settings"],
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function logout() {
    await client.logout();
    await session.refresh();
    navigate("/");
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className={`${open ? "block" : "hidden"} border-b border-line bg-white md:block md:border-b-0 md:border-r`}>
        <div className="flex items-center justify-between px-4 py-4">
          <p className="text-sm font-semibold tracking-tight">PDF-Summary AI</p>
          <button className="md:hidden" type="button" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <label className="block px-4 text-xs font-medium text-muted" htmlFor="workspace">
          Workspace
        </label>
        <select
          id="workspace"
          className="mx-4 mt-1 w-[calc(100%-2rem)] rounded-md border border-line bg-paper px-2 py-2 text-sm"
          value={session.workspaceId ?? ""}
          onChange={(event) => session.selectWorkspace(event.target.value)}
        >
          {session.workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.role})
            </option>
          ))}
        </select>
        <nav className="mt-4 flex flex-col gap-1 px-2 pb-4" aria-label="Application">
          {links.map(([label, href]) => (
            <NavLink
              key={href}
              to={href}
              end={href === "/app"}
              className={({ isActive }) => `rounded-md px-3 py-2 text-sm ${isActive ? "bg-accent-soft text-accent" : "text-ink hover:bg-paper"}`}
              onClick={() => setOpen(false)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <button className="md:hidden" type="button" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <p className="text-sm text-muted">{session.user?.name}</p>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm" type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
