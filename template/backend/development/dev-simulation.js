// Local development-only tools. No routes or controls are included in the public frontend.
import { resolve } from 'node:path';
import { createServer } from '../server.js';

if (process.env.NODE_ENV === 'production' || process.env.APP_MODE !== 'simulation') throw new Error('Set APP_MODE=simulation explicitly; these tools cannot run in production.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must name the same local development database as dev:simulation.');
const [command, ...args] = process.argv.slice(2);
const server = await createServer({ autoSync: false, mode: 'simulation', appRoot: resolve(process.env.APP_ROOT || resolve(import.meta.dirname, '../..')) });
try {
  if (command === 'sms') {
    let phone = args[0]?.replace(/[\s-]/g, '');
    if (/^1[3-9]\d{9}$/.test(phone || '')) phone = `+86${phone}`;
    const purpose = args[1] || 'register';
    const rows = await server.database.query('SELECT code,sent_at FROM simulation_sms WHERE phone=$1 AND purpose=$2 AND sent_at>$3', [phone, purpose, Date.now()-600000]);
    console.log(JSON.stringify(rows.rows[0] || { message: 'No recent development code.' }));
  } else if (command === 'review') {
    const [phone, kind, decision, feedback = '', internalNote = ''] = args;
    console.log(JSON.stringify(await server.queueSimulationReview({ phone, kind, decision, feedback, internalNote })));
  } else if (command === 'sync') {
    console.log(JSON.stringify(await server.syncReviews({ force: true })));
  } else if (command === 'health') {
    console.log(JSON.stringify((await server.database.query('SELECT * FROM sync_health WHERE id=1')).rows[0]));
  } else throw new Error('Usage: dev-simulation.js sms PHONE [register|reset] | review PHONE attendance|submission accepted|rejected|needs_materials [FEEDBACK] [INTERNAL_NOTE] | sync | health');
} finally { await server.shutdown(); }
