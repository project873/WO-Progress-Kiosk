// ============================================================
// libs/db-storage.js — Supabase Storage (wo-files bucket) operations
//
// Extracted from db.js to keep files under 500 lines.
// Files are keyed by Part # so the same print is shared across all WOs.
// Storage path: {sanitized_part_number}/{filename}
// ============================================================

import { supabase } from './db-shared.js';
import { sanitizePartKey } from './utils.js';
import { KIOSK_USER_MAP } from './config.js';

// Sign in anonymously so storage RLS (authenticated role) grants access.
// Called once on app load. Safe to call repeatedly — Supabase reuses the session.
export async function signInAnonymously() {
    const { error } = await supabase.auth.signInAnonymously();
    if (error && error.message !== 'User already registered') {
        console.warn('Anonymous sign-in failed:', error.message);
    }
}

// kioskSignIn — looks up email from KIOSK_USER_MAP and authenticates via Supabase Auth.
// Returns { role, error } — role is from app_metadata set in the Supabase dashboard.
export async function kioskSignIn(username, password) {
    const email = KIOSK_USER_MAP[username.trim().toLowerCase()];
    if (!email) return { role: null, error: new Error('Unknown username') };
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { role: null, error };
    const role = data.user?.app_metadata?.role || null;
    return { role, error: null };
}

// kioskSignOut — ends the current Supabase Auth session.
export async function kioskSignOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
}

// List all part-number folders that have files in storage.
// Returns a Set of sanitized folder names (e.g. "TC11490", "TC_31255").
export async function fetchPartsWithFiles() {
    const { data, error } = await supabase.storage.from('wo-files').list('');
    if (error || !data) return new Set();
    return new Set(
        data
            .filter(f => f.name !== '.emptyFolderPlaceholder')
            .map(f => f.name)
    );
}

// List all files for a part number and return each with a 1-hour signed URL.
// Returns [] if the folder doesn't exist yet.
export async function listWoFiles(partNumber) {
    const folder = sanitizePartKey(partNumber);
    const { data: files, error } = await supabase.storage.from('wo-files').list(folder);
    if (error) return { data: [], error };

    const filtered = (files || []).filter(f => f.name !== '.emptyFolderPlaceholder');
    if (filtered.length === 0) return { data: [], error: null };

    const paths = filtered.map(f => `${folder}/${f.name}`);
    const { data: signed } = await supabase.storage.from('wo-files').createSignedUrls(paths, 3600);

    const result = filtered.map((f, i) => ({
        ...f,
        signedUrl: signed?.[i]?.signedUrl || null
    }));
    return { data: result, error: null };
}

// Upload a file to wo-files/{part_number}/{filename}. upsert:true replaces same name.
export async function uploadWoFile(partNumber, file) {
    const path = `${sanitizePartKey(partNumber)}/${file.name}`;
    return supabase.storage.from('wo-files').upload(path, file, { upsert: true });
}

// Delete a file by part number + filename.
export async function deleteWoFile(partNumber, filename) {
    const path = `${sanitizePartKey(partNumber)}/${filename}`;
    return supabase.storage.from('wo-files').remove([path]);
}
