// node dist/transfer-fail-cli.js backfill 2026-11-01   (old unanswered transfers -> handed to sales)
// node dist/transfer-fail-cli.js digest 2026-11-01     (mail the ones not mailed yet, per campaign)
// node dist/transfer-fail-cli.js list 2026-11-01       (show how many, nothing changes)
import 'dotenv/config';
import { loadSettings } from './settings.js';
import { backfillAgreedNotConnected, sendFailedTransferDigest } from './transfer-fail.js';

await loadSettings().catch((err) => console.warn('settings not loaded:', (err as Error).message));
const [cmd, day = '2026-11-01'] = process.argv.slice(2);
try {
  if (cmd === 'backfill') console.log(await backfillAgreedNotConnected(day));
  else if (cmd === 'digest') console.log(await sendFailedTransferDigest(day));
  else console.log('usage: backfill|digest YYYY-MM-DD');
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
