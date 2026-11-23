// node dist/call-audit-cli.js [YYYY-MM-DD] [--no-ai]   (default: today, Baku time)
// node dist/call-audit-cli.js --job 2970               (listen to one recording for Turkish pronunciation)
import 'dotenv/config';
import { bakuDay, listenToJob, runCallAudit } from './call-audit.js';

const args = process.argv.slice(2);
const jobArg = args.indexOf('--job');
if (jobArg >= 0) {
  listenToJob(Number(args[jobArg + 1]))
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
} else {
  const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || bakuDay();
  runCallAudit(day, { ai: !args.includes('--no-ai') })
    .then(({ report }) => { console.log(report); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}
