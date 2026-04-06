import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { transcript, items } = await req.json()
    if (!transcript || !items) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const today = new Date().toISOString().split('T')[0]

    // Detect numbered format: items is [{index, name}, ...]
    const isNumbered = Array.isArray(items) && items.length > 0 && typeof items[0] === 'object' && 'index' in items[0]

    if (isNumbered) {
      // Numbered format: user says "1 tomorrow, 2 Sunday, 4 three days"
      const numberedItems = items as { index: number; name: string }[]
      const itemList = numberedItems.map(i => `${i.index}. ${i.name}`).join('\n')

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Today is ${today}. The user spoke expiry dates for numbered items on a receipt.

Numbered items:
${itemList}

The user said: "${transcript}"

Parse the user's speech and map each mentioned item NUMBER to its expiry date.
The user may say things like:
- "1 tomorrow, 2 Sunday, 4 three days"
- "number 1 use by Friday, 3 expires Monday"
- "one tomorrow two next week"

Interpret natural language dates relative to today (${today}):
- "tomorrow" → today + 1 day
- "Sunday" / "next Sunday" → the coming Sunday
- "in 3 days" / "three days" → today + 3 days
- "a week" / "next week" → today + 7 days
- "use by the 10th" → 10th of current or next month

Return ONLY raw JSON — no markdown, no code fences:
{"assignments":[{"index":1,"expiry_date":"YYYY-MM-DD","confidence":0.9}]}`
        }]
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      return NextResponse.json(JSON.parse(cleaned))

    } else {
      // Legacy name-based format: items is string[]
      const nameList = (items as string[])

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Today is ${today}. You are parsing a voice sentence to extract expiry dates for grocery items.

The user said: "${transcript}"

Items on the receipt: ${JSON.stringify(nameList)}

Extract every item-expiry pair mentioned. Match item names to the closest item in the provided list.
Interpret natural language dates relative to today (${today}):
- "in 3 days" → today + 3 days
- "3 weeks" → today + 21 days
- "next Sunday" → the coming Sunday
- "good until Tuesday" → the coming Tuesday
- "use by the 10th" → the 10th of the current or next month
- "a week" → today + 7 days

Only include matches with confidence >= 0.6.

Return ONLY raw JSON — no markdown, no code fences:
{"matches":[{"item_name":"closest item name from the list","expiry_date":"YYYY-MM-DD","confidence":0.9}]}`
        }]
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      return NextResponse.json(JSON.parse(cleaned))
    }
  } catch (error: any) {
    console.error('voice-expiry error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to process voice expiry' }, { status: 500 })
  }
}
