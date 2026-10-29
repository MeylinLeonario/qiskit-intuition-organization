"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";
import { useAuth, User } from "./auth-provider";

type Mode = "login" | "signup" | "forgot-password" | "reset-password";
const TITLES = {
  login: "Welcome back",
  signup: "Start your quantum notebook",
  "forgot-password": "Forgot your password?",
  "reset-password": "Choose a new password",
};
export default function AuthForm({ mode }: { mode: Mode }) {
  const { setUser } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const resetLinkRead = useRef(false);
  const newPassword = mode === "signup" || mode === "reset-password";
  useEffect(() => {
    if (mode === "reset-password" && !resetLinkRead.current) {
      resetLinkRead.current = true;
      const params = new URLSearchParams(window.location.hash.slice(1));
      const value = params.get("token") || "";
      setToken(value);
      if (value)
        window.history.replaceState(null, "", window.location.pathname);
      else setError("This reset link is incomplete. Request a new one.");
    }
  }, [mode]);
  return (
    <main className="auth-paper course-main">
      <Link href="/">← Back to the learning path</Link>
      <p className="eyebrow">Your Qiskit Intuition account</p>
      <h1>{TITLES[mode]}</h1>
      {mode === "forgot-password" && (
        <p>
          Enter your email and we’ll send you a link to reset your password.
        </p>
      )}
      {mode === "signup" && (
        <p>
          Create an account to personalize your profile. Your notebook will sync
          with your account across devices.
        </p>
      )}
      {message ? (
        <div className="auth-message" role="status">
          <p>{message}</p>
          <Link href="/login">Return to sign in</Link>
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (newPassword && password !== confirmation) {
              setError("Passwords do not match.");
              return;
            }
            setBusy(true);
            try {
              const body =
                mode === "signup"
                  ? { display_name: name, email, password }
                  : mode === "login"
                    ? { email, password }
                    : mode === "forgot-password"
                      ? { email }
                      : { token, new_password: password };
              const result = await api<{ user?: User; message?: string }>(
                `auth/${mode}`,
                body,
              );
              setPassword("");
              setConfirmation("");
              if (result.user) {
                setUser(result.user);
                router.replace("/profile");
              } else {
                setToken("");
                setMessage(result.message || "Done.");
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : "Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "signup" && (
            <label>
              Your name
              <input
                name="display_name"
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {mode !== "reset-password" && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode !== "forgot-password" && (
            <label>
              {newPassword ? "New password" : "Password"}
              <input
                name="password"
                type="password"
                autoComplete={newPassword ? "new-password" : "current-password"}
                required
                minLength={newPassword ? 12 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {newPassword && (
                <small>
                  Use 12–128 characters. A memorable passphrase works well.
                </small>
              )}
            </label>
          )}
          {newPassword && (
            <label>
              Confirm password
              <input
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || (mode === "reset-password" && !token)}
          >
            {busy
              ? "Please wait…"
              : {
                  login: "Sign in",
                  signup: "Create account",
                  "forgot-password": "Send reset link",
                  "reset-password": "Reset password",
                }[mode]}
          </button>
        </form>
      )}
      <nav className="auth-links" aria-label="Account options">
        {mode === "login" ? (
          <>
            <Link href="/signup">Create account</Link>
            <Link href="/forgot-password">Forgot password?</Link>
          </>
        ) : (
          <Link href="/login">Already have an account? Sign in</Link>
        )}
        {mode === "reset-password" && (
          <Link href="/forgot-password">Request a new reset link</Link>
        )}
      </nav>
    </main>
  );
}
