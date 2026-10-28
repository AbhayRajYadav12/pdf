import { Link } from "react-router";

const steps = [
  ["Upload", "A PDF stays in your workspace file store. MongoDB keeps the record, not the binary."],
  ["Index", "Pages are extracted, chunked, and embedded. The document is ready only after the vector count matches."],
  ["Ask", "Answers stream from retrieved passages. Citations use stored page numbers, and weak evidence is declined."],
];

const features = [
  ["Grounded answers", "The model sees retrieved passages as untrusted data and must cite evidence ids that were actually retrieved."],
  ["Hybrid search", "Dense and sparse retrieval are fused with reciprocal rank fusion. An optional reranker can reorder that set."],
  ["Workspace isolation", "Search filters include the workspace and the document versions you are allowed to use."],
  ["Readable status", "Queued, processing, ready, and failed documents stay visible, with retry for failed jobs."],
];

const controls = [
  "Email and password sessions use an httpOnly cookie. Passwords are handled by the auth library.",
  "Uploads, chat, and auth routes are rate limited. Helmet and a strict CORS origin list are enabled.",
  "Cookie-authenticated changes in production require an allowed Origin header.",
  "Downloads and retrieval check workspace membership before any file or vector is returned.",
  "Logs omit passwords, session tokens, API keys, and full PDF text.",
];

const stack = ["React", "Vite", "Express", "MongoDB", "Redis", "BullMQ", "Qdrant", "Gemini", "unpdf", "Tesseract.js"];

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <p className="font-semibold">PDF-Summary AI</p>
        <nav className="flex gap-2 text-sm">
          <Link className="rounded-md px-3 py-2" to="/login">Sign in</Link>
          <Link className="rounded-md bg-accent px-3 py-2 text-white" to="/register">Create account</Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[1.3fr_0.7fr] md:items-center">
        <div>
          <p className="text-sm font-medium text-accent">Workspace document assistant</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Ask a PDF a question and see the page it came from.</h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Upload documents for a workspace, wait until indexing finishes, then chat with citations that point back to the source page.
          </p>
          <div className="mt-6 flex gap-3">
            <Link className="rounded-md bg-accent px-4 py-2 text-white" to="/register">Start a workspace</Link>
            <a className="rounded-md border border-line bg-white px-4 py-2" href="#security">Security controls</a>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Example answer</p>
          <p className="mt-3 text-sm leading-6">The renewal date in the selected agreement is 12 March 2026.</p>
          <p className="mt-4 rounded-lg bg-paper p-3 text-sm text-muted">Source excerpt · contract.pdf · page 1</p>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 md:grid-cols-3">
        {steps.map(([title, body], index) => (
          <article key={title} className="rounded-xl border border-line bg-white p-5">
            <p className="text-sm text-accent">0{index + 1}</p>
            <h2 className="mt-2 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </article>
        ))}
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 md:grid-cols-2">
        {features.map(([title, body]) => (
          <article key={title} className="rounded-xl border border-line bg-white p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </article>
        ))}
      </section>
      <section id="security" className="mx-auto max-w-6xl px-4 py-8">
        <h2 className="text-2xl font-semibold">Security that this build actually implements</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {controls.map((item) => (
            <li key={item} className="rounded-xl border border-line bg-white p-4 text-sm leading-6">{item}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">This page does not claim certifications, customers, or measured accuracy.</p>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <h2 className="text-2xl font-semibold">Technology</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {stack.map((item) => (
            <li key={item} className="rounded-full border border-line bg-white px-3 py-1 text-sm">{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
