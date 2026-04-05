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
  // count = number of individual units (e.g. 6 cans); amount_per_unit = size of each (e.g. 330 ml)
  count: number | null
  amount_per_unit: number | null
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
  receipt_order: number     // index from parser — never re-sorted
  name: string
  normalized_name: string
  quantity: number          // count (how many units)
  amount_per_unit: number | null  // size of each unit (e.g. 330 for 330ml)
  unit: string              // measurement unit for amount_per_unit
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

export type Recipe = {
  id: string
  user_id: string | null
  name: string
  base_servings: number
  instructions: string | null
  source: 'manual' | 'scanned'
  raw_text: string | null
  created_at: string
  updated_at: string
}

export type RecipeIngredient = {
  id: string
  recipe_id: string
  name: string
  quantity: number
  unit: string
  created_at: string
}

export type ShoppingListItem = {
  id: string
  user_id: string | null
  name: string
  quantity: number
  unit: string
  checked: boolean
  recipe_id: string | null
  notes: string | null
  created_at: string
}
