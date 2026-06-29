// Firebase already tracks every auth method linked to a user in
// `providerData` — no separate Firestore flag needed (it would just risk
// drifting out of sync with the real linked credentials).
export function hasPasswordCredential(user) {
  return !!user?.providerData?.some((p) => p.providerId === 'password')
}

// A teacher who signed in with at least one provider (Google) but has no
// password credential yet still depends on that provider to reach a shared
// computer — they haven't "protected" their account with a fallback method.
export function needsPasswordSetup(user) {
  return !!user && (user.providerData?.length || 0) > 0 && !hasPasswordCredential(user)
}
