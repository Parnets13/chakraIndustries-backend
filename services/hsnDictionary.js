/**
 * hsnDictionary.js
 * Client-confirmed keyword-based HSN lookup for common appliance / household product categories.
 * Used as a last-resort fallback when HSN is blank in both the invoice item and the ItemMaster.
 * Returns the HSN string, or '' if no match found.
 */
export function getHsnByName(name) {
  if (!name) return '';
  const n = name.toLowerCase();

  // ── Client confirmed YES ──────────────────────────────────────────────────
  if (n.includes('induction'))                                        return '85166000';
  if (n.includes('gas stove') || n.includes('gas chulha'))           return '73211110';
  if (n.includes('pressure cooker'))                                  return '73239390';
  if (n.includes('ro') || n.includes('water purifier') || n.includes('envy') || n.includes('waas')) return '84212190';
  if (n.includes('air cooler') || n.includes('cooler-') || n.includes('cooler ')) return '84796000';
  if (n.includes('iron') && !n.includes('environment'))              return '85164000';
  if (n.includes('immersion') || n.includes('rod'))                  return '85161000';
  if (n.includes('mixer') || n.includes('grinder') || n.includes('aeon') || n.includes('bldc')) return '85094010';

  // ── Client corrected ──────────────────────────────────────────────────────
  if (n.includes('fan') || n.includes('orient') || n.includes('pedestal') || n.includes('stand 32')) {
    // 84145120 is the most common ceiling/pedestal/table fan HSN (client confirmed)
    return '84145120';
  }
  if (n.includes('plastic') && (n.includes('bottle') || n.includes('dabba')))        return '39241010';
  if (n.includes('ss') && (n.includes('bottle') || n.includes('dabba') || n.includes('dura') || n.includes('kent'))) return '73239990';
  if (n.includes('gasket') || n.includes('rubber'))                  return '40169310';
  if (n.includes('weight') || n.includes('whistle') || n.includes('seeti'))          return '73239300';

  // ── Generic fallback ──────────────────────────────────────────────────────
  if (n.includes('bottle') || n.includes('dabba'))                   return '39241010';

  return '';
}
