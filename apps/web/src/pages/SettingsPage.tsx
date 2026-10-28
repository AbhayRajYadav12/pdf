import { useEffect, useState, type FormEvent } from "react";
import { ApiError, client } from "../lib/api";
import { useSession } from "../session";

export function SettingsPage() {
  const session = useSession();
  const [name, setName] = useState(session.user?.name ?? "");
  const [workspaceName, setWorkspaceName] = useState(session.workspace?.name ?? "");
  const [retention, setRetention] = useState(session.workspace?.retentionDays ?? 0);
  const [members, setMembers] = useState<Array<{ userId: string; role: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(session.user?.name ?? "");
    setWorkspaceName(session.workspace?.name ?? "");
    setRetention(session.workspace?.retentionDays ?? 0);
    if (!session.workspaceId) return;
    client.workspace(session.workspaceId)
      .then((result) => setMembers(result.members))
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load members"));
  }, [session.workspaceId, session.user?.name, session.workspace?.name, session.workspace?.retentionDays]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError(null);
    await client.updateProfile(name);
    await session.refresh();
    setMessage("Profile saved.");
  }

  async function saveWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!session.workspaceId) return;
    setError(null);
    try {
      await client.updateWorkspace(session.workspaceId, { name: workspaceName, retentionDays: retention });
      await session.refresh();
      setMessage("Workspace saved. A retention of 0 keeps documents until someone deletes them.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Workspace update failed");
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session.workspaceId) return;
    const data = new FormData(event.currentTarget);
    try {
      await client.addMember(session.workspaceId, {
        email: String(data.get("email") ?? ""),
        role: String(data.get("role") ?? "member") as "admin" | "member",
      });
      event.currentTarget.reset();
      const result = await client.workspace(session.workspaceId);
      setMembers(result.members);
      setMessage("Member added.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add the member");
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const created = await client.createWorkspace(String(data.get("workspace") ?? ""));
    await session.refresh();
    session.selectWorkspace(created.workspace.id);
    setMessage(`Created ${created.workspace.name}.`);
  }

  const admin = session.workspace?.role === "admin";

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {message ? <p className="text-sm text-accent">{message}</p> : null}
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <form className="rounded-xl border border-line bg-white p-4" onSubmit={(event) => void saveProfile(event)}>
        <h2 className="font-semibold">Profile</h2>
        <label className="mt-3 block text-sm">Name
          <input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <p className="mt-2 text-sm text-muted">{session.user?.email}</p>
        <button className="mt-3 rounded-md bg-accent px-3 py-2 text-sm text-white" type="submit">Save profile</button>
      </form>
      <form className="rounded-xl border border-line bg-white p-4" onSubmit={(event) => void saveWorkspace(event)}>
        <h2 className="font-semibold">Workspace</h2>
        <label className="mt-3 block text-sm">Name
          <input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} disabled={!admin} required />
        </label>
        <label className="mt-3 block text-sm">Retention days
          <input className="mt-1 w-full rounded-md border border-line px-3 py-2" type="number" min={0} max={3650} value={retention} onChange={(event) => setRetention(Number(event.target.value))} disabled={!admin} />
        </label>
        <button className="mt-3 rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-60" type="submit" disabled={!admin}>Save workspace</button>
      </form>
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Members</h2>
        {members.length === 0 ? <p className="mt-2 text-sm text-muted">No members loaded.</p> : null}
        <ul className="mt-3 space-y-2 text-sm">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-3">
              <span>{member.userId} · {member.role}</span>
              {admin ? <button className="text-red-700" type="button" onClick={() => {
                if (!session.workspaceId) return;
                void client.removeMember(session.workspaceId, member.userId).then(() => setMembers((current) => current.filter((item) => item.userId !== member.userId))).catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not remove the member"));
              }}>Remove</button> : null}
            </li>
          ))}
        </ul>
        {admin ? (
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => void addMember(event)}>
            <input className="rounded-md border border-line px-3 py-2 text-sm" name="email" type="email" placeholder="Existing account email" required />
            <select className="rounded-md border border-line px-2 py-2 text-sm" name="role" defaultValue="member">
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button className="rounded-md border border-line px-3 py-2 text-sm" type="submit">Add</button>
          </form>
        ) : <p className="mt-3 text-sm text-muted">Members can view this list. Administrators can change it.</p>}
      </section>
      <form className="rounded-xl border border-line bg-white p-4" onSubmit={(event) => void createWorkspace(event)}>
        <h2 className="font-semibold">New workspace</h2>
        <input className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" name="workspace" placeholder="Workspace name" required />
        <button className="mt-3 rounded-md border border-line px-3 py-2 text-sm" type="submit">Create</button>
      </form>
    </div>
  );
}
