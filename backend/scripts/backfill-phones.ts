// One-off: normalise and classify every existing lead phone number.
//
// Reports counts before and after so the result is auditable rather than a
// silent mass update. Idempotent — re-running only touches rows whose stored
// normalisation differs from what the current rules produce.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { phoneFields } from "../src/services/phone";

async function main() {
  const rows = await db.execute(sql`
    SELECT id, phone, phone_e164, phone_type FROM leads
     WHERE phone IS NOT NULL AND length(trim(phone)) > 0
  `);

  let changed = 0, unparseable = 0;
  const byType: Record<string, number> = { mobile: 0, landline: 0, unknown: 0 };

  for (const r of rows.rows as Array<Record<string, string | null>>) {
    // phoneFields, NOT normalisePhone + classifyPhone. The two disagree on one
    // row shape: for a number that cannot be parsed to E.164, classifyPhone
    // returns "unknown" while every application write path (which all go
    // through phoneFields) stores NULL — "unknown" there means "a real number
    // whose dialling plan we can't read", e.g. any +1. Calling the pieces
    // directly made this script the one phone writer that disagreed with the
    // rest, so it and the API would have churned the same rows against each
    // other forever. Only the two derived columns are written: `phone` is
    // human-entered text this script has no mandate to rewrite.
    const { phoneE164, phoneType } = phoneFields(r.phone);
    if (!phoneE164) unparseable++;
    if (phoneType) byType[phoneType] = (byType[phoneType] ?? 0) + 1;

    if (r.phone_e164 === phoneE164 && r.phone_type === phoneType) continue;
    await db.execute(sql`
      UPDATE leads SET phone_e164 = ${phoneE164}, phone_type = ${phoneType}
       WHERE id = ${r.id}
    `);
    changed++;
  }

  console.log(`phones examined:  ${rows.rows.length}`);
  console.log(`rows updated:     ${changed}`);
  console.log(`unparseable:      ${unparseable}  (no country code — both columns left null)`);
  console.log(`mobile:           ${byType.mobile}`);
  console.log(`landline:         ${byType.landline}`);
  console.log(`unknown:          ${byType.unknown}  (mostly +1, unclassifiable by design)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
