import { supabase } from './supabase'

export async function signUp(email: string, password: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl}/auth` },
  })
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}
