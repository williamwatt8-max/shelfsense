'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
type ReceiptRow = {
id: string
retailer_name: string | null
total: number | null
created_at: string
receipt_items: {
normalized_name: string
category: string | null
price: number | null
}[]
}
export default function SpendPage() {
const [receipts, setReceipts] = useState<ReceiptRow[]>([])
const [loading, setLoading] = useState(true)
const [retailerFilter, setRetailerFilter] = useState('all')
const [categoryFilter, setCategoryFilter] = useState('all')
const [monthFilter, setMonthFilter] = useState('all')
const [startDate, setStartDate] = useState('')
const [endDate, setEndDate] = useState('')
useEffect(() => {
async function load() {
const { data, error } = await supabase
.from('receipts')
.select('id, retailer_name, total, created_at, receipt_items(normalized_name, category, price)')
.order('created_at', { ascending: false })
if (error) { alert('Error: ' + error.message) } else { setReceipts(data || []) }
setLoading(false)
}
load()
}, [])
const retailers = ['all', ...Array.from(new Set(receipts.map(r => r.retailer_name || 'Unknown')))]
const categories = ['all', ...Array.from(new Set(receipts.flatMap(r => r.receipt_items.map(i => i.category || 'other'))))]
const months = ['all', ...Array.from(new Set(receipts.map(r => r.created_at.slice(0, 7)))).sort().reverse()]
const filtered = receipts.filter((r) => {
if (retailerFilter !== 'all' && (r.retailer_name || 'Unknown') !== retailerFilter) return false
if (monthFilter !== 'all' && r.created_at.slice(0, 7) !== monthFilter) return false
if (startDate && r.created_at < startDate) return false
if (endDate && r.created_at > endDate + 'T23:59:59') return false
if (categoryFilter !== 'all') {
const hasCategory = r.receipt_items.some(i => (i.category || 'other') === categoryFilter)
if (!hasCategory) return false
}
return true
})
const totalAllTime = receipts.reduce((sum, r) => sum + (r.total || 0), 0)
const thisMonth = new Date().toISOString().slice(0, 7)
const totalThisMonth = receipts
.filter(r => r.created_at.slice(0, 7) === thisMonth)
.reduce((sum, r) => sum + (r.total || 0), 0)
const filteredTotal = filtered.reduce((sum, r) => sum + (r.total || 0), 0)
if (loading) {
return (
<main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
<p className="text-gray-400">Loading spend data...</p>
</main>
)
}
return (
<main className="min-h-screen bg-gray-950 text-white p-6 max-w-2xl mx-auto">
<div className="flex items-center justify-between mb-6">
<h1 className="text-2xl font-bold">Spend History</h1>
<a href="/" className="text-gray-400 hover:text-white text-sm">← Back</a>
</div>
<div className="grid grid-cols-2 gap-4 mb-6">
<div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
<p className="text-gray-400 text-sm mb-1">This Month</p>
<p className="text-2xl font-bold text-emerald-400">£{totalThisMonth.toFixed(2)}</p>
</div>
<div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
<p className="text-gray-400 text-sm mb-1">All Time</p>
<p className="text-2xl font-bold text-emerald-400">£{totalAllTime.toFixed(2)}</p>
</div>
</div>
<div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6 space-y-3">
<div className="flex gap-3 flex-wrap">
<div className="flex flex-col gap-1 flex-1 min-w-[120px]">
<label className="text-gray-400 text-xs">Retailer</label>
<select value={retailerFilter} onChange={e => setRetailerFilter(e.target.value)} className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm">
{retailers.map(r => <option key={r} value={r}>{r === 'all' ? 'All Retailers' : r}</option>)}
</select>
</div>
<div className="flex flex-col gap-1 flex-1 min-w-[120px]">
<label className="text-gray-400 text-xs">Category</label>
<select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm">
{categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
</select>
</div>
<div className="flex flex-col gap-1 flex-1 min-w-[120px]">
<label className="text-gray-400 text-xs">Month</label>
<select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm">
{months.map(m => <option key={m} value={m}>{m === 'all' ? 'All Months' : m}</option>)}
</select>
</div>
</div>
<div className="flex gap-3 flex-wrap">
<div className="flex flex-col gap-1 flex-1 min-w-[120px]">
<label className="text-gray-400 text-xs">From</label>
<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm" />
</div>
<div className="flex flex-col gap-1 flex-1 min-w-[120px]">
<label className="text-gray-400 text-xs">To</label>
<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm" />
</div>
</div>
</div>
{(retailerFilter !== 'all' || categoryFilter !== 'all' || monthFilter !== 'all' || startDate || endDate) && (
<p className="text-gray-400 text-sm mb-4">Filtered total: <span className="text-emerald-400 font-semibold">£{filteredTotal.toFixed(2)}</span></p>
)}
<div className="space-y-3">
{filtered.length === 0
? <p className="text-gray-500 text-center mt-12">No receipts found</p>
: filtered.map(r => (
<div key={r.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
<div className="flex items-center justify-between mb-2">
<div>
<h3 className="font-semibold">{r.retailer_name || 'Unknown Store'}</h3>
<p className="text-gray-400 text-sm">{new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
</div>
<span className="text-emerald-400 font-bold text-lg">{r.total != null ? '£' + r.total.toFixed(2) : '—'}</span>
</div>
<div className="flex flex-wrap gap-1 mt-2">
{Array.from(new Set(r.receipt_items.map(i => i.category || 'other'))).map(cat => (
<span key={cat} className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded-full">{cat}</span>
))}
</div>
<p className="text-gray-500 text-xs mt-2">{r.receipt_items.length} items</p>
</div>
))
}
</div>
</main>
)
}