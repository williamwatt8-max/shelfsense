import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const RECIPE_PROMPT = `You are parsing a recipe from a cookbook page, handwritten recipe card, or recipe screenshot.

STEP 1 — RECIPE NAME
Find the recipe title. If unclear, infer from the dish being described.

STEP 2 — SERVINGS
Find the number of servings/portions/yields. Default to 2 if not stated.

STEP 3 — INGREDIENTS
Extract every ingredient with its exact quantity and unit.

STEP 4 — INSTRUCTIONS
If short instructions are visible (under ~300 words), include them as plain text. If very long or not visible, set to null.

OUTPUT — Return ONLY raw JSON, no markdown, no code fences:
{
  "name": "Spaghetti Carbonara",
  "base_servings": 4,
  "instructions": "Cook pasta until al dente...",
  "raw_text": "verbatim text from image",
  "ingredients": [
    { "name": "spaghetti", "quantity": 400, "unit": "g" },
    { "name": "guanciale", "quantity": 200, "unit": "g" },
    { "name": "egg yolks", "quantity": 4, "unit": "item" },
    { "name": "parmesan", "quantity": 50, "unit": "g" },
    { "name": "black pepper", "quantity": 1, "unit": "to taste" }
  ]
}

RULES:
- name: title-cased recipe name
- base_servings: integer (default 2)
- ingredients[].name: lowercase, normalized (e.g. "plain flour", "unsalted butter", "free range eggs")
- ingredients[].quantity: numeric (0.25, 0.5, 1, 2.5, etc.)
- ingredients[].unit — normalize to: g | kg | ml | l | tsp | tbsp | item | cup | clove | bunch | sprig | pinch | to taste | sheet | slice
  - "teaspoon"/"tsp" → "tsp"
  - "tablespoon"/"tbsp" → "tbsp"
  - "piece(s)", "whole", no unit → "item"
  - "to taste", "as needed", "optional" → quantity=1, unit="to taste"
  - DO NOT use vague units like "some" or "a bit"
- raw_text: verbatim text from image (best effort)
- instructions: plain text, newlines allowed, null if not visible`

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('image') as File
    if (!file) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
    if (file.type === 'image/png')  mediaType = 'image/png'
    if (file.type === 'image/webp') mediaType = 'image/webp'

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: RECIPE_PROMPT },
        ],
      }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    try {
      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed.ingredients)) parsed.ingredients = []

      parsed.ingredients = parsed.ingredients.map((ing: any) => ({
        name:     String(ing.name || '').toLowerCase().trim(),
        quantity: Number(ing.quantity) || 1,
        unit:     String(ing.unit || 'item').toLowerCase().trim(),
      })).filter((ing: any) => ing.name.length > 0)

      return NextResponse.json({
        name:          String(parsed.name || 'Untitled Recipe'),
        base_servings: parseInt(parsed.base_servings) || 2,
        instructions:  parsed.instructions ? String(parsed.instructions) : null,
        raw_text:      parsed.raw_text ? String(parsed.raw_text) : null,
        ingredients:   parsed.ingredients,
      })
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const salvaged = JSON.parse(jsonMatch[0])
          if (!Array.isArray(salvaged.ingredients)) salvaged.ingredients = []
          return NextResponse.json(salvaged)
        } catch {}
      }
      return NextResponse.json(
        { error: 'Could not read recipe — try a clearer photo with better lighting.' },
        { status: 422 }
      )
    }
  } catch (error: any) {
    console.error('parse-recipe error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to parse recipe' }, { status: 500 })
  }
}
