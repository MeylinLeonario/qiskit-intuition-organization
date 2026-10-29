"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";
import { AccountMenu, useAuth, User } from "@/components/auth-provider";

export default function Profile() {
  const { user, loading, error: serviceError, setUser } = useAuth();
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [avatarVersion, setAvatarVersion] = useState(0);
  async function update(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api<{ user: User }>(path, body);
      setUser(data.user);
      setNotice(message);
      setAvatarVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="auth-paper course-main" role="status">
        Opening your profile…
      </main>
    );
  if (!user)
    return (
      <main className="auth-paper course-main">
        <Link href="/">← Learning path</Link>
        <h1>Your profile</h1>
        <p>{serviceError || "Sign in to manage your profile."}</p>
        <Link href="/login">Sign in</Link>
        <p>
          <Link href="/signup">Create an account</Link>
        </p>
      </main>
    );
  return (
    <main className="auth-paper course-main">
      <Link href="/">← Back to the learning path</Link>
      <AccountMenu />
      <p className="eyebrow">Your account</p>
      <h1>My profile</h1>
      <p>{user.email}</p>
      {notice && (
        <p role="status" className="auth-message">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <section className="profile-section">
        <h2>Profile picture</h2>
        {user.has_avatar ? (
          <img
            className="profile-avatar"
            src={`/api/auth/avatar?v=${avatarVersion}`}
            alt={`${user.display_name}'s profile`}
          />
        ) : (
          <div
            className="profile-avatar avatar-placeholder"
            aria-label="No profile picture"
          >
            {user.display_name.charAt(0).toUpperCase()}
          </div>
        )}
        <label>
          Choose a picture
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                setError("Choose a picture smaller than 2 MB.");
                return;
              }
              try {
                const image = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                });
                await update(
                  "auth/avatar",
                  { image },
                  "Profile picture saved.",
                );
              } catch {
                setError("Could not read this picture. Please choose another.");
              }
            }}
          />
          <small>
            JPEG, PNG or WebP. Maximum 2 MB. Stored with your account.
          </small>
        </label>
        {user.has_avatar && (
          <button
            disabled={busy}
            onClick={() =>
              update("auth/avatar", { image: null }, "Profile picture removed.")
            }
          >
            Remove picture
          </button>
        )}
      </section>
      <section className="profile-section">
        <h2>About you</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            update(
              "auth/profile",
              { display_name: name ?? user.display_name },
              "Profile saved.",
            );
          }}
        >
          <label>
            Display name
            <input
              name="display_name"
              autoComplete="name"
              required
              maxLength={80}
              value={name ?? user.display_name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Save profile
          </button>
        </form>
      </section>
      <section className="profile-section">
        <h2>Change password</h2>
        <p>You’ll be signed out on all devices after changing your password.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setNotice("");
            if (password !== confirmation) {
              setError("Passwords do not match.");
              return;
            }
            setBusy(true);
            try {
              await api("auth/change-password", {
                current_password: current,
                new_password: password,
              });
              setCurrent("");
              setPassword("");
              setConfirmation("");
              setUser(null);
              router.replace("/login");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not change your password.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small>Use 12–128 characters.</small>
          </label>
          <label>
            Confirm new password
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
          <button className="primary" disabled={busy}>
            Change password
          </button>
        </form>
        <Link href="/forgot-password">Forgot your current password?</Link>
      </section>
    </main>
  );
}
