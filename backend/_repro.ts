import 'dotenv/config';
import { parseSubjectAndBody } from './src/services/outreach';

const cases: Record<string,string> = {
  "break-up, single paragraph starting with Thanks":
`Subject: Should I close your file

Thanks for your time over the past couple of weeks. I'll assume the timing isn't right and close your file for now. If that changes, just reply and we'll pick it up.`,

  "follow-up, last line starts with Best":
`Subject: One more idea

Hi there,

Most clinics lose no-shows they could recover automatically.

Best results come from a simple reminder + rebooking flow.`,

  "normal first touch (control)":
`Subject: WhatsApp leads in under 10s

Hi Ahmed,

Noticed your team handles a lot of WhatsApp enquiries. Open to a quick 15-min call next week?`,
};

for (const [label, out] of Object.entries(cases)) {
  const { subject, body } = parseSubjectAndBody(out);
  console.log(`\n=== ${label}`);
  console.log(`subject: ${JSON.stringify(subject)}`);
  console.log(`body len: ${body.length}  body: ${JSON.stringify(body)}`);
}
process.exit(0);
