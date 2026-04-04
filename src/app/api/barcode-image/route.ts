import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Extracts a barcode number from a photo using Claude vision.
// Used as fallback for browsers that don't support BarcodeDetector (e.g. iOS Safari).
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('image') as File
    if (!file) return NextResponse.json({ found: false, reason: 'no image' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
    if (file.type === 'image/png') mediaType = 'image/png'
    if (file.type === 'image/webp') mediaType = 'image/webp'

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          {
            type: 'text',
            text: 'Read the barcode in this image. Return ONLY the raw digits (EAN-13, EAN-8, UPC-A, or similar barcode number). No other text. If no barcode is visible, return "none".',
          },
        ],
      }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const digits = raw.replace(/\s/g, '')

    if (!digits || digits.toLowerCase() === 'none' || !/^\d{6,14}$/.test(digits)) {
      return NextResponse.json({ found: false, reason: 'no barcode detected' })
    }

    return NextResponse.json({ found: true, barcode: digits })
  } catch (error: any) {
    console.error('barcode-image error:', error.message)
    return NextResponse.json({ found: false, reason: 'error' })
  }
}
