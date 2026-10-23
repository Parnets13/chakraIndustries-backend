/**
 * hsnDictionary.js
 * Keyword-based HSN lookup for common appliance / household product categories.
 * Used as a last-resort fallback when HSN is blank in both the invoice item
 * and the ItemMaster record.
 *
 * Returns the 8-digit HSN string, or '' if no match found.
 */
export function getHsnByName(name) {
  if (!name) return '';
  const n = name.toLowerCase();

  if (n.includes('air cooler') || n.includes('air-cooler'))   return '84796000';
  if (n.includes('induction'))                                 return '85166000';
  if (n.includes('ro') || n.includes('water purifier') || n.includes('envy') || n.includes('waas')) return '84212190';
  if (n.includes('fan') || n.includes('orient') || n.includes('pedestal') || n.includes('stand fan')) return '84145930';
  if (n.includes('pressure cooker') || n.includes('cooker'))  return '73239390';
  if (n.includes('cooler'))                                    return '84796000';
  if (n.includes('iron'))                                      return '85164000';
  if (n.includes('mixer') || n.includes('grinder') || n.includes('aeon') || n.includes('bldc')) return '85094010';
  if (n.includes('bottle') || n.includes('dabba') || n.includes('dura')) return '39241090';
  if (n.includes('immersion') || n.includes('rod'))           return '85161000';

  return '';
}
