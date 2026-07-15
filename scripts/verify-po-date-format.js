function td(d){
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

const docs = [
  { poId: 'PO-2026-008', createdAt: '2026-06-18T09:27:27.459Z' },
  { poId: 'PO-2026-007', createdAt: '2026-06-16T07:31:23.549Z' },
];

for (const po of docs) {
  const voucherDate = td(po.createdAt) || 'FALLBACK';
  const poOrderDate = td(po.createdAt);
  console.log(`${po.poId}: createdAt -> ${po.createdAt} -> td -> ${voucherDate}`);
  console.log(`${po.poId}: poOrderDate (same formatter) -> ${poOrderDate}`);
}
