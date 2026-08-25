"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Progress {
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  note?: string;
  error?: string;
  spentCents?: number;
}

export function JobProgress({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>({ state: "queued", stage: null, progress: 0 });

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as Progress;
      setProgress(data);

      if (data.state === "done" || data.state === "failed") {
        source.close();
        // Pull the finished pack in without a full page reload.
        router.refresh();
      }
    };

    // A dropped connection is not an error worth showing — EventSource
    // reconnects on its own, and the route replays current state on connect.
    source.onerror = () => {};

    return () => source.close();
  }, [jobId, router]);

  if (progress.state === "done") return null;

  const percent = Math.round(progress.progress * 100);

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <div className="card-pad">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: ".7rem" }}>
          <strong style={{ fontFamily: "var(--f-display)" }}>
            {progress.state === "failed" ? "Analysis failed" : (progress.stage ?? "Queued")}
          </strong>
          <span className="mono muted">
            {progress.state === "failed" ? "—" : `${percent}%`}
            {progress.spentCents !== undefined && progress.spentCents > 0 && (
              <> · {progress.spentCents < 1 ? `${progress.spentCents.toFixed(2)}¢` : `$${(progress.spentCents / 100).toFixed(2)}`}</>
            )}
          </span>
        </div>

        <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${progress.state === "failed" ? 100 : percent}%`, background: progress.state === "failed" ? "var(--signal)" : undefined }} />
        </div>

        {progress.note && <p className="small muted" style={{ margin: ".6rem 0 0" }}>{progress.note}</p>}

        {progress.error && (
          <div className="notice warn" style={{ marginTop: ".9rem" }}>
            {progress.error}
          </div>
        )}
      </div>
    </section>
  );
}
