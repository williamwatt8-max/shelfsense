'use client'import { useState } from 'react'
import { ReviewItem, StorageLocation } from '@/lib/types'
import { supabase } from '@/lib/supabase'export default function Home() {
const [step, setStep] = useState<'upload' | 'reviewing' | 'done'>('upload')
const [loading, setLoading] = useState(false)
const [retailer, setRetailer] = useState('')
const [total, setTotal] = useState<number | null>(null)
const [items, setItems] = useState<ReviewItem[]>([])
const [preview, setPreview] = useState<string | null>(null)async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
const file = e.target.files?.[0]
if (!file) return
setPreview(URL.createObjectURL(file))
setLoading(true)
const formData = new FormData()
formData.append('receipt', file)
try {
const res = await fetch('/api/parse-receipt', { method: 'POST', body: formData })
const result = await res.json()
if (result.error) { alert('Error: ' + result.error); setLoading(false); return }
setRetailer(result.retailer_name || 'Unknown Store')
setTotal(result.total || null)
setItems(result.items.map((item: any, i: number) => ({
...item, id: String(i), selected: true, location: 'fridge' as StorageLocation, expiry_date: null,
})))
setStep('reviewing')
} catch (err) {
alert('Something went wrong. Try again.')
}
setLoading(false)
}async function handleSave() {
const selected = items.filter((i) => i.selected)
const { data: receiptData, error: receiptError } = await supabase
.from('receipts')
.insert({ retailer_name: retailer, total: total })
.select()
.single()
if (receiptError) { alert('Error saving receipt: ' + receiptError.message); return }
const receiptId = receiptData.id
const { data: receiptItems, error: itemsError } = await supabase
.from('receipt_items')
.insert(selected.map((item) => ({
receipt_id: receiptId,
raw_text: item.name,
normalized_name: item.normalized_name,
quantity: item.quantity,
unit: item.unit,
category: item.category || null,
confidence: item.confidence,
price: item.price || null,
})))
.select()
if (itemsError) { alert('Error saving items: ' + itemsError.message); return }
const { error: inventoryError } = await supabase.from('inventory_items').insert(
selected.map((item, i) => ({
name: item.normalized_name,
quantity: item.quantity,
unit: item.unit,
location: item.location,
category: item.category || null,
expiry_date: item.expiry_date || null,
receipt_item_id: receiptItems?.[i]?.id || null,
status: 'active',
}))
)
if (inventoryError) { alert('Error saving to inventory: ' + inventoryError.message) } else { setStep('done') }
}if (step === 'upload') {
return (
<main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
<h1 className="text-4xl font-bold mb-2">ShelfSense</h1>
<p className="text-gray-400 mb-8">Upload a receipt photo to start tracking your food</p>
{preview && <img src={preview} alt="Receipt preview" className="max-w-xs max-h-64 rounded-lg mb-6 border border-gray-700" />}
<label className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-8 rounded-lg text-lg transition-colors cursor-pointer">
{loading ? 'Scanning...' : 'Upload Receipt Photo'}
<input type="file" accept="image/*" capture="environment" onChange={handleFileChange} disabled={loading} className="hidden" />
</label>
{loading && <p className="text-gray-500 mt-4 text-sm">AI is reading your receipt...</p>}
<a href="/inventory" className="text-gray-500 hover:text-gray-300 mt-8 text-sm">View Inventory</a>
<a href="/spend" className="text-gray-500 hover:text-gray-300 mt-2 text-sm">Spend History</a>
</main>
)
}if (step === 'reviewing') {
return (
<main className="min-h-screen bg-gray-950 text-white p-6 max-w-2xl mx-auto">
<h1 className="text-2xl font-bold mb-1">Review Items</h1>
<p className="text-gray-400 mb-1">From {retailer} — edit anything that looks wrong</p>
{total && <p className="text-emerald-400 text-sm mb-6">Total: £{total.toFixed(2)}</p>}
<div className="space-y-3">
{items.map((item, index) => (
<div key={item.id} className={'bg-gray-900 border rounded-lg p-4 ' + (item.confidence < 0.8 ? 'border-yellow-600' : 'border-gray-800')}>
<div className="flex items-center gap-3 mb-3">
<input type="checkbox" checked={item.selected} onChange={(e) => { const updated = [...items]; updated[index].selected = e.target.checked; setItems(updated) }} className="w-5 h-5 accent-emerald-500" />
<input type="text" value={item.normalized_name} onChange={(e) => { const updated = [...items]; updated[index].normalized_name = e.target.value; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 flex-1 text-white" />
{item.price != null && <span className="text-gray-400 text-sm">£{item.price.toFixed(2)}</span>}
{item.confidence < 0.8 && <span className="text-yellow-500 text-xs">Low confidence</span>}
</div>
<div className="flex gap-2 flex-wrap">
<input type="number" value={item.quantity} onChange={(e) => { const updated = [...items]; updated[index].quantity = Number(e.target.value); setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 w-20 text-white" />
<input type="text" value={item.unit} onChange={(e) => { const updated = [...items]; updated[index].unit = e.target.value; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 w-20 text-white" />
<select value={item.location} onChange={(e) => { const updated = [...items]; updated[index].location = e.target.value as StorageLocation; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white">
<option value="fridge">Fridge</option>
<option value="freezer">Freezer</option>
<option value="cupboard">Cupboard</option>
<option value="other">Other</option>
</select>
<input type="date" value={item.expiry_date || ''} onChange={(e) => { const updated = [...items]; updated[index].expiry_date = e.target.value || null; setItems(updated) }} className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white" />
</div>
</div>
))}
</div>
<button onClick={handleSave} className="mt-6 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg text-lg transition-colors">
Save {items.filter((i) => i.selected).length} Items to Inventory
</button>
</main>
)
}return (
<main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
<h1 className="text-3xl font-bold mb-2">Items Saved!</h1>
<p className="text-gray-400 mb-2">{items.filter((i) => i.selected).length} items added to your inventory</p>
{total && <p className="text-emerald-400 mb-6">Total spend: £{total.toFixed(2)}</p>}
<div className="flex gap-4">
<button onClick={() => { setStep('upload'); setPreview(null) }} className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-8 rounded-lg transition-colors">
Scan Another
</button>
<a href="/inventory" className="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors">
View Inventory
</a>
</div>
</main>
)
}