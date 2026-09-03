import type { AdminAuditAction, AdminAuditTargetType } from '@sim-waimai/shared';
import { db } from '../db/client';
import { adminAuditLog } from '../db/schema';

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface LogAdminActionInput {
  actorUsername: string;
  action: AdminAuditAction;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  targetLabel?: string | null;
  detail?: Record<string, unknown>;
  /** Shared by every row written from the same batch API call; omit for a single-target action. */
  batchId?: string;
}

/** Records one admin_audit_log row. Pass `exec` (a db.transaction's `tx`) when the caller already
 *  has an open transaction, so the audit row commits/rolls back atomically with the mutation it
 *  describes; otherwise this runs as its own statement, same as the rest of this codebase's
 *  non-transactional admin writes. */
export async function logAdminAction(input: LogAdminActionInput, exec: DbOrTx = db): Promise<void> {
  await exec.insert(adminAuditLog).values({
    actorUsername: input.actorUsername,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    detail: input.detail ?? null,
    batchId: input.batchId ?? null,
  });
}
