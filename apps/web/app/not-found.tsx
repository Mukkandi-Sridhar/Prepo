import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: "5rem" }}>
      <h3>Nothing here</h3>
      <p>
        That page doesn&apos;t exist, or it isn&apos;t yours. <Link href="/">Back to your projects</Link>
      </p>
    </div>
  );
}
