import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, client, type DocumentItem } from "../lib/api";
import { bytes, when } from "../lib/format";
import { useSession } from "../session";

const statuses = ["", "queued", "processing", "ready", "failed", "deleting"] as const;

export function LibraryPage() {
  const session = useSession();
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<DocumentItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!session.workspaceId) return;
    setLoading(true);
    try {
      const result = await client.documents({ workspaceId: session.workspaceId, q: query, status, limit: 20 });
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session.workspaceId, status]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session.workspaceId) return;
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) return;
    setNotice(null);
    try {
      const result = await client.upload(session.workspaceId, file);
      setNotice(`${result.document.filename} is queued.`);
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Upload failed");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Library</h1>
      <p className="mt-1 text-sm text-muted">{`${total} ${total === 1 ? "document" : "documents"} in this workspace.`}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => void upload(event)}>
        <label className="text-sm">
          PDF
          <input className="mt-1 block text-sm" name="file" type="file" accept="application/pdf,.pdf" required />
        </label>
        <button className="rounded-md bg-accent px-3 py-2 text-sm text-white" type="submit">Upload</button>
      </form>
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <label className="sr-only" htmlFor="search">Search filenames</label>
        <input id="search" className="rounded-md border border-line bg-white px-3 py-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filenames" />
        <label className="sr-only" htmlFor="status">Status</label>
        <select id="status" className="rounded-md border border-line bg-white px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          {statuses.map((item) => <option key={item || "all"} value={item}>{item || "All statuses"}</option>)}
        </select>
        <button className="rounded-md border border-line bg-white px-3 py-2 text-sm" type="submit">Search</button>
      </form>
      {notice ? <p className="mt-3 text-sm text-accent">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
      {loading ? <p className="mt-6 text-sm text-muted">Loading documents…</p> : null}
      {!loading && items.length === 0 ? <p className="mt-6 rounded-xl border border-dashed border-line p-6 text-sm text-muted">No documents match this view.</p> : null}
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-white">
        {items.map((document) => (
          <li key={document.id}>
            <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm" type="button" onClick={() => setSelected(document)}>
              <span>
                <span className="block font-medium">{document.filename}</span>
                <span className="text-muted">{`${bytes(document.size)} · ${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"} · ${when(document.createdAt)}`}</span>
              </span>
              <span className="rounded-full bg-paper px-2 py-1 text-xs">{document.status}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="fixed inset-0 z-20 flex justify-end bg-stone-900/30" role="presentation" onClick={() => setSelected(null)}>
          <aside className="h-full w-full max-w-md overflow-auto bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="doc-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="doc-title" className="text-lg font-semibold">{selected.filename}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Detail label="Status" value={selected.status} />
              <Detail label="Progress" value={`${selected.progress.stage} ${selected.progress.percent}%`} />
              <Detail label="Chunks" value={String(selected.chunkCount)} />
              <Detail label="OCR pages" value={String(selected.ocrPageCount)} />
              <Detail label="Version" value={`${selected.readyVersion ?? "—"} ready / ${selected.version} current`} />
            </dl>
            {selected.error ? <p className="mt-3 text-sm text-red-700">{selected.error}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="rounded-md bg-accent px-3 py-2 text-sm text-white" to={`/app/documents/${selected.id}`}>Open</Link>
              {selected.status === "failed" ? <Action label="Retry" onClick={() => run(client.retryDocument(selected.id), load, setError, setSelected)} /> : null}
              {selected.status === "ready" || selected.status === "failed" ? <Action label="Reprocess" onClick={() => run(client.reprocessDocument(selected.id), load, setError, setSelected)} /> : null}
              <Action label="Delete" onClick={async () => {
                if (!confirm(`Delete ${selected.filename}?`)) return;
                await run(client.deleteDocument(selected.id), load, setError, setSelected);
              }} />
              <button className="rounded-md border border-line px-3 py-2 text-sm" type="button" onClick={() => setSelected(null)}>Close</button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

async function run(action: Promise<unknown>, reload: () => Promise<void>, setError: (value: string | null) => void, close: (value: null) => void) {
  try {
    await action;
    close(null);
    await reload();
  } catch (caught) {
    setError(caught instanceof ApiError ? caught.message : "The action failed");
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted">{label}</dt><dd>{value}</dd></div>;
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="rounded-md border border-line px-3 py-2 text-sm" type="button" onClick={onClick}>{label}</button>;
}
