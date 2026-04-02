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
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Today is ${today}. You are a voice command interpreter for a food inventory app.

The user said: "${transcript}"

Available inventory items: ${JSON.stringify(items)}

Interpret the command and return JSON. Actions:
- used_all: consumed the entire item
- used_partial: used some (extract quantity if mentioned)
- discard: throw away / got rid of
- set_expiry: setting or updating an expiry date
- mark_opened: just opened the item

For set_expiry, calculate expiry_date as YYYY-MM-DD from today (${today}).
For used_partial, quantity is a number and unit is a string.
Confidence is 0-1. Use < 0.5 if you cannot match an item or understand the command.

Return ONLY raw JSON — no markdown, no code fences:
{"matched_item":"closest item name from the list","action":"used_all","quantity":null,"unit":null,"expiry_date":null,"confidence":0.9,"display_text":"Human-readable summary, e.g. Mark chicken breast as used up"}

If you cannot match confidently, return:
{"matched_item":null,"action":null,"quantity":null,"unit":null,"expiry_date":null,"confidence":0,"display_text":null}`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return NextResponse.json(JSON.parse(cleaned))
  } catch (error: any) {
    console.error('voice-update error:', error.message)
    return NextResponse.json({ error: error.message || 'Failed to process voice command' }, { status: 500 })
  }
}
