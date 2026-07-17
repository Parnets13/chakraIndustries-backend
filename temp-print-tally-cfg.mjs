import connectDB from './config/database.js';
import TallyConfig from './models/TallyConfig.js';
import { exportSalesInvoices } from './services/tallyExportService.js';

await connectDB();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();
if (!cfg) {
  console.error('ERROR: No TallyConfig found');
  process.exit(1);
}
console.log('CURRENT TallyConfig (raw from DB):');
console.log(JSON.stringify(cfg, null, 2));

// Print the shape of cfg that exportSalesInvoices sees.
console.log('\nCONFIG PASSED TO exportSalesInvoices:');
const passedCfg = {
  companyName: cfg.companyName,
  gstin: cfg.gstin,
  state: cfg.state,
  tallyLocalUrl: cfg.tallyLocalUrl,
  serverUrl: cfg.serverUrl,
  port: cfg.port,
  useConnector: cfg.useConnector,
  connectorId: cfg.connectorId,
  tallyUrl: (() => {
    const port = cfg.port || '9000';
    const local = (cfg.tallyLocalUrl || '').trim();
    if (local) {
      if (local.match(/:\d+$/) || local.startsWith('https://')) return local.replace(/\/$/, '');
      return `${local.replace(/\/$/, '')}:${port}`;
    }
    const server = (cfg.serverUrl || '').trim();
    if (server && !server.includes('majesticmall.net') && !server.includes('erp.')) {
      if (server.match(/:\d+$/) || server.startsWith('https://')) return server.replace(/\/$/, '');
      return `${server.replace(/\/$/, '')}:${port}`;
    }
    return `http://localhost:${port}`;
  })(),
};
console.log(JSON.stringify(passedCfg, null, 2));

// If the current company name is empty, mark that.
if (!cfg.companyName || !cfg.companyName.trim()) {
  console.log('\nNOTE: cfg.companyName is empty or missing. exportSalesInvoices will auto-detect the currently open Tally company if possible.');
}
process.exit(0);
