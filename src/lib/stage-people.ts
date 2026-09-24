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

/**
 * Who completed each pipeline stage for a lead, by stage: `caller` (Calling),
 * `r1_taker`, `ec_taker` (Expert Creation), `r2_taker`, … `rN_taker`.
 * Names are resolved; a stage not completed yet is null. The caller is
 * whoever marked the lead Connected, or failing that whoever logged the
 * latest attempt.
 */
export type StageTakers = Record<"caller" | "r1_taker" | "ec_taker", string | null> &
  Partial<Record<`r${number}_taker`, string | null>>;

export function stageTakersFor(leadId: string, numRounds: number, sp: StagePeople): StageTakers {
  const attempts = Object.entries(sp.attemptsBy.get(leadId) ?? {})
    .map(([n, a]) => ({ n: Number(n), ...a }))
    .sort((a, b) => a.n - b.n);
  const connected = attempts.find((a) => a.outcome === "connected");
  const callerEmail = connected?.attempted_by ?? attempts[attempts.length - 1]?.attempted_by ?? null;
  const rounds = sp.roundsBy.get(leadId) ?? {};
  const orNull = (email: string | null | undefined) => (email ? sp.resolve(email) : null);

  const takers: StageTakers = {
    caller: orNull(callerEmail),
    r1_taker: null,
    ec_taker: orNull(sp.profileByLead.get(leadId)?.linked_by),
  };
  for (let n = 1; n <= numRounds; n++) {
    takers[`r${n}_taker`] = rounds[n]?.submitted_at ? orNull(rounds[n].conducted_by) : null;
  }
  return takers;
}
