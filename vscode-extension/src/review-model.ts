import { Report } from './core';
export type ReviewStatus = 'unreviewed' | 'confirmed' | 'dismissed';
export interface Decision { status: ReviewStatus; note: string; updated: string; sourceHash?: string }
export interface Run {
  target: string; model: string; cwe: string; status: string; started: string; finished: string;
  mode?: 'query' | 'sweep'; report?: Report; reviews?: Record<string, Decision>; sourceChanged?: boolean;
}
export function decision(run: Run, index: number): Decision {
  return run.reviews?.[String(index)] ?? { status: 'unreviewed', note: '', updated: '' };
}
export function counts(run: Run) {
  const result = { unreviewed: 0, confirmed: 0, dismissed: 0 };
  (run.report?.findings ?? []).forEach((_, index) => result[decision(run, index).status]++);
  return result;
}
export function setDecision(run: Run, index: number, status: ReviewStatus, note: string, sourceHash?: string) {
  if (!Number.isInteger(index) || !run.report?.findings[index]) throw new Error('Unknown candidate.');
  if (!['unreviewed', 'confirmed', 'dismissed'].includes(status)) throw new Error('Unknown review status.');
  if (typeof note !== 'string' || note.length > 4000) throw new Error('Keep review notes under 4,000 characters.');
  if (status === 'dismissed' && !note.trim()) throw new Error('Add a short reason before dismissing this candidate.');
  run.reviews ??= {};
  run.reviews[String(index)] = { status, note: note.trim(), updated: new Date().toISOString(), sourceHash };
}
export function invalidateDecision(run: Run, index: number, currentHash?: string) {
  const d = decision(run, index);
  if (d.status !== 'unreviewed' && (!currentHash || currentHash !== d.sourceHash)) {
    setDecision(run, index, 'unreviewed', d.note);
    run.sourceChanged = true;
    return true;
  }
  return false;
}
export function nextPending(run: Run, current: number) {
  const total = run.report?.findings.length ?? 0;
  for (let offset = 1; offset <= total; offset++) {
    const i = (current + offset) % total;
    if (decision(run, i).status === 'unreviewed') return i;
  }
  return current;
}
export function reviewSummary(run: Run) {
  const c = counts(run);
  return `${c.unreviewed} to review · ${c.confirmed} confirmed · ${c.dismissed} dismissed`;
}
export const guidance: Record<string, string[]> = {
  'CWE-89': ['Find where request or user input enters the database query.', 'Check whether values use bound parameters rather than string concatenation.', 'Confirm only if a reachable query lets untrusted input change SQL structure.'],
  'CWE-287': ['Locate token or identity validation before the protected operation.', 'For OAuth tokens, check signature, issuer, expiry, and the intended resource audience.', 'Look for validation in middleware or shared dependencies before concluding it is missing.'],
  'CWE-862': ['Identify the protected operation and the permission or scope it requires.', 'Trace checks in the callback, middleware, and shared authorization helpers.', 'Confirm only if a caller lacking permission can reach the operation.'],
  'CWE-441': ['Trace which credential is sent to the downstream service.', 'Check that incoming MCP tokens are not forwarded across resource boundaries.', 'Distinguish authorized service credentials from delegated user access.']
};
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
