import { Suspense } from "react";
import SessionClient from "./SessionClient";

export default function SessionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-500">
          Loading session…
        </div>
      }
    >
      <SessionClient />
    </Suspense>
  );
}
