import { ParsedReceipt } from './types'
const MOCK_RECEIPTS: ParsedReceipt[] = [
{
retailer_name: 'Tesco',
total: 24.50,
items: [
{ raw_text: 'SKIMMED MILK 2PT', normalized_name: 'Skimmed Milk', quantity: 1, unit: 'bottle', category: 'dairy', confidence: 0.95, price: 1.15 },
{ raw_text: 'CHICKEN BRST 500G', normalized_name: 'Chicken Breast', quantity: 500, unit: 'g', category: 'meat', confidence: 0.88, price: 3.50 },
{ raw_text: 'HOVIS WHOLEMEAL', normalized_name: 'Wholemeal Bread', quantity: 1, unit: 'loaf', category: 'bakery', confidence: 0.92, price: 1.50 },
{ raw_text: 'BROCCOLI', normalized_name: 'Broccoli', quantity: 1, unit: 'head', category: 'vegetables', confidence: 0.97, price: 0.89 },
{ raw_text: 'CHEDDAR MATURE 400G', normalized_name: 'Mature Cheddar', quantity: 400, unit: 'g', category: 'dairy', confidence: 0.90, price: 3.25 },
{ raw_text: 'HEINZ BKD BEANS', normalized_name: 'Baked Beans', quantity: 1, unit: 'tin', category: 'tinned', confidence: 0.85, price: 0.95 },
{ raw_text: 'BANANAS LOOSE', normalized_name: 'Bananas', quantity: 5, unit: 'item', category: 'fruit', confidence: 0.78, price: 1.20 },
{ raw_text: 'GRK YOGHURT 500G', normalized_name: 'Greek Yoghurt', quantity: 500, unit: 'g', category: 'dairy', confidence: 0.72, price: 2.00 },
],
},
{
retailer_name: 'Aldi',
total: 18.75,
items: [
{ raw_text: 'FSH SALMON FILLET', normalized_name: 'Salmon Fillet', quantity: 2, unit: 'fillet', category: 'fish', confidence: 0.82, price: 4.99 },
{ raw_text: 'EGGS FREE RANGE 12', normalized_name: 'Free Range Eggs', quantity: 12, unit: 'item', category: 'dairy', confidence: 0.94, price: 2.49 },
{ raw_text: 'BASMATI RICE 1KG', normalized_name: 'Basmati Rice', quantity: 1, unit: 'kg', category: 'dry goods', confidence: 0.96, price: 1.99 },
{ raw_text: 'OLIVE OIL EV 500ML', normalized_name: 'Extra Virgin Olive Oil', quantity: 500, unit: 'ml', category: 'oils', confidence: 0.91, price: 3.49 },
{ raw_text: 'TOMATOES VINE 6PK', normalized_name: 'Vine Tomatoes', quantity: 6, unit: 'item', category: 'vegetables', confidence: 0.87, price: 1.29 },
{ raw_text: 'PASTA PENNE 500G', normalized_name: 'Penne Pasta', quantity: 500, unit: 'g', category: 'dry goods', confidence: 0.93, price: 0.89 },
],
},
]
export async function parseReceipt(): Promise<ParsedReceipt> {
await new Promise((r) => setTimeout(r, 1500))
return MOCK_RECEIPTS[Math.floor(Math.random() * MOCK_RECEIPTS.length)]
}