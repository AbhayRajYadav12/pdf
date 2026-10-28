import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, client } from "../lib/api";
import { useSession } from "../session";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "register") {
        await client.register({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        });
      } else {
        await client.login({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
      }
      await session.refresh();
      navigate("/app");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Link className="mb-6 text-sm font-semibold" to="/">PDF-Summary AI</Link>
      <h1 className="text-2xl font-semibold">{mode === "register" ? "Create an account" : "Sign in"}</h1>
      <p className="mt-2 text-sm text-muted">
        {mode === "register" ? "Registration creates your first workspace and makes you its administrator." : "Use the email and password for your account."}
      </p>
      <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
        {mode === "register" ? <Field label="Name" name="name" autoComplete="name" /> : null}
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 10 : 1} />
        {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
        <button className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60" type="submit" disabled={pending}>
          {pending ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm">
        {mode === "register" ? <Link to="/login">Already have an account?</Link> : <Link to="/register">Need an account?</Link>}
      </p>
    </main>
  );
}

function Field(props: { label: string; name: string; type?: string; autoComplete: string; minLength?: number }) {
  return (
    <label className="text-sm">
      {props.label}
      <input
        className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        minLength={props.minLength}
        required
      />
    </label>
  );
}
