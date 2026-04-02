import { StorageLocation } from './types'

// ── Keyword lists ────────────────────────────────────────────────────────────
// Each list is checked in priority order: household > freezer > fridge > cupboard

const HOUSEHOLD_TERMS = [
  // Cleaning products
  'bleach', 'disinfectant', 'antibacterial', 'surface cleaner', 'bathroom cleaner',
  'toilet cleaner', 'toilet duck', 'oven cleaner', 'floor cleaner', 'glass cleaner',
  'multi-purpose cleaner', 'multipurpose cleaner', 'washing up liquid', 'dish soap',
  'fairy liquid', 'fairy', 'flash', 'dettol', 'domestos', 'cillit', 'mr muscle',
  'zoflora', 'pine disinfectant',
  // Laundry & dishwasher
  'washing powder', 'washing liquid', 'laundry liquid', 'laundry powder',
  'washing capsule', 'laundry capsule', 'laundry detergent', 'fabric conditioner',
  'fabric softener', 'comfort', 'lenor',
  'dishwasher tablet', 'dishwasher pod', 'dishwasher salt', 'rinse aid',
  // Personal care
  'shampoo', 'shower gel', 'body wash', 'hand soap', 'hand wash',
  'face wash', 'face cream', 'moisturiser', 'moisturizer', 'body lotion', 'body cream',
  'deodorant', 'antiperspirant', 'roll-on',
  'toothpaste', 'toothbrush', 'mouthwash', 'dental floss', 'floss',
  'razor', 'shaving foam', 'shaving gel', 'aftershave',
  'cotton wool', 'cotton pad', 'cotton bud', 'q-tip',
  'perfume', 'cologne', 'fragrance',
  'nail varnish', 'nail polish', 'nail remover',
  'hair dye', 'hair colour', 'hair color',
  // Paper & bags
  'kitchen roll', 'kitchen paper', 'toilet roll', 'toilet paper', 'loo roll',
  'tissue', 'tissues', 'paper towel', 'napkin', 'kitchen towel',
  'bin bag', 'bin liner', 'carrier bag', 'shopping bag', 'plastic bag',
  'sandwich bag', 'freezer bag', 'food bag', 'zip lock', 'ziploc',
  'cling film', 'clingfilm', 'tin foil', 'aluminium foil', 'aluminum foil',
  'baking paper', 'baking parchment', 'greaseproof paper', 'parchment paper',
  'baking foil',
  // Baby & health
  'nappy', 'nappies', 'diaper', 'baby wipe', 'wet wipe',
  'plaster', 'bandage', 'antiseptic cream', 'antiseptic wipe',
  // Household misc
  'candle', 'air freshener', 'reed diffuser', 'plug-in',
  'lightbulb', 'light bulb', 'battery', 'batteries',
  'sponge', 'scrubbing pad', 'scourer', 'microfibre cloth', 'cleaning cloth',
  'mop', 'dust bag', 'hoover bag',
  'washing up gloves', 'rubber gloves',
  'clothes peg', 'coat hanger',
]

const FREEZER_TERMS = [
  'frozen', 'ice cream', 'ice lolly', 'ice lollies', 'ice pop',
  'sorbet', 'gelato', 'magnum', 'cornetto',
  'fish finger', 'fish cake', 'fishcake', 'fish pie', 'fish fillet (frozen)',
  'potato waffle', 'oven chips', 'hash brown', 'hash browns',
  'frozen peas', 'frozen sweetcorn', 'frozen corn', 'frozen veg', 'frozen vegetables',
  'frozen pizza', 'frozen meal', 'frozen ready meal',
  'frozen chicken', 'frozen fish',
  'waffles',
]

const FRIDGE_TERMS = [
  // Dairy: milk
  'milk', 'semi-skimmed', 'skimmed milk', 'whole milk',
  'oat milk', 'almond milk', 'soy milk', 'soya milk', 'rice milk', 'coconut milk drink',
  // Dairy: cream & butter
  'cream', 'double cream', 'single cream', 'whipping cream', 'clotted cream',
  'soured cream', 'sour cream', 'creme fraiche', 'crème fraîche',
  'butter', 'spreadable butter', 'lurpak', 'anchor butter',
  // Dairy: cheese
  'cheddar', 'mozzarella', 'brie', 'camembert', 'parmesan', 'parmigiano',
  'feta', 'halloumi', 'stilton', 'wensleydale', 'gouda', 'edam',
  'red leicester', 'double gloucester', 'gruyère', 'emmental',
  'cream cheese', 'cottage cheese', 'ricotta', 'mascarpone', 'quark',
  'goat cheese', "goat's cheese", 'goats cheese',
  'string cheese', 'babybel',
  // Dairy: yogurt & dessert
  'yogurt', 'yoghurt', 'fromage frais', 'custard', 'rice pudding (chilled)',
  // Eggs
  'eggs', 'free range eggs', 'organic eggs',
  // Meat & poultry
  'chicken breast', 'chicken thigh', 'chicken leg', 'chicken fillet', 'chicken wing',
  'chicken', 'turkey', 'duck breast', 'duck', 'venison', 'rabbit',
  'beef mince', 'lamb mince', 'pork mince', 'mince',
  'steak', 'sirloin', 'rump steak', 'ribeye', 'fillet steak',
  'beef', 'pork', 'lamb chop', 'lamb', 'pork chop', 'pork loin',
  // Deli & processed meat
  'bacon', 'back bacon', 'streaky bacon',
  'ham', 'cooked ham', 'sliced ham', 'gammon',
  'salami', 'chorizo', 'pepperoni', 'prosciutto', 'pancetta', 'lardons', 'lardoons',
  'sausage', 'sausages', 'chipolata', 'bratwurst',
  'pâté', 'pate',
  'smoked salmon', 'gravadlax',
  // Fish & seafood
  'salmon', 'cod', 'haddock', 'sea bass', 'trout', 'tuna steak',
  'mackerel', 'sardines', 'anchovies',
  'prawns', 'shrimp', 'scallops', 'mussels', 'squid', 'crab',
  // Fresh produce (chilled)
  'lettuce', 'salad leaves', 'mixed salad', 'rocket', 'watercress',
  'baby spinach', 'spinach', 'kale',
  'cucumber', 'celery', 'spring onion', 'radish',
  'fresh herbs', 'fresh basil', 'fresh coriander', 'fresh parsley', 'fresh mint',
  'fresh chilli', 'fresh ginger', 'fresh turmeric',
  'avocado',
  // Fresh pasta, tofu, chilled dips
  'fresh pasta', 'fresh gnocchi', 'fresh noodles',
  'tofu', 'tempeh', 'quorn', 'linda mccartney',
  'hummus', 'tzatziki', 'guacamole', 'taramasalata', 'houmous',
  // Chilled drinks (fresh)
  'fresh orange juice', 'freshly squeezed', 'cold press juice',
  // Chilled ready meals / soups
  'ready meal', 'chilled ready meal', 'soup (chilled)', 'fresh soup',
  'cooked chicken', 'rotisserie chicken',
  'fresh pizza', 'chilled pizza',
]

/**
 * Suggest a storage location for an item based on its name and AI-assigned category.
 * Applied automatically when receipt items are loaded on the review screen.
 */
export function suggestLocation(name: string, category: string | null): StorageLocation {
  const n = name.toLowerCase().trim()
  const c = (category || '').toLowerCase().trim()

  // 1. Household — highest priority (non-food items)
  for (const term of HOUSEHOLD_TERMS) {
    if (n.includes(term) || c.includes(term)) return 'household'
  }
  if (
    c.includes('household') || c.includes('cleaning') || c.includes('personal care') ||
    c.includes('health & beauty') || c.includes('health and beauty') ||
    c.includes('toiletries') || c.includes('baby') || c.includes('laundry') ||
    c.includes('paper products') || c.includes('stationery')
  ) return 'household'

  // 2. Freezer
  for (const term of FREEZER_TERMS) {
    if (n.includes(term) || c.includes(term)) return 'freezer'
  }
  if (c.includes('frozen')) return 'freezer'

  // 3. Fridge (fresh/chilled)
  for (const term of FRIDGE_TERMS) {
    if (n.includes(term)) return 'fridge'
  }
  if (
    c.includes('dairy') || c.includes('meat') || c.includes('fish') ||
    c.includes('seafood') || c.includes('deli') || c.includes('fresh') ||
    c.includes('chilled') || c.includes('produce') || c.includes('eggs') ||
    c.includes('poultry')
  ) return 'fridge'

  // 4. Default: cupboard (dry goods, tins, snacks, ambient drinks, condiments)
  return 'cupboard'
}
