import { useEffect, useState } from "react";
import { ApiError, client } from "../lib/api";
import { bytes, when } from "../lib/format";
import { useSession } from "../session";

interface Ops {
  documents: Record<string, number>;
  storageBytes: number;
  failedJobs: number;
  usage: {
    embeddingCalls: number;
    generationCalls: number;
    rerankCalls: number;
    embeddingLatencyMsAvg: number | null;
    generationLatencyMsAvg: number | null;
    citationValidationFailures: number;
  };
  activity: Array<{ action: string; createdAt: string; targetId: string | null }>;
}

export function OperationsPage() {
  const session = useSession();
  const [ops, setOps] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session.workspaceId) return;
    setLoading(true);
    client.ops(session.workspaceId)
      .then(setOps)
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Operations data is unavailable"))
      .finally(() => setLoading(false));
  }, [session.workspaceId]);

  if (session.workspace?.role !== "admin") {
    return <p className="text-sm text-muted">Operations counts are available to workspace administrators.</p>;
  }
  if (loading) return <p className="text-sm text-muted">Loading stored counts…</p>;
  if (error) return <p className="text-sm text-red-700" role="alert">{error}</p>;
  if (!ops) return <p className="text-sm text-muted">No operations data.</p>;

  const max = Math.max(1, ...Object.values(ops.documents));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Operations</h1>
      <p className="mt-1 text-sm text-muted">Counts saved for this workspace.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card label="Stored documents" value={bytes(ops.storageBytes)} />
        <Card label="Failed processing" value={String(ops.failedJobs)} />
        <Card label="Rejected citations" value={String(ops.usage.citationValidationFailures)} />
      </div>
      <section className="mt-6 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Documents by status</h2>
        <ul className="mt-4 space-y-3">
          {Object.entries(ops.documents).map(([status, count]) => (
            <li key={status}>
              <div className="flex justify-between text-sm"><span>{status}</span><span>{count}</span></div>
              <div className="mt-1 h-2 rounded-full bg-paper">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${(count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card label="Indexing requests" value={String(ops.usage.embeddingCalls)} />
        <Card label="Answers and summaries" value={String(ops.usage.generationCalls)} />
        <Card label="Reordering requests" value={String(ops.usage.rerankCalls)} />
      </section>
      <p className="mt-3 text-sm text-muted">
        Average indexing time {formatLatency(ops.usage.embeddingLatencyMsAvg)}. Average answer time {formatLatency(ops.usage.generationLatencyMsAvg)}.
      </p>
      <section className="mt-6 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Recent activity</h2>
        {ops.activity.length === 0 ? <p className="mt-2 text-sm text-muted">No activity yet.</p> : null}
        <ul className="mt-2 space-y-2 text-sm">
          {ops.activity.map((event) => (
            <li key={`${event.action}-${event.createdAt}`}>{actionLabel(event.action)} · {when(event.createdAt)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-line bg-white p-4"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></article>;
}

function formatLatency(value: number | null): string {
  return value === null ? "has not been recorded" : `${Math.round(value)} ms`;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    "auth.register": "Account created",
    "auth.login": "Signed in",
    "auth.logout": "Signed out",
    "document.upload": "Document uploaded",
    "document.retry": "Processing retried",
    "document.reprocess": "Document queued again",
    "document.delete": "Document deleted",
    "conversation.delete": "Conversation deleted",
    "workspace.create": "Workspace created",
    "member.add": "Member added",
    "member.remove": "Member removed",
  };
  return labels[action] ?? action;
}
