
import axios from 'axios';
import http from 'http';
import https from 'https';
import TallyConfig from '../models/TallyConfig.js';
import TallySyncLog from '../models/TallySyncLog.js';

// --------------------------
// 1. CONFIGURATION CONSTANTS
// --------------------------
const ENTITY_TIMEOUTS = {
  ping: 30000,            // 30 sec for connection test
  ledgers: 120000,        // 2 min for ledgers
  items: 120000,          // 2 min for items
  purchase: 300000,       // 5 min for purchase vouchers
  sales: 300000,          // 5 min for sales vouchers
  payment: 300000,        // 5 min for payment vouchers
  receipt: 300000,        // 5 min for receipt vouchers
  journal: 300000,        // 5 min for journal vouchers
  contra: 300000          // 5 min for contra vouchers
};

const RETRY_CONFIG = {
  maxAttempts: 5,
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

// --------------------------
// 2. QUEUE SYSTEM (SEQUENTIAL ONLY)
// --------------------------
let requestQueue = [];
let isProcessingQueue = false;

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const { fn, resolve, reject } = requestQueue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  isProcessingQueue = false;
}

// --------------------------
// 3. HTTP AGENT CONFIG (NO SOCKET LEAKS)
// --------------------------
function createHttpAgent() {
  return new http.Agent({
    keepAlive: false, // NO keep-alive - prevent CLOSE_WAIT
    maxSockets: 1,
    timeout: 60000
  });
}

function createHttpsAgent() {
  return new https.Agent({
    keepAlive: false,
    maxSockets: 1,
    timeout: 60000
  });
}

// --------------------------
// 4. XML BUILDERS (OPTIMIZED FOR TALLY)
// --------------------------
function buildExportXml(reportName, extraVars = '', companyName = '') {
  const companyTag = companyName 
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName.toUpperCase())}</SVCURRENTCOMPANY>` 
    : '';
  
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
        <STATICVARIABLES>
          ${companyTag}
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          ${extraVars}
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --------------------------
// 5. HTTP REQUEST WITH RETRY
// --------------------------
async function postToTally(cfg, xml, entityType) {
  return enqueue(async () => {
    const url = resolveTallyUrl(cfg);
    const timeoutMs = ENTITY_TIMEOUTS[entityType] || ENTITY_TIMEOUTS.ping;

    let lastError;
    for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        const httpAgent = createHttpAgent();
        const httpsAgent = createHttpsAgent();
        
        console.log(`[Tally] Attempt ${attempt + 1}/${RETRY_CONFIG.maxAttempts} - POST ${url} (${xml.length} bytes)`);

        const response = await axios({
          method: 'POST',
          url,
          data: xml,
          headers: {
            'Content-Type': 'text/xml',
            'Accept': 'text/xml, */*',
            'Connection': 'close' // Critical to prevent CLOSE_WAIT
          },
          timeout: timeoutMs,
          responseType: 'text',
          validateStatus: () => true,
          maxRedirects: 5,
          httpAgent,
          httpsAgent
        });

        // Clean up agents immediately to prevent leaks
        httpAgent.destroy();
        httpsAgent.destroy();

        console.log(`[Tally] Response received - Status: ${response.status}, Length: ${response.data?.length || 0} bytes`);

        // Update connection status on success
        await TallyConfig.findOneAndUpdate(
          {},
          { connectionStatus: 'Connected', lastConnectionCheck: new Date() },
          { upsert: true, new: true }
        );

        return response.data;
      } catch (err) {
        lastError = err;
        console.error(`[Tally] Attempt ${attempt + 1} failed:`, err.message);

        // Update connection status on failure
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
          await TallyConfig.findOneAndUpdate(
            {},
            { connectionStatus: 'Disconnected', lastConnectionCheck: new Date() },
            { upsert: true, new: true }
          );
        }

        // Only retry if it's a retryable error and we have attempts left
        if (attempt < RETRY_CONFIG.maxAttempts - 1 && isRetryableError(err)) {
          const delayMs = calculateRetryDelay(attempt);
          console.log(`[Tally] Retrying in ${delayMs / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          break;
        }
      }
    }

    throw lastError;
  });
}

function isRetryableError(err) {
  return (
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNABORTED' ||
    (err.response && err.response.status >= 500)
  );
}

function calculateRetryDelay(attempt) {
  const delay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

function resolveTallyUrl(cfg) {
  const port = cfg.port || 9000;
  
  if (cfg.tallyLocalUrl) {
    const url = cfg.tallyLocalUrl.trim();
    if (url.match(/:\d+$/)) return url.replace(/\/$/, '');
    return `${url.replace(/\/$/, '')}:${port}`;
  }
  
  if (cfg.serverUrl) {
    const url = cfg.serverUrl.trim();
    if (url.match(/:\d+$/)) return url.replace(/\/$/, '');
    return `${url.replace(/\/$/, '')}:${port}`;
  }
  
  return `http://localhost:${port}`;
}

// --------------------------
// 6. PUBLIC API FUNCTIONS
// --------------------------
export async function testConnection() {
  const cfg = await TallyConfig.findOne();
  const xml = buildExportXml('List of Companies', '', cfg.companyName);
  const response = await postToTally(cfg, xml, 'ping');
  return { ok: true, response };
}

export async function pullLedgersFromTally() {
  const cfg = await TallyConfig.findOne();
  const xml = buildExportXml('List of Accounts', '', cfg.companyName);
  const response = await postToTally(cfg, xml, 'ledgers');
  // TODO: Parse and save to database here
  return { ok: true, rawXml: response };
}

export async function pullItemsFromTally() {
  const cfg = await TallyConfig.findOne();
  const xml = buildExportXml('Stock Item Summary', '', cfg.companyName);
  const response = await postToTally(cfg, xml, 'items');
  return { ok: true, rawXml: response };
}

// Export all config and functions for use in other files
export { ENTITY_TIMEOUTS, RETRY_CONFIG };
