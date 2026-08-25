"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="empty" style={{ marginTop: "5rem" }}>
      <h3>Something broke</h3>
      <p style={{ maxWidth: "40ch", margin: "0 auto 1.25rem" }}>
        {error.message || "An unexpected error occurred."}
      </p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
