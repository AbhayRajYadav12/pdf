import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, client, type Conversation, type DocumentItem } from "../lib/api";
import { when } from "../lib/format";
import { useSession } from "../session";

export function DashboardPage() {
  const session = useSession();
  const [counts, setCounts] = useState<Record<DocumentItem["status"], number> | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session.workspaceId) return;
    const workspaceId = session.workspaceId;
    setLoading(true);
    Promise.all([
      client.workspace(workspaceId),
      client.documents({ workspaceId, limit: 5 }),
      client.conversations(workspaceId),
    ])
      .then(([workspace, docs, chats]) => {
        setCounts(workspace.workspace.counts);
        setDocuments(docs.items);
        setConversations(chats.conversations.slice(0, 5));
        setError(null);
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load the dashboard"))
      .finally(() => setLoading(false));
  }, [session.workspaceId]);

  const total = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">{session.workspace?.name ?? "Workspace"}</p>
        </div>
        <Link className="rounded-md bg-accent px-3 py-2 text-sm text-white" to="/app/library">Upload a PDF</Link>
      </div>
      {loading ? <p className="mt-6 text-sm text-muted">Loading workspace counts…</p> : null}
      {error ? <p className="mt-6 text-sm text-red-700" role="alert">{error}</p> : null}
      {counts ? (
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total documents" value={total} />
          <Stat label="Ready" value={counts.ready} />
          <Stat label="Processing" value={counts.queued + counts.processing} />
          <Stat label="Failed" value={counts.failed} />
        </section>
      ) : null}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Recent documents" empty={documents.length === 0 ? "No documents in this workspace yet." : null}>
          {documents.map((document) => (
            <Link key={document.id} className="flex items-center justify-between gap-3 border-t border-line py-3 text-sm first:border-t-0" to={`/app/documents/${document.id}`}>
              <span className="truncate">{document.filename}</span>
              <span className="text-muted">{document.status}</span>
            </Link>
          ))}
        </Panel>
        <Panel title="Recent conversations" empty={conversations.length === 0 ? "No conversations yet." : null}>
          {conversations.map((conversation) => (
            <Link key={conversation.id} className="flex items-center justify-between gap-3 border-t border-line py-3 text-sm first:border-t-0" to={`/app/chat/${conversation.id}`}>
              <span className="truncate">{conversation.title}</span>
              <span className="text-muted">{when(conversation.updatedAt)}</span>
            </Link>
          ))}
        </Panel>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function Panel({ title, empty, children }: { title: string; empty: string | null; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      {empty ? <p className="mt-3 text-sm text-muted">{empty}</p> : <div className="mt-2">{children}</div>}
    </section>
  );
}
