export type InventoryStatus   = 'active' | 'used' | 'discarded' | 'expired' | 'removed'
export type StorageLocation   = 'fridge' | 'freezer' | 'cupboard' | 'other' | 'household'
export type EventType         = 'added' | 'used' | 'used_some' | 'moved' | 'discarded' | 'expired' | 'opened'
export type InventorySource   = 'receipt' | 'manual' | 'barcode' | 'voice'

export type Receipt = {
  id: string
  user_id: string | null
  retailer_name: string | null
  purchase_datetime: string
  raw_text: string | null
  image_url: string | null
  total: number | null
  created_at: string
}

export type ReceiptItem = {
  id: string
  receipt_id: string
  raw_text: string | null
  normalized_name: string
  quantity: number
  unit: string
  category: string | null
  confidence: number
  price: number | null
  created_at: string
}

export type InventoryItem = {
  id: string
  user_id: string | null
  receipt_item_id: string | null
  // How the item was added to inventory
  source: InventorySource
  name: string
  // quantity = current remaining; quantity_original = amount at first save
  quantity: number
  quantity_original: number | null
  unit: string
  location: StorageLocation
  category: string | null
  // Stored directly. For receipt items: copied from receipt at save time.
  // For manual/voice/barcode items: user-supplied or null.
  retailer: string | null
  purchase_date: string | null
  expiry_date: string | null
  opened_at: string | null
  opened_expiry_days: number | null
  status: InventoryStatus
  created_at: string
  updated_at: string
}

export type InventoryEvent = {
  id: string
  inventory_item_id: string
  type: EventType
  quantity_delta: number | null
  notes: string | null
  created_at: string
}

export type ReviewItem = {
  id: string
  name: string
  normalized_name: string
  quantity: number
  unit: string
  location: StorageLocation
  category: string | null
  expiry_date: string | null
  selected: boolean
  confidence: number
  price: number | null
}

export type ParsedReceiptItem = {
  raw_text: string
  normalized_name: string
  quantity: number
  unit: string
  category: string
  confidence: number
  price: number | null
}

export type ParsedReceipt = {
  retailer_name: string
  total: number | null
  items: ParsedReceiptItem[]
}
