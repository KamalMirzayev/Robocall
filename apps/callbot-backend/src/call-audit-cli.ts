// node dist/call-audit-cli.js [YYYY-MM-DD] [--no-ai]   (default: today, Baku time)
import 'dotenv/config';
import { bakuDay, runCallAudit } from './call-audit.js';

const args = process.argv.slice(2);
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || bakuDay();
runCallAudit(day, { ai: !args.includes('--no-ai') })
  .then(({ report }) => { console.log(report); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
