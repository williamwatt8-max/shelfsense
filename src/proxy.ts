import { NextRequest, NextResponse } from 'next/server'

// Derive the expected Supabase auth cookie prefix from the project URL.
// @supabase/ssr stores the session as sb-<project-ref>-auth-token[.chunk]
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const PROJECT_REF  = SUPABASE_URL.replace('https://', '').split('.')[0]
const AUTH_COOKIE  = `sb-${PROJECT_REF}-auth-token`

function hasSession(req: NextRequest): boolean {
  // Cookie may be chunked: sb-...-auth-token, sb-...-auth-token.0, etc.
  return req.cookies.getAll().some(c => c.name.startsWith(AUTH_COOKIE))
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow: auth page, Next.js internals, static files
  if (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Optimistic check — reads the auth cookie, no network call
  if (!hasSession(req)) {
    return NextResponse.redirect(new URL('/auth', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.png$).*)'],
}
