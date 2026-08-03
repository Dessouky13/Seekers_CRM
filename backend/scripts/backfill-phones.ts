// One-off: normalise and classify every existing lead phone number.
//
// Reports counts before and after so the result is auditable rather than a
// silent mass update. Idempotent — re-running only touches rows whose stored
// normalisation differs from what the current rules produce.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { normalisePhone, classifyPhone } from "../src/services/phone";

async function main() {
  const rows = await db.execute(sql`
    SELECT id, phone, phone_e164, phone_type FROM leads
     WHERE phone IS NOT NULL AND length(trim(phone)) > 0
  `);

  let changed = 0, unparseable = 0;
  const byType: Record<string, number> = { mobile: 0, landline: 0, unknown: 0 };

  for (const r of rows.rows as Array<Record<string, string | null>>) {
    const e164 = normalisePhone(r.phone);
    const type = classifyPhone(e164);
    if (!e164) unparseable++;
    byType[type] = (byType[type] ?? 0) + 1;

    if (r.phone_e164 === e164 && r.phone_type === type) continue;
    await db.execute(sql`
      UPDATE leads SET phone_e164 = ${e164}, phone_type = ${type}
       WHERE id = ${r.id}
    `);
    changed++;
  }

  console.log(`phones examined:  ${rows.rows.length}`);
  console.log(`rows updated:     ${changed}`);
  console.log(`unparseable:      ${unparseable}  (no country code — left null)`);
  console.log(`mobile:           ${byType.mobile}`);
  console.log(`landline:         ${byType.landline}`);
  console.log(`unknown:          ${byType.unknown}  (mostly +1, unclassifiable by design)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
