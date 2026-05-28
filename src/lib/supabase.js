import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in .env.local (dev) or Vercel env vars (production).');
}

export const supabase = createClient(url || '', anonKey || '', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ============ AUTH ============
export async function signUp({ email, password, name }) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const userId = data.user?.id;
  if (userId && name) {
    await supabase.from('profiles').upsert({ id: userId, name });
  }
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  if (!data?.user) return null;
  const { data: profile } = await supabase.from('profiles').select('name').eq('id', data.user.id).maybeSingle();
  return {
    id: data.user.id,
    email: data.user.email,
    name: profile?.name || data.user.email.split('@')[0],
    createdAt: data.user.created_at
  };
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_evt, session) => cb(session));
}

// ============ PLACES ============
function rowToPlace(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || '',
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    category: row.category,
    categoryOverride: row.category_override,
    region: row.region || null,
    subtype: row.subtype || null,
    hasPhoto: !!row.photo,
    photo: row.photo,
    createdAt: new Date(row.created_at).getTime()
  };
}

export async function fetchPlaces() {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToPlace);
}

export async function createPlace({ name, notes, lat, lng, accuracy, category, categoryOverride, photo, region, subtype }) {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('places')
    .insert({
      user_id: userId,
      name, notes: notes || '', lat, lng, accuracy,
      category, category_override: categoryOverride || null,
      region: region || null,
      subtype: subtype || null,
      photo: photo || null
    })
    .select()
    .single();
  if (error) throw error;
  return rowToPlace(data);
}

export async function updatePlace(id, { name, notes, categoryOverride, subtype, photo }) {
  const patch = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (notes !== undefined) patch.notes = notes;
  if (categoryOverride !== undefined) patch.category_override = categoryOverride;
  if (subtype !== undefined) patch.subtype = subtype;
  if (photo !== undefined) patch.photo = photo;
  const { data, error } = await supabase
    .from('places')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToPlace(data);
}

export async function deletePlace(id) {
  const { error } = await supabase.from('places').delete().eq('id', id);
  if (error) throw error;
}

// ============ REVERSE GEOCODING (free, via OpenStreetMap Nominatim) ============
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=en`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const state = a.state || a.region || a.province || a['state_district'] || null;
    const country = a.country || null;
    if (state && country) return `${state}, ${country}`;
    if (country) return country;
    return null;
  } catch (e) {
    console.warn("reverseGeocode failed:", e);
    return null;
  }
}

// ============ ASK (calls our serverless function) ============
export async function callAsk({ system, messages, max_tokens }) {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, max_tokens })
  });
  if (!res.ok) throw new Error(`Ask failed (${res.status})`);
  return res.json();
}
