// Which mailbox row is THE sending mailbox.
//
// This exists because "the mailbox" used to be whatever `SELECT * FROM mailboxes
// LIMIT 1` happened to return. With no ORDER BY that is an arbitrary row, and
// the table can trivially hold more than one row for the same mailbox: the boot
// seed inserted `process.env.EMAIL_FROM` verbatim (`Team@seekersai.org`) while
// POST /mailboxes/health inserts `address.toLowerCase()`, and the unique index
// is on the raw text — so the first health post from n8n created a SECOND row
// for the same physical mailbox. From then on the daily cap being ENFORCED by
// the scheduler and the one DISPLAYED on the deliverability panel could come
// from different rows, and a spam-reject safety downgrade could be written to
// the row nobody reads.
//
// Both halves of that are fixed here: the address is canonicalised in one place,
// and the lookup is by that address rather than by luck.
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { mailboxes } from "../db/schema";
import { configuredSenderAddress } from "./sending-policy";

// The address canonicalisation itself lives in sending-policy.ts, which imports
// no database, so it can be unit-tested. Re-exported here because "which row is
// the sending mailbox" and "what is that mailbox called" are one question, and a
// caller should not have to know they come from two files.
export { configuredSenderAddress };

/**
 * The mailbox row for the configured sender, or undefined when there is none.
 *
 * Undefined is a meaningful, safe answer: callers fall back to the stage
 * default (recovery — 5/day), which is the most conservative cap the policy
 * has. That is deliberately different from the old behaviour of reading an
 * arbitrary row, which could silently apply a DIFFERENT mailbox's cap and
 * warmup stage to our sending.
 */
export async function loadSendingMailbox(): Promise<typeof mailboxes.$inferSelect | undefined> {
  const address = configuredSenderAddress();
  const [row] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.address, address))
    .limit(1);

  if (!row) {
    console.warn(
      `[mailbox] no mailboxes row for "${address}" — falling back to the ` +
      `stage default cap. Check EMAIL_FROM and the boot seed.`,
    );
  }
  return row;
}
