export type InventoryStatus = 'active' | 'used' | 'discarded' | 'expired'
export type StorageLocation = 'fridge' | 'freezer' | 'cupboard' | 'other' | 'household'
export type EventType = 'added' | 'used' | 'used_some' | 'moved' | 'discarded' | 'expired' | 'opened'
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
name: string
quantity: number
unit: string
location: StorageLocation
category: string | null
purchase_date: string
expiry_date: string | null
opened_at: string | null
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