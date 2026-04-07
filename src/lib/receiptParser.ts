/**
 * Shared receipt item normalisation — used by both parse-receipt (image/PDF)
 * and parse-receipt-text (pasted text) API routes.
 */
export function normalizeReceiptItems(items: any[]): any[] {
  return items.map((item: any) => {
    // Price sanity: must be a positive number < 999
    const rawPrice = item.price != null ? Number(item.price) : null
    const price = rawPrice != null && rawPrice > 0 && rawPrice < 999 ? parseFloat(rawPrice.toFixed(2)) : null

    // amount_per_unit: must be a positive number
    const rawApu = item.amount_per_unit != null ? Number(item.amount_per_unit) : null
    const amount_per_unit = rawApu != null && rawApu > 0 ? rawApu : null

    // unit: canonical set; default 'item' when no measured size
    const rawUnit = String(item.unit || 'item').toLowerCase()
    const unit = ['ml', 'g', 'kg', 'l'].includes(rawUnit)
      ? (rawUnit === 'kg' ? 'g' : rawUnit === 'l' ? 'ml' : rawUnit)
      : (amount_per_unit ? rawUnit : 'item')

    // Convert kg/l amounts the model forgot to convert
    const convertedApu = item.unit === 'kg' && rawApu
      ? rawApu * 1000
      : item.unit === 'l' && rawApu
        ? rawApu * 1000
        : amount_per_unit

    return {
      raw_text: String(item.raw_text || ''),
      normalized_name: String(item.normalized_name || item.raw_text || 'Unknown item'),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      amount_per_unit: convertedApu,
      unit,
      category: item.category || 'other',
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.7)),
      price,
    }
  })
}
