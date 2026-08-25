"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSetToDeck, regenerate } from "@/app/actions";

export function RegenerateButton({
  projectId,
  label,
  ghost,
}: {
  projectId: string;
  label: string;
  ghost?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        className={ghost ? "ghost small" : ""}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await regenerate(projectId);
            if (result.error) setError(result.error);
            else if (result.ok) router.push(`/projects/${projectId}?job=${result.ok}`);
          })
        }
      >
        {pending ? "Starting…" : label}
      </button>
      {error && (
        <div className="notice warn" style={{ marginTop: ".7rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function AddToDeckButton({ setId }: { setId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <button
      className="ghost small"
      disabled={pending || Boolean(message)}
      onClick={() =>
        startTransition(async () => {
          const result = await addSetToDeck(setId);
          setMessage(result.ok ?? result.error ?? null);
        })
      }
      title="Add every question to your spaced-repetition deck"
    >
      {message ?? (pending ? "Adding…" : "Add to deck")}
    </button>
  );
}
