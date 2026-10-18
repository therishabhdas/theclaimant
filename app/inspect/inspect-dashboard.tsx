"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InspectReport } from "../../lib/inspect/diagnostics";

function statusLabel(status: InspectReport["supabase"]["status"]) {
  if (status === "connected") return "Connected";
  if (status === "not_configured") return "Not configured";
  return "Needs attention";
}

export default function InspectDashboard() {
  const [report, setReport] = useState<InspectReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/inspect", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Diagnostic request failed (HTTP ${response.status}).`);
      }

      setReport(await response.json() as InspectReport);
    } catch (caughtError) {
      setError(caughtError instanceof Error
        ? caughtError.message
        : "Unable to load diagnostics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const availableTables = useMemo(
    () => report?.tables.filter((table) => table.status === "available").length ?? 0,
    [report],
  );
  const groups = useMemo(
    () => [...new Set(report?.tables.map((table) => table.group) ?? [])],
    [report],
  );

  return (
    <>
      <header className="inspect-header">
        <Link className="inspect-back" href="/">← The Claimant</Link>
        <p className="eyebrow"><span />DEVELOPER DIAGNOSTICS</p>
        <h1>System <em>check.</em></h1>
        <p className="inspect-intro">
          Read-only health checks for the database and model configuration.
          No character records, private facts, or secret values are returned.
        </p>
        <div className="inspect-toolbar">
          <span>
            {report
              ? `Last checked ${new Date(report.checkedAt).toLocaleString()}`
              : loading ? "Checking services…" : "No check completed"}
          </span>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Checking…" : "Refresh checks"}
          </button>
        </div>
      </header>

      {error && <p className="inspect-error" role="alert">{error}</p>}

      <section className="inspect-services" aria-label="Service status">
        <article className="inspect-service-card">
          <div className="inspect-card-heading">
            <span>SUPABASE</span>
            {report && (
              <strong className={`inspect-status inspect-status-${report.supabase.status}`}>
                {statusLabel(report.supabase.status)}
              </strong>
            )}
          </div>
          <h2>Database</h2>
          <p>{report?.supabase.message ?? "Checking the server-side database connection…"}</p>
          <dl>
            <div><dt>Project host</dt><dd>{report?.supabase.projectHost ?? "Not shown / unavailable"}</dd></div>
            <div><dt>Tables reachable</dt><dd>{report ? `${availableTables} / ${report.tables.length}` : "Checking…"}</dd></div>
            <div><dt>Credential</dt><dd>Server-only service key; value never displayed</dd></div>
          </dl>
        </article>

        <article className="inspect-service-card">
          <div className="inspect-card-heading">
            <span>GROQ</span>
            {report && (
              <strong className={`inspect-status inspect-status-${report.groq.status}`}>
                {statusLabel(report.groq.status)}
              </strong>
            )}
          </div>
          <h2>Language model</h2>
          <p>{report?.groq.message ?? "Checking Groq API and model availability…"}</p>
          <dl>
            <div><dt>Configured model</dt><dd>{report?.groq.model ?? "openai/gpt-oss-120b"}</dd></div>
            <div><dt>Verification</dt><dd>{report?.groq.verification ?? "Checking…"}</dd></div>
            <div><dt>API key</dt><dd>Server-side only; value never displayed</dd></div>
          </dl>
        </article>
      </section>

      <section className="inspect-database" aria-labelledby="inspect-database-heading">
        <div className="inspect-section-heading">
          <div>
            <p className="eyebrow"><span />DATABASE CATALOGUE</p>
            <h2 id="inspect-database-heading">Tables &amp; connections.</h2>
          </div>
          <p>
            The registered application tables are checked with read-only count
            requests. Expected columns come from the application schema; private
            tables omit counts, and no row contents are returned.
          </p>
        </div>

        {groups.map((group) => {
          const tables = report?.tables.filter((table) => table.group === group) ?? [];
          return (
            <section className="inspect-table-group" key={group}>
              <h3>{group}</h3>
              <div className="inspect-table-grid">
                {tables.map((table) => (
                  <details className="inspect-table-card" key={table.name}>
                    <summary>
                      <span className="inspect-table-title">
                        <strong>{table.name}</strong>
                        <small>{table.columns.length} columns</small>
                      </span>
                      <span className={`inspect-status inspect-status-${table.status === "available" ? "connected" : "error"}`}>
                        {table.status === "available"
                          ? table.estimatedRows === null
                            ? table.group === "Private game state" ? "Available · private" : "Available"
                            : `~${table.estimatedRows.toLocaleString()} rows`
                          : "Check failed"}
                      </span>
                    </summary>
                    <p className={table.status === "available" ? "inspect-table-message" : "inspect-table-message inspect-error-text"}>
                      {table.message}
                    </p>
                    <ul className="inspect-columns">
                      {table.columns.map((column) => <li key={column}>{column}</li>)}
                    </ul>
                  </details>
                ))}
                {!report && loading && (
                  <p className="inspect-loading">Loading table checks…</p>
                )}
              </div>
            </section>
          );
        })}
      </section>

      <footer className="inspect-footer">
        <p>
          This page is intentionally unlinked from the site navigation. It is
          public: do not add row-level data, credentials, or private character
          information to these diagnostics.
        </p>
      </footer>
    </>
  );
}
