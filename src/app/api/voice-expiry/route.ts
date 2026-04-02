import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { transcript, items } = await req.json()
    if (!transcript || !items) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const today = new Date().toISOString().split('T')[0]

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Today is ${today}. You are parsing a voice sentence to extract expiry dates for grocery items.

The user said: "${transcript}"

Items on the receipt: ${JSON.stringify(items)}

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
  } catch (error: any) {
    console.error('voice-expiry error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to process voice expiry' }, { status: 500 })
  }
}
