import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('receipt') as File

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg'
    if (file.type === 'image/png') mediaType = 'image/png'
    if (file.type === 'image/webp') mediaType = 'image/webp'

    const message = await anthropic.messages.create({
model: 'claude-haiku-4-5-20251001',      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Extract ALL items from this receipt as JSON. Include everything that was purchased, including bags, alcohol, and non-food items.

IMPORTANT: Use the price to help identify items. For example "CLASSICS PG" at £9+ is Pinot Grigio wine, not PG Tips tea. A £0.25 item is likely a carrier bag. Think about what makes sense given the price.

Return ONLY raw JSON, no markdown, no code fences:

{"retailer_name":"Store","items":[{"raw_text":"TEXT ON RECEIPT","normalized_name":"Clear Name","quantity":1,"unit":"item","category":"dairy","confidence":0.9,"price":1.99}]}

Units: item, g, kg, ml, l, bottle, tin, loaf, pack, bag, head, fillet
Categories: dairy, meat, fish, vegetables, fruit, bakery, tinned, dry goods, oils, frozen, drinks, snacks, alcohol, household, other
Include a price field with the item price as a number.
Skip subtotals, payment lines, and change lines.
Return ONLY the JSON.`,
            },
          ],
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    try {
      const parsed = JSON.parse(cleaned)
      return NextResponse.json(parsed)
    } catch {
      console.error('Failed to parse JSON:', cleaned.substring(0, 500))
      return NextResponse.json({ error: 'AI returned invalid data. Please try again.' }, { status: 500 })
    }
  } catch (error: any) {
    console.error('API Error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to parse receipt' }, { status: 500 })
  }
}