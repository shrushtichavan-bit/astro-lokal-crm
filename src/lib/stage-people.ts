import "server-only";
import { pool } from "@/lib/db";
import type { UserRow } from "@/lib/db-types";

type AttemptInfo = { outcome: string; attempted_by: string };
type RoundInfo = { passed: boolean | null; submitted_at: string | null; conducted_by: string };

/**
 * Who did (or is assigned to) each pipeline stage, for a batch of leads.
 * Shared by the All Leads table (enrichLeads) and the pool dashboard's
 * "Previous Stage" column so both read the same tables the same way.
 */
export type StagePeople = {
  resolve: (email: string | null | undefined) => string;
  chainBy: Map<string, Record<string, string>>;
  attemptsBy: Map<string, Record<number, AttemptInfo>>;
  roundsBy: Map<string, Record<number, RoundInfo>>;
  profileByLead: Map<string, { lead_id: string; linked_by: string }>;
};

export async function loadStagePeople(ids: string[], roundNumbers: number[]): Promise<StagePeople> {
  const [assignmentsRes, usersRes, attemptsRes, roundsRes, profilesRes] = await Promise.all([
    pool.query<{ lead_id: string; stage: string; assigned_email: string }>(
      `SELECT lead_id, stage, assigned_email FROM lead_stage_assignments WHERE lead_id = ANY($1::uuid[])`,
      [ids],
    ),
    pool.query<Pick<UserRow, "email" | "name">>(`SELECT email, name FROM users`),
    pool.query<{ lead_id: string; attempt_number: number; outcome: string | null; attempted_by: string }>(
      `SELECT lead_id, attempt_number, outcome, attempted_by FROM call_attempts WHERE lead_id = ANY($1::uuid[])`,
      [ids],
    ),
    pool.query<{ lead_id: string; round_number: number; passed: boolean | null; submitted_at: string | null; conducted_by: string }>(
      `SELECT lead_id, round_number, passed, submitted_at, conducted_by FROM interview_rounds WHERE lead_id = ANY($1::uuid[]) AND round_number = ANY($2::int[])`,
      [ids, roundNumbers],
    ),
    pool.query<{ lead_id: string; linked_by: string }>(
      `SELECT lead_id, linked_by FROM expert_profiles WHERE lead_id = ANY($1::uuid[])`,
      [ids],
    ),
  ]);

  const nameByEmail = new Map(usersRes.rows.map((u) => [u.email, u.name]));
  const resolve = (email: string | null | undefined) => (email ? (nameByEmail.get(email) ?? email) : "");

  const chainBy = new Map<string, Record<string, string>>();
  for (const a of assignmentsRes.rows) {
    const m = chainBy.get(a.lead_id) ?? {};
    m[a.stage] = a.assigned_email;
    chainBy.set(a.lead_id, m);
  }

  const attemptsBy = new Map<string, Record<number, AttemptInfo>>();
  for (const a of attemptsRes.rows) {
    const m = attemptsBy.get(a.lead_id) ?? {};
    m[a.attempt_number] = { outcome: a.outcome ?? "", attempted_by: a.attempted_by };
    attemptsBy.set(a.lead_id, m);
  }

  const roundsBy = new Map<string, Record<number, RoundInfo>>();
  for (const r of roundsRes.rows) {
    const m = roundsBy.get(r.lead_id) ?? {};
    m[r.round_number] = r;
    roundsBy.set(r.lead_id, m);
  }

  const profileByLead = new Map(profilesRes.rows.map((p) => [p.lead_id, p]));

  return { resolve, chainBy, attemptsBy, roundsBy, profileByLead };
}

export type PreviousStage = { label: string; person: string };

/**
 * The most recent *completed* stage before the lead's current one, in
 * pipeline order: Calling → Round 1 → Expert Creation → Round 2 → … Round N.
 * For a stage outside that list (terminal/closed), it's simply the last
 * completed stage. Calling counts as done by whoever marked it Connected, or
 * failing that whoever logged the latest attempt.
 */
export function previousStageFor(
  leadId: string,
  currentStage: string,
  numRounds: number,
  sp: StagePeople,
): PreviousStage | null {
  const attempts = Object.entries(sp.attemptsBy.get(leadId) ?? {})
    .map(([n, a]) => ({ n: Number(n), ...a }))
    .sort((a, b) => a.n - b.n);
  const connected = attempts.find((a) => a.outcome === "connected");
  const callingBy = connected?.attempted_by ?? attempts[attempts.length - 1]?.attempted_by ?? null;
  const rounds = sp.roundsBy.get(leadId) ?? {};
  const roundBy = (n: number) => (rounds[n]?.submitted_at ? rounds[n].conducted_by : null);

  const steps: Array<{ pendingStage: string; label: string; by: string | null }> = [
    { pendingStage: "calling_pending", label: "Calling", by: callingBy },
    { pendingStage: "round_1_pending", label: "Round 1", by: roundBy(1) },
    { pendingStage: "profile_creation_pending", label: "Expert Creation", by: sp.profileByLead.get(leadId)?.linked_by ?? null },
  ];
  for (let n = 2; n <= numRounds; n++) steps.push({ pendingStage: `round_${n}_pending`, label: `Round ${n}`, by: roundBy(n) });

  const idx = steps.findIndex((s) => s.pendingStage === currentStage);
  const before = idx === -1 ? steps : steps.slice(0, idx);
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i].by) return { label: before[i].label, person: sp.resolve(before[i].by) };
  }
  return null;
}
