import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { PdfViewer } from "../components/PdfViewer";
import { ApiError, client, type DocumentItem, type SummaryRecord } from "../lib/api";

const styles = ["executive", "section", "findings", "dates", "actions", "questions"] as const;
const lengths = ["short", "medium", "long"] as const;

export function DocumentPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? "1") || 1;
  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [summary, setSummary] = useState<SummaryRecord | null>(null);
  const [style, setStyle] = useState<(typeof styles)[number]>("executive");
  const [length, setLength] = useState<(typeof lengths)[number]>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    client.document(id)
      .then((result) => setDocument(result.document))
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Document not found"));
  }, [id]);

  useEffect(() => {
    if (!document?.readyVersion) return;
    client.summary(id, style, length)
      .then((result) => setSummary(result.summary))
      .catch(() => setSummary(null));
  }, [document?.readyVersion, id, style, length]);

  async function summarize() {
    setBusy(true);
    setError(null);
    try {
      const result = await client.summarize(id, style, length);
      setSummary(result.summary);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Summary failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !document) return <p className="text-sm text-red-700" role="alert">{error}</p>;
  if (!document) return <p className="text-sm text-muted">Loading document…</p>;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        <p className="text-sm"><Link to="/app/library">Library</Link></p>
        <h1 className="mt-2 text-2xl font-semibold">{document.filename}</h1>
        <p className="mt-1 text-sm text-muted">{`${document.status} · ${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"}`}</p>
        {document.status === "ready" ? <PdfViewer documentId={document.id} page={page} /> : <p className="mt-4 rounded-xl border border-dashed border-line p-6 text-sm text-muted">The viewer opens after the document is ready.</p>}
      </div>
      <aside className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Summary</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="text-sm">Style
            <select className="mt-1 block rounded-md border border-line px-2 py-1" value={style} onChange={(event) => setStyle(event.target.value as typeof style)}>
              {styles.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-sm">Length
            <select className="mt-1 block rounded-md border border-line px-2 py-1" value={length} onChange={(event) => setLength(event.target.value as typeof length)}>
              {lengths.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <button className="mt-3 rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-60" type="button" disabled={busy || document.status !== "ready" || summary !== null} onClick={() => void summarize()}>
          {busy ? "Summarizing…" : summary ? "Saved for this style" : "Create summary"}
        </button>
        {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
        {summary ? (
          <div className="mt-4">
            <p className="whitespace-pre-wrap text-sm leading-6">{summary.content}</p>
            <h3 className="mt-4 text-sm font-semibold">Claims</h3>
            <ul className="mt-2 space-y-2">
              {summary.claims.map((claim) => (
                <li key={`${claim.chunkId}-${claim.pageStart}`}>
                  <button className="text-left text-sm text-accent" type="button" onClick={() => setParams({ page: String(claim.pageStart) })}>
                    Page {claim.pageStart}: {claim.text}
                  </button>
                  <p className="mt-1 rounded-md bg-paper p-2 text-xs text-muted">{claim.excerpt}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="mt-4 text-sm text-muted">No saved summary for this style yet.</p>}
      </aside>
    </div>
  );
}
