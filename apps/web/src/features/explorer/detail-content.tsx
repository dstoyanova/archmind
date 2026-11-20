"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function LoadContent<T>({
  load,
  children
}: {
  load: (signal: AbortSignal) => Promise<T>;
  children: (value: T) => ReactNode;
}) {
  const loadPage = useCallback(
    (_cursor: string | null, signal: AbortSignal) => load(signal),
    [load]
  );
  return <LoadPage load={loadPage} render={children} />;
}

export function LoadPage<T>({
  load,
  render,
  nextCursor
}: {
  load: (cursor: string | null, signal: AbortSignal) => Promise<T>;
  render: (value: T) => ReactNode;
  nextCursor?: (value: T) => string | null;
}) {
  const [pages, setPages] = useState<T[]>([]);
  const [request, setRequest] = useState<{ cursor: string | null }>({ cursor: null });
  const [completed, setCompleted] = useState<typeof request>();
  const [error, setError] = useState<string>();
  const pending = completed !== request;

  useEffect(() => {
    const controller = new AbortController();
    void load(request.cursor, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setPages((previous) => (request.cursor === null ? [value] : [...previous, value]));
        setError(undefined);
        setCompleted(request);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "The request failed.");
        setCompleted(request);
      }
    );
    return () => controller.abort();
  }, [load, request]);

  const last = pages.at(-1);
  const cursor = last === undefined ? null : nextCursor?.(last);
  return (
    <div className="space-y-2" aria-busy={pending}>
      {pages.map((page, index) => (
        <div key={index}>{render(page)}</div>
      ))}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading...
        </p>
      )}
      {!pending && error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button variant="outline" size="sm" onClick={() => setRequest({ ...request })}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!pending && !error && cursor && (
        <Button variant="outline" size="sm" onClick={() => setRequest({ cursor })}>
          Load more
        </Button>
      )}
    </div>
  );
}
