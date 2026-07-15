import axios from 'axios';

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNTYwYmY0ODFjNzA5NmIxN2FkZWEwMCIsImlhdCI6MTc4NDAyNDk5MiwiZXhwIjoxNzg0NjI5NzkyfQ.aPtYWjwwVQ3dN-jJ4ncx0HqLOokEHBz-CtqwQDpxC8Q';
const baseUrl = 'http://127.0.0.1:5000/api/tally';

async function exportSalesInvoices() {
  try {
    console.log('Starting sales invoices export with corrected GST ledger names...\n');
    const exportUrl = `${baseUrl}/selective-export?key=salesInvoices&token=${encodeURIComponent(token)}`;
    
    const res = await axios.get(exportUrl, {
      responseType: 'stream',
      timeout: 180000  // 3 minutes
    });

    let lastMessage = '';
    res.data.on('data', chunk => {
      const s = chunk.toString();
      if (s.trim()) {
        console.log(s.trim());
        lastMessage = s.trim();
      }
    });

    res.data.on('end', () => {
      console.log('\n✅ Export completed!');
      process.exit(0);
    });

    res.data.on('error', err => {
      console.error('❌ Stream error:', err.message);
      process.exit(1);
    });
  } catch (e) {
    console.error('❌ Export failed:', e.response?.status || '', e.response?.data || e.message);
    process.exit(1);
  }
}

exportSalesInvoices();
