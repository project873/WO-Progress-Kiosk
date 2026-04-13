// ============================================================
// libs/utils.js — Pure utility functions
//
// RULES:
//  - No side effects, no imports, no state
//  - Every function is independently testable
//  - Input validation included
// ============================================================

// Format a date string or Date object to a locale-friendly date string
export function formatDateLocal(d) {
    if (!d) return '';
    try {
        return new Date(d).toLocaleDateString();
    } catch {
        return '';
    }
}

// Format a datetime for notes/history entries
export function formatTimestamp(d) {
    if (!d) return '';
    try {
        return new Date(d).toLocaleString('en-US', {
            month:   'numeric',
            day:     'numeric',
            year:    '2-digit',
            hour:    'numeric',
            minute:  '2-digit',
            hour12:  true
        });
    } catch {
        return '';
    }
}

// How many calendar days between two dates (positive = d2 is after d1)
export function daysBetween(d1, d2) {
    const t1 = d1 instanceof Date ? d1 : new Date(d1);
    const t2 = d2 instanceof Date ? d2 : new Date(d2);
    return (t2 - t1) / 86400000;
}

// How many days ago was a date (negative = future)
export function daysAgo(dateStr) {
    if (!dateStr) return null;
    return Math.floor(daysBetween(new Date(dateStr), new Date()));
}

// Generate a unique-enough manual WO number using timestamp
// Format: MANUAL-XXXXX (base-36 last 5 chars of timestamp)
export function generateManualWoNumber() {
    return 'MANUAL-' + Date.now().toString(36).toUpperCase().slice(-5);
}

// Sanitize text input: trim, prevent XSS injection in stored text
export function sanitizeText(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/<[^>]*>/g, ''); // strip any HTML tags
}

// Convert a part number to a safe Supabase Storage folder name.
// Uppercases, trims, and replaces any character that isn't alphanumeric or dash with underscore.
// e.g. "TC 11490 / A" → "TC_11490___A"  |  "TC11490" → "TC11490"
export function sanitizePartKey(partNumber) {
    if (typeof partNumber !== 'string' || !partNumber.trim()) return '_unknown';
    return partNumber.trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '_');
}

// Validate that a string is not empty after trimming
export function isNonEmpty(str) {
    return typeof str === 'string' && str.trim().length > 0;
}

// Validate a numeric quantity (must be >= 0, finite)
export function isValidQty(val) {
    const n = parseFloat(val);
    return !isNaN(n) && isFinite(n) && n >= 0;
}

// Extract hold reasons from notes text
// Notes format: "... - Reason: Something | ..."
// Returns array of reason strings found in the text
export function extractHoldReasons(notesText) {
    if (!notesText) return [];
    const reasons = [];
    const pattern = /Reason:\s*([^|\n]+)/gi;
    let match;
    while ((match = pattern.exec(notesText)) !== null) {
        const r = match[1].trim();
        if (r) reasons.push(r);
    }
    return reasons;
}

// Get historical average cycle time for a department from completed orders
// Returns null if fewer than 3 data points (not reliable)
export function getHistoricalAvgDays(historyRows, dept) {
    const relevant = historyRows.filter(x =>
        x.department === dept && x.start_date && x.comp_date
    );
    if (relevant.length < 3) return null;
    const avg = relevant.reduce((sum, x) =>
        sum + daysBetween(new Date(x.start_date), new Date(x.comp_date)), 0
    ) / relevant.length;
    return Math.max(1, Math.round(avg));
}

// Deep clone a plain object/array (for undo snapshots)
// Only handles JSON-serializable values
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Clamp a number between min and max
// Return the cumulative qty for a TV Assy unit stage from the notes history.
// prefix is one of: TVENG, TVCRT, TVFIN
export function getStageCum(order, prefix) {
    const lines = (order?.notes || '').split('\n').filter(l => l.startsWith(prefix + '|'));
    if (!lines.length) return 0;
    return parseFloat(lines.at(-1).split('|')[5]) || 0;
}

export function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
}

// ── detectOpenOrderSection ────────────────────────────────────
// Auto-routes an open order to a section based on part number prefix.
// Part # starts with "TC" (case-insensitive) → 'tru_cut', else → 'trac_vac'.
// Freight and Emergency are assigned manually after creation.
export function detectOpenOrderSection(partNumber) {
    if (typeof partNumber !== 'string') return 'trac_vac';
    return partNumber.trim().toUpperCase().startsWith('TC') ? 'tru_cut' : 'trac_vac';
}

// ── detectTcMode ──────────────────────────────────────────────
// Detects TC Assy job mode from a part number.
// Normalises input (trim + uppercase) before checking.
//
// Returns 'unit'  if part starts with TCTC, TCC, or TCP.
// Returns 'stock' if part starts with TC (but not the above).
// Returns null    if part does not start with TC at all.
//
// Check order is intentional: TCTC first, then TCC, TCP, TC.
export function detectTcMode(partNumber) {
    if (typeof partNumber !== 'string') return null;
    const p = partNumber.trim().toUpperCase();
    if (!p) return null;
    if (p.startsWith('TCTC')) return 'unit';
    if (p.startsWith('TCC'))  return 'unit';
    if (p.startsWith('TCP'))  return 'unit';
    if (p.startsWith('TC'))   return 'stock';
    return null;
}
