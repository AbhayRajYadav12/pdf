import { Link } from "react-router";

const steps = [
  ["Upload", "Add a PDF to a workspace. The library shows whether it is waiting, being prepared, ready, or failed."],
  ["Prepare", "You can ask questions after the document is ready. If preparation fails, retry it from the library."],
  ["Ask", "Answers name the document and page they came from. If the selected documents do not support an answer, the app says so."],
];

const features = [
  ["Cited answers", "Open the cited page in the PDF. The source excerpt is shown apart from the answer."],
  ["Workspace access", "Only members of a workspace can open its documents, summaries, and conversations."],
  ["Summaries", "Save a summary of a ready document and jump to the page behind each claim."],
  ["A library you can manage", "Search by filename, filter by status, retry a failure, or delete a document you are allowed to remove."],
];

const controls = [
  "You sign in with your email and password. The session is stored in a cookie that page scripts cannot read.",
  "Uploads, questions, and downloads are limited to people who belong to that workspace.",
  "Questions use the documents you select. The app declines when those documents do not support an answer.",
  "Administrators can add members and set how long documents are kept. A retention of zero keeps them until someone deletes them.",
];

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
            Upload documents for a workspace, wait until they are ready, then ask questions that point back to the source page.
          </p>
          <div className="mt-6 flex gap-3">
            <Link className="rounded-md bg-accent px-4 py-2 text-white" to="/register">Start a workspace</Link>
            <a className="rounded-md border border-line bg-white px-4 py-2" href="#access">Who can see a document</a>
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
            <p className="text-sm text-accent">{String(index + 1).padStart(2, "0")}</p>
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
      <section id="access" className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <h2 className="text-2xl font-semibold">Who can see a document</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {controls.map((item) => (
            <li key={item} className="rounded-xl border border-line bg-white p-4 text-sm leading-6">{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
