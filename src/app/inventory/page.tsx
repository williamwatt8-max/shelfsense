'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { InventoryItem } from '@/lib/types'
import { differenceInDays } from 'date-fns'

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)

  async function loadItems() {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) { alert('Error: ' + error.message) } else { setItems(data || []) }
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [])

  function daysLeft(date: string | null): number | null {
    if (!date) return null
    return differenceInDays(new Date(date), new Date())
  }

  function expiryLabel(d: number | null): string {
    if (d === null) return 'No expiry set'
    if (d < 0) return 'Expired'
    if (d === 0) return 'Expires today'
    if (d === 1) return 'Expires tomorrow'
    return d + ' days left'
  }

  function expiryColor(d: number | null): string {
    if (d === null) return 'text-gray-500'
    if (d <= 1) return 'text-red-400'
    if (d <= 3) return 'text-orange-400'
    if (d <= 7) return 'text-yellow-400'
    return 'text-green-400'
  }

  async function markUsed(id: string) {
    await supabase.from('inventory_items').update({ status: 'used' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'used' })
    loadItems()
  }

  async function markDiscarded(id: string) {
    await supabase.from('inventory_items').update({ status: 'discarded' }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'discarded' })
    loadItems()
  }

  async function changeLocation(id: string, loc: string) {
    await supabase.from('inventory_items').update({ location: loc }).eq('id', id)
    await supabase.from('inventory_events').insert({ inventory_item_id: id, type: 'moved' })
    loadItems()
  }

  const filtered = items.filter((item) => {
    if (filter === 'all') return true
    if (filter === 'expiring') return daysLeft(item.expiry_date) !== null && (daysLeft(item.expiry_date) as number) <= 7
    return item.location === filter
  })

  if (loading) {
    return React.createElement('main', {className: 'min-h-screen bg-gray-950 text-white flex items-center justify-center'},
      React.createElement('p', {className: 'text-gray-400'}, 'Loading inventory...')
    )
  }

  const filters = ['all', 'fridge', 'freezer', 'cupboard', 'expiring']

  return React.createElement('main', {className: 'min-h-screen bg-gray-950 text-white p-6 max-w-2xl mx-auto'},
    React.createElement('div', {className: 'flex items-center justify-between mb-6'},
      React.createElement('h1', {className: 'text-2xl font-bold'}, 'Your Inventory'),
      React.createElement('a', {href: '/', className: 'bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2 px-4 rounded-lg'}, '+ Scan Receipt')
    ),
    React.createElement('div', {className: 'flex gap-2 mb-6 flex-wrap'},
      filters.map((f) =>
        React.createElement('button', {key: f, onClick: () => setFilter(f), className: 'px-4 py-2 rounded-lg text-sm font-medium ' + (filter === f ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')},
          f === 'all' ? 'All' : f === 'expiring' ? 'Expiring Soon' : f.charAt(0).toUpperCase() + f.slice(1)
        )
      )
    ),
    filtered.length === 0
      ? React.createElement('p', {className: 'text-gray-500 text-center mt-12'}, 'No items found')
      : React.createElement('div', {className: 'space-y-3'},
          filtered.map((item) => {
            const d = daysLeft(item.expiry_date)
            return React.createElement('div', {key: item.id, className: 'bg-gray-900 border border-gray-800 rounded-lg p-4'},
              React.createElement('div', {className: 'flex items-start justify-between mb-2'},
                React.createElement('div', null,
                  React.createElement('h3', {className: 'font-semibold text-lg'}, item.name),
                  React.createElement('p', {className: 'text-gray-400 text-sm'}, item.quantity + ' ' + item.unit + ' - ' + item.location)
                ),
                React.createElement('span', {className: 'text-sm font-medium ' + expiryColor(d)}, expiryLabel(d))
              ),
              React.createElement('div', {className: 'flex gap-2 mt-3'},
                React.createElement('button', {onClick: () => markUsed(item.id), className: 'bg-gray-800 hover:bg-gray-700 text-white text-sm py-1.5 px-3 rounded'}, 'Used up'),
                React.createElement('button', {onClick: () => markDiscarded(item.id), className: 'bg-gray-800 hover:bg-red-900 text-white text-sm py-1.5 px-3 rounded'}, 'Discard'),
                React.createElement('select', {value: item.location, onChange: (e: any) => changeLocation(item.id, e.target.value), className: 'bg-gray-800 text-white text-sm py-1.5 px-3 rounded'},
                  React.createElement('option', {value: 'fridge'}, 'Fridge'),
                  React.createElement('option', {value: 'freezer'}, 'Freezer'),
                  React.createElement('option', {value: 'cupboard'}, 'Cupboard'),
                  React.createElement('option', {value: 'other'}, 'Other')
                )
              )
            )
          })
        )
  )
}