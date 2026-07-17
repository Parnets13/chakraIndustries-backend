
import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api';

async function runTest() {
  try {
    console.log('=== Step 1: Logging in to get token ===');
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@chakra.com',
      password: 'admin123'
    });
    const token = loginRes.data.token;
    console.log('✅ Login successful, token obtained');
    console.log('Token:', token.slice(0, 30) + '...');

    console.log('\n=== Step 2: Resetting invoice sync for BIW20 ===');
    const resetRes = await axios.post(
      `${BASE_URL}/tally/reset-invoice-sync`,
      { invoiceNos: ['BIW20'] },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('✅ Reset response:', resetRes.data);

    console.log('\n=== Step 3: Triggering Sales export (check server console for debug logs) ===');
    console.log('🚀 Export started — check the server terminal for debug output');
    
    // For SSE stream, use the named export task key expected by the backend
    const exportRes = await axios.get(
      `${BASE_URL}/tally/selective-export?key=salesInvoices&token=${token}`,
      { responseType: 'stream' }
    );

    // Log SSE messages as they come in
    exportRes.data.on('data', (chunk) => {
      const str = chunk.toString();
      if (str.trim()) {
        console.log('[SSE]', str.trim());
      }
    });

    exportRes.data.on('end', () => {
      console.log('\n✅ Export stream ended');
      process.exit(0);
    });

  } catch (err) {
    console.error('\n❌ Error:', err.response ? err.response.data : err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
    }
    process.exit(1);
  }
}

runTest();

