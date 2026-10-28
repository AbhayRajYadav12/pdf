import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export function PdfViewer({ documentId, page }: { documentId: string; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(page);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCurrent(Math.max(1, page));
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjs.getDocument({ url: `/api/documents/${documentId}/file`, withCredentials: true });
    setLoading(true);
    setError(null);
    void loadingTask.promise
      .then(async (pdf) => {
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const safePage = Math.min(Math.max(current, 1), pdf.numPages);
        const pdfPage = await pdf.getPage(safePage);
        const viewport = pdfPage.getViewport({ scale: 1.3 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
        if (!cancelled) setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "The PDF could not be displayed");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [documentId, current]);

  return (
    <div className="flex min-h-[28rem] flex-col rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <p className="text-sm text-muted">Page {pageCount ? `${Math.min(current, pageCount)} of ${pageCount}` : "…"}</p>
        <div className="flex gap-2">
          <button className="rounded-md border border-line px-2 py-1 text-sm" type="button" onClick={() => setCurrent((value) => Math.max(1, value - 1))} disabled={current <= 1}>
            Previous
          </button>
          <button className="rounded-md border border-line px-2 py-1 text-sm" type="button" onClick={() => setCurrent((value) => (pageCount ? Math.min(pageCount, value + 1) : value + 1))} disabled={pageCount > 0 && current >= pageCount}>
            Next
          </button>
        </div>
      </div>
      <div className="relative overflow-auto bg-stone-100 p-4">
        {loading ? <p className="absolute left-4 top-4 text-sm text-muted">Loading PDF…</p> : null}
        {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
        <canvas ref={canvasRef} className="mx-auto max-w-full bg-white shadow-sm" aria-label="PDF page" />
      </div>
    </div>
  );
}
