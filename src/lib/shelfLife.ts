// Opened shelf life table — days remaining after opening
// Used when marking an item as opened to suggest a new expiry date.

export type ShelfLifeEntry = { min: number; max: number }

// Specific item matches — keyed by normalised lowercase name.
// Longer/more-specific keys are tried first (sorted by length at lookup time).
const itemShelfLife: Record<string, ShelfLifeEntry> = {
  // ── Dairy: milk ──────────────────────────────────────────────────────────
  'semi-skimmed milk':     { min: 3,   max: 5   },
  'skimmed milk':          { min: 3,   max: 5   },
  'whole milk':            { min: 3,   max: 5   },
  'oat milk':              { min: 7,   max: 10  },
  'almond milk':           { min: 7,   max: 10  },
  'soy milk':              { min: 7,   max: 10  },
  'rice milk':             { min: 7,   max: 10  },
  'milk':                  { min: 3,   max: 5   },

  // ── Dairy: cream ─────────────────────────────────────────────────────────
  'double cream':          { min: 3,   max: 5   },
  'single cream':          { min: 3,   max: 5   },
  'whipping cream':        { min: 3,   max: 5   },
  'clotted cream':         { min: 5,   max: 7   },
  'soured cream':          { min: 7,   max: 14  },
  'sour cream':            { min: 7,   max: 14  },
  'creme fraiche':         { min: 7,   max: 14  },
  'crème fraîche':         { min: 7,   max: 14  },
  'cream':                 { min: 3,   max: 5   },

  // ── Dairy: butter & soft cheese ──────────────────────────────────────────
  'butter':                { min: 14,  max: 21  },
  'cream cheese':          { min: 10,  max: 14  },
  'cottage cheese':        { min: 5,   max: 7   },
  'ricotta':               { min: 3,   max: 5   },
  'mascarpone':            { min: 5,   max: 7   },
  'quark':                 { min: 7,   max: 10  },

  // ── Dairy: yogurt ────────────────────────────────────────────────────────
  'greek yogurt':          { min: 5,   max: 7   },
  'greek yoghurt':         { min: 5,   max: 7   },
  'natural yogurt':        { min: 5,   max: 7   },
  'natural yoghurt':       { min: 5,   max: 7   },
  'yogurt':                { min: 3,   max: 5   },
  'yoghurt':               { min: 3,   max: 5   },

  // ── Dairy: hard & semi-hard cheese ───────────────────────────────────────
  'mature cheddar':        { min: 21,  max: 28  },
  'extra mature cheddar':  { min: 28,  max: 42  },
  'mild cheddar':          { min: 14,  max: 21  },
  'cheddar':               { min: 14,  max: 28  },
  'parmesan':              { min: 28,  max: 42  },
  'parmigiano':            { min: 28,  max: 42  },
  'grana padano':          { min: 28,  max: 42  },
  'pecorino':              { min: 21,  max: 35  },
  'gruyère':               { min: 14,  max: 21  },
  'emmental':              { min: 14,  max: 21  },
  'gouda':                 { min: 14,  max: 21  },
  'edam':                  { min: 14,  max: 21  },
  'red leicester':         { min: 14,  max: 21  },
  'double gloucester':     { min: 14,  max: 21  },
  'stilton':               { min: 14,  max: 21  },
  'wensleydale':           { min: 14,  max: 21  },

  // ── Dairy: soft/fresh cheese ─────────────────────────────────────────────
  'brie':                  { min: 5,   max: 7   },
  'camembert':             { min: 5,   max: 7   },
  'mozzarella':            { min: 3,   max: 5   },
  'burrata':               { min: 2,   max: 3   },
  'feta':                  { min: 5,   max: 7   },
  'halloumi':              { min: 3,   max: 5   },

  // ── Eggs ─────────────────────────────────────────────────────────────────
  'free range eggs':       { min: 21,  max: 28  },
  'organic eggs':          { min: 21,  max: 28  },
  'eggs':                  { min: 21,  max: 28  },

  // ── Meat & poultry ───────────────────────────────────────────────────────
  'cooked chicken':        { min: 2,   max: 3   },
  'chicken breast':        { min: 1,   max: 2   },
  'chicken thigh':         { min: 1,   max: 2   },
  'chicken':               { min: 1,   max: 2   },
  'turkey':                { min: 1,   max: 2   },
  'beef mince':            { min: 1,   max: 2   },
  'lamb mince':            { min: 1,   max: 2   },
  'pork mince':            { min: 1,   max: 2   },
  'mince':                 { min: 1,   max: 2   },
  'beef':                  { min: 1,   max: 2   },
  'lamb':                  { min: 1,   max: 2   },
  'pork':                  { min: 1,   max: 2   },
  'duck':                  { min: 1,   max: 2   },
  'venison':               { min: 1,   max: 2   },

  // ── Deli / processed meat ────────────────────────────────────────────────
  'smoked salmon':         { min: 3,   max: 5   },
  'back bacon':            { min: 5,   max: 7   },
  'streaky bacon':         { min: 5,   max: 7   },
  'bacon':                 { min: 5,   max: 7   },
  'cooked ham':            { min: 3,   max: 5   },
  'ham':                   { min: 3,   max: 5   },
  'prosciutto':            { min: 3,   max: 5   },
  'salami':                { min: 14,  max: 21  },
  'chorizo':               { min: 7,   max: 14  },
  'sausages':              { min: 3,   max: 5   },

  // ── Fish & seafood ───────────────────────────────────────────────────────
  'salmon':                { min: 1,   max: 2   },
  'cod':                   { min: 1,   max: 2   },
  'haddock':               { min: 1,   max: 2   },
  'sea bass':              { min: 1,   max: 2   },
  'tuna steak':            { min: 1,   max: 2   },
  'tuna':                  { min: 1,   max: 2   },
  'prawns':                { min: 1,   max: 2   },
  'shrimp':                { min: 1,   max: 2   },
  'scallops':              { min: 1,   max: 2   },
  'mussels':               { min: 1,   max: 2   },

  // ── Bread & bakery ───────────────────────────────────────────────────────
  'sourdough':             { min: 5,   max: 7   },
  'bread':                 { min: 4,   max: 7   },
  'pitta':                 { min: 5,   max: 7   },
  'bagel':                 { min: 3,   max: 5   },
  'croissant':             { min: 2,   max: 3   },

  // ── Fresh produce ─────────────────────────────────────────────────────────
  'avocado':               { min: 1,   max: 3   },
  'mixed salad':           { min: 3,   max: 5   },
  'salad leaves':          { min: 3,   max: 5   },
  'baby spinach':          { min: 3,   max: 5   },
  'spinach':               { min: 3,   max: 5   },
  'lettuce':               { min: 3,   max: 5   },
  'rocket':                { min: 3,   max: 5   },
  'watercress':            { min: 3,   max: 5   },
  'fresh herbs':           { min: 5,   max: 7   },
  'basil':                 { min: 5,   max: 7   },
  'coriander':             { min: 5,   max: 7   },
  'parsley':               { min: 5,   max: 7   },
  'fresh pasta':           { min: 2,   max: 3   },

  // ── Drinks ───────────────────────────────────────────────────────────────
  'sparkling wine':        { min: 1,   max: 2   },
  'prosecco':              { min: 1,   max: 2   },
  'champagne':             { min: 1,   max: 3   },
  'red wine':              { min: 3,   max: 5   },
  'white wine':            { min: 3,   max: 5   },
  'rosé wine':             { min: 3,   max: 5   },
  'rose wine':             { min: 3,   max: 5   },
  'wine':                  { min: 3,   max: 5   },
  'real ale':              { min: 2,   max: 3   },
  'beer':                  { min: 1,   max: 2   },
  'lager':                 { min: 1,   max: 2   },
  'orange juice':          { min: 5,   max: 7   },
  'apple juice':           { min: 7,   max: 10  },
  'fruit juice':           { min: 5,   max: 7   },
  'smoothie':              { min: 3,   max: 5   },

  // ── Condiments & sauces ──────────────────────────────────────────────────
  'salad dressing':        { min: 14,  max: 30  },
  'vinaigrette':           { min: 14,  max: 30  },
  'mayonnaise':            { min: 60,  max: 90  },
  'hollandaise':           { min: 1,   max: 2   },
  'tomato ketchup':        { min: 30,  max: 45  },
  'ketchup':               { min: 30,  max: 45  },
  'brown sauce':           { min: 30,  max: 45  },
  'hp sauce':              { min: 30,  max: 45  },
  'worcestershire sauce':  { min: 90,  max: 180 },
  'soy sauce':             { min: 90,  max: 180 },
  'fish sauce':            { min: 90,  max: 180 },
  'oyster sauce':          { min: 30,  max: 60  },
  'hoisin sauce':          { min: 30,  max: 60  },
  'sriracha':              { min: 90,  max: 180 },
  'hot sauce':             { min: 90,  max: 180 },
  'bbq sauce':             { min: 30,  max: 45  },
  'sweet chilli sauce':    { min: 30,  max: 60  },
  'pasta sauce':           { min: 3,   max: 5   },
  'salsa':                 { min: 5,   max: 10  },
  'guacamole':             { min: 2,   max: 3   },
  'hummus':                { min: 4,   max: 7   },
  'tzatziki':              { min: 3,   max: 5   },
  'pesto':                 { min: 5,   max: 7   },
  'tahini':                { min: 30,  max: 60  },
  'mustard':               { min: 60,  max: 90  },
  'horseradish':           { min: 30,  max: 45  },
  'mint sauce':            { min: 14,  max: 21  },
  'cranberry sauce':       { min: 7,   max: 14  },
  'apple sauce':           { min: 7,   max: 14  },

  // ── Spreads & oils ───────────────────────────────────────────────────────
  'strawberry jam':        { min: 90,  max: 180 },
  'raspberry jam':         { min: 90,  max: 180 },
  'marmalade':             { min: 90,  max: 180 },
  'jam':                   { min: 90,  max: 180 },
  'marmite':               { min: 180, max: 365 },
  'peanut butter':         { min: 60,  max: 90  },
  'almond butter':         { min: 60,  max: 90  },
  'nut butter':            { min: 60,  max: 90  },
  'nutella':               { min: 60,  max: 90  },
  'honey':                 { min: 365, max: 730 },
  'maple syrup':           { min: 90,  max: 365 },
  'golden syrup':          { min: 90,  max: 365 },
  'olive oil':             { min: 60,  max: 90  },

  // ── Dairy alternatives & other fresh ─────────────────────────────────────
  'tofu':                  { min: 3,   max: 5   },
  'hummus':                { min: 4,   max: 7   },
}

// Category fallbacks — matched when no specific item key matches
const categoryShelfLife: Record<string, ShelfLifeEntry> = {
  'dairy':       { min: 5,  max: 10 },
  'milk':        { min: 3,  max: 5  },
  'cheese':      { min: 7,  max: 21 },
  'meat':        { min: 1,  max: 2  },
  'poultry':     { min: 1,  max: 2  },
  'fish':        { min: 1,  max: 2  },
  'seafood':     { min: 1,  max: 2  },
  'deli':        { min: 3,  max: 5  },
  'produce':     { min: 3,  max: 5  },
  'bakery':      { min: 3,  max: 7  },
  'condiments':  { min: 30, max: 90 },
  'sauces':      { min: 7,  max: 30 },
  'beverages':   { min: 3,  max: 7  },
  'drinks':      { min: 3,  max: 7  },
  'alcohol':     { min: 2,  max: 5  },
  'fresh':       { min: 3,  max: 5  },
  'chilled':     { min: 3,  max: 7  },
}

/**
 * Look up how long an item typically lasts after opening.
 * Tries specific item keys first (longest match first), then category fallback.
 * Returns null if no data found.
 */
export function lookupShelfLife(name: string, category: string | null): ShelfLifeEntry | null {
  const n = name.toLowerCase().trim()

  // Exact match
  if (n in itemShelfLife) return itemShelfLife[n]

  // Partial match — try longer (more specific) keys first
  const sortedKeys = Object.keys(itemShelfLife).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (n.includes(key)) return itemShelfLife[key]
  }

  // Category fallback
  if (category) {
    const cat = category.toLowerCase()
    for (const [key, val] of Object.entries(categoryShelfLife)) {
      if (cat.includes(key)) return val
    }
  }

  return null
}
