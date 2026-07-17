import axios from 'axios';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNTYwYmY0ODFjNzA5NmIxN2FkZWEwMCIsImlhdCI6MTc4NDAyNDk5MiwiZXhwIjoxNzg0NjI5NzkyfQ.aPtYWjwwVQ3dN-jJ4ncx0HqLOokEHBz-CtqwQDpxC8Q';
const url = 'http://127.0.0.1:5000/api/tally/selective-export?key=salesInvoices&token=' + encodeURIComponent(token);
console.log('EXPORT_URL', url);
try {
  const res = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  res.data.on('data', chunk => { const s = chunk.toString(); if (s.trim()) console.log('SSE>', s.trim()); });
  res.data.on('end', () => { console.log('STREAM_ENDED'); process.exit(0); });
  res.data.on('error', err => { console.error('STREAM_ERROR', err.message); process.exit(1); });
} catch (e) {
  console.error('EXPORT_FAILED', e.response ? e.response.status : '', e.response ? JSON.stringify(e.response.data) : e.message);
  process.exit(1);
}
