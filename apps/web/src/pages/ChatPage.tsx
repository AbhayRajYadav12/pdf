import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, client, type ChatMessage, type Citation, type Conversation, type DocumentItem } from "../lib/api";
import { useSession } from "../session";

interface LiveMessage extends ChatMessage {
  live?: boolean;
}

export function ChatPage() {
  const session = useSession();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!session.workspaceId) return;
    client.conversations(session.workspaceId).then((result) => setConversations(result.conversations)).catch(() => setConversations([]));
    client.documents({ workspaceId: session.workspaceId, status: "ready", limit: 50 }).then((result) => setDocuments(result.items)).catch(() => setDocuments([]));
  }, [session.workspaceId, conversationId]);

  useEffect(() => {
    sourceRef.current?.close();
    if (!conversationId) {
      setMessages([]);
      setTitle("");
      return;
    }
    setLoading(true);
    client.conversation(conversationId)
      .then((result) => {
        setMessages(result.messages);
        setTitle(result.conversation.title);
        setSelectedDocs(result.conversation.documentIds);
        setError(null);
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Conversation not found"))
      .finally(() => setLoading(false));
    return () => sourceRef.current?.close();
  }, [conversationId]);

  function openStream(path: string, messageId: string, question: string, nextConversationId: string) {
    sourceRef.current?.close();
    const source = new EventSource(path, { withCredentials: true });
    sourceRef.current = source;
    setStreamingId(messageId);
    setMessages((current) => [
      ...current.filter((message) => message.id !== messageId && message.content !== question),
      { id: `user-${messageId}`, role: "user", content: question, status: "completed", model: null, abstained: false, conflict: false, error: null, createdAt: new Date().toISOString(), citations: [] },
      { id: messageId, role: "assistant", content: "", status: "streaming", model: null, abstained: false, conflict: false, error: null, createdAt: new Date().toISOString(), citations: [], live: true },
    ]);
    source.addEventListener("token", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { text?: string };
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: message.content + (data.text ?? "") } : message));
    });
    source.addEventListener("completed", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { content?: string; citations?: Citation[]; abstained?: boolean; conflict?: boolean };
      setMessages((current) => current.map((message) => message.id === messageId ? {
        ...message,
        content: data.content ?? message.content,
        citations: data.citations ?? [],
        abstained: Boolean(data.abstained),
        conflict: Boolean(data.conflict),
        status: data.abstained ? "abstained" : "completed",
        live: false,
      } : message));
      setStreamingId(null);
      source.close();
      if (session.workspaceId) client.conversations(session.workspaceId).then((result) => setConversations(result.conversations)).catch(() => undefined);
      if (!conversationId) navigate(`/app/chat/${nextConversationId}`);
    });
    source.addEventListener("error", (event) => {
      if (!(event instanceof MessageEvent) || !event.data) return;
      const data = JSON.parse(event.data) as { message?: string };
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, status: "failed", error: data.message ?? "Generation failed", live: false } : message));
      setError(data.message ?? "Generation failed");
      setStreamingId(null);
      source.close();
    });
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session.workspaceId) return;
    const form = event.currentTarget;
    const question = new FormData(form).get("question");
    if (typeof question !== "string" || !question.trim()) return;
    setError(null);
    try {
      const result = await client.ask({
        workspaceId: session.workspaceId,
        conversationId,
        documentIds: selectedDocs,
        question: question.trim(),
      });
      form.reset();
      openStream(result.streamPath, result.messageId, question.trim(), result.conversationId);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The question could not be sent");
    }
  }

  async function cancel() {
    if (!conversationId || !streamingId) return;
    await client.cancel(conversationId, streamingId);
    sourceRef.current?.close();
    setStreamingId(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside>
        <h1 className="text-lg font-semibold">Chat</h1>
        <Link className="mt-3 block text-sm text-accent" to="/app/chat">New conversation</Link>
        {conversations.length === 0 ? <p className="mt-3 text-sm text-muted">No conversations yet.</p> : null}
        <ul className="mt-2 space-y-1">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link className={`block truncate rounded-md px-2 py-2 text-sm ${conversation.id === conversationId ? "bg-accent-soft text-accent" : ""}`} to={`/app/chat/${conversation.id}`}>
                {conversation.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-[32rem] flex-col rounded-xl border border-line bg-white">
        {conversationId ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => {
              event.preventDefault();
              const next = new FormData(event.currentTarget).get("title");
              if (typeof next === "string" && next.trim()) {
                void client.renameConversation(conversationId, next.trim()).then((result) => setTitle(result.conversation.title));
              }
            }}>
              <label className="sr-only" htmlFor="title">Conversation title</label>
              <input id="title" name="title" className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm" defaultValue={title} key={title} />
              <button className="text-sm" type="submit">Rename</button>
            </form>
            <button className="text-sm text-red-700" type="button" onClick={() => {
              void client.deleteConversation(conversationId).then(() => navigate("/app/chat"));
            }}>Delete</button>
          </div>
        ) : null}
        <div className="border-b border-line p-3">
          <p className="text-xs font-medium text-muted">Documents in scope</p>
          {documents.length === 0 ? <p className="mt-2 text-sm text-muted">No ready documents. Upload one in the library first.</p> : null}
          <ul className="mt-2 flex flex-wrap gap-2">
            {documents.map((document) => (
              <li key={document.id}>
                <label className="flex items-center gap-2 rounded-full border border-line px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedDocs.includes(document.id)}
                    onChange={(event) => setSelectedDocs((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))}
                  />
                  {document.filename}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4" aria-live="polite">
          {loading ? <p className="text-sm text-muted">Loading conversation…</p> : null}
          {!loading && messages.length === 0 ? <p className="text-sm text-muted">Ask a question about the selected documents. If none are selected, ready documents in the workspace are used.</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={message.role === "user" ? "ml-8 rounded-xl bg-paper p-3" : "mr-8"}>
              <p className="text-xs font-medium text-muted">{message.role === "user" ? "You" : "Answer"}</p>
              {message.role === "assistant" ? <div className="prose-sm mt-1 text-sm leading-6"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.live ? "…" : "")}</ReactMarkdown></div> : <p className="mt-1 text-sm">{message.content}</p>}
              {message.abstained ? <p className="mt-2 text-xs text-muted">This answer abstained because the retrieved evidence was not sufficient.</p> : null}
              {message.conflict ? <p className="mt-2 text-xs text-amber-800">Retrieved passages disagree across document versions. Both citations are shown.</p> : null}
              {message.error ? <p className="mt-2 text-xs text-red-700">{message.error}</p> : null}
              {message.role === "assistant" && message.content ? <button className="mt-2 text-xs" type="button" onClick={() => void navigator.clipboard.writeText(message.content)}>Copy</button> : null}
              {message.citations.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {message.citations.map((citation) => (
                    <li key={`${citation.evidenceId}-${citation.chunkId}`} className="rounded-lg border border-line bg-paper p-2 text-xs">
                      <Link to={`/app/documents/${citation.documentId}?page=${citation.pageStart}`}>
                        {citation.evidenceId} · {citation.documentName} · page {citation.pageStart}
                      </Link>
                      <p className="mt-1 text-muted">{citation.excerpt}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
        {error ? <p className="px-4 text-sm text-red-700" role="alert">{error}</p> : null}
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(event) => void ask(event)}>
          <label className="sr-only" htmlFor="question">Question</label>
          <input id="question" name="question" className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm" placeholder="Ask about the selected PDFs" disabled={Boolean(streamingId)} />
          {streamingId ? <button className="rounded-md border border-line px-3 py-2 text-sm" type="button" onClick={() => void cancel()}>Cancel</button> : <button className="rounded-md bg-accent px-3 py-2 text-sm text-white" type="submit">Ask</button>}
        </form>
      </section>
    </div>
  );
}
