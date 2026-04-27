// ============================================================
// libs/db-shared.js — Shared DB infrastructure
//
// Imported by db.js and all db-*.js sub-files.
// Contains: withRetry helper, dept alias maps, normalizeDept.
// No business logic. No Vue imports.
// ============================================================

import { supabase } from './config.js';

// ── Retry helper ──────────────────────────────────────────────
// Retries a Supabase operation up to maxRetries times on network failure.
// Returns { data, error } — same shape as Supabase responses.
export async function withRetry(operation, maxRetries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await operation();
            // Supabase returns { data, error } — propagate error without retrying on DB errors
            if (result.error) {
                const msg = result.error.message || '';
                // Only retry on network-level errors, not DB constraint errors
                const isNetworkError = msg.includes('Failed to fetch') ||
                                       msg.includes('NetworkError') ||
                                       msg.includes('timeout');
                if (!isNetworkError || attempt === maxRetries) return result;
                lastError = result.error;
            } else {
                return result;
            }
        } catch (err) {
            lastError = err;
            if (attempt === maxRetries) return { data: null, error: err };
        }
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
    return { data: null, error: lastError };
}

// ── Error logger ──────────────────────────────────────────────
// Fire-and-forget. Inserts one row into wo_errors.
// Never throws — swallows its own errors so callers stay clean.
// source: function name string. err: caught Error. ctx: optional plain object.
export function logError(source, err, ctx = {}) {
    supabase.from('wo_errors').insert({
        source,
        message: (err && err.message) ? err.message : String(err),
        context: ctx,
    }).then(() => {}).catch(() => {});
}

// ── Dept normalization ────────────────────────────────────────
// Department aliases: Google Sheets sends "TC. Assy" / "TV. Assy" with a dot.
// DEPT_ALIASES maps canonical name → all accepted DB variants (for querying).
// DEPT_CANONICAL maps any variant → canonical name (for normalizing results).
export const DEPT_ALIASES = {
    'Tru Cut Assy':  ['TC Assy', 'TC. Assy', 'Tru Cut Assy'],
    'Trac Vac Assy': ['TV Assy', 'TV. Assy', 'TV Assy.', 'Trac Vac Assy'],
};
export const DEPT_CANONICAL = {
    'TC Assy':  'Tru Cut Assy',
    'TC. Assy': 'Tru Cut Assy',
    'TV Assy':  'Trac Vac Assy',
    'TV. Assy': 'Trac Vac Assy',
    'TV Assy.': 'Trac Vac Assy',
};

// Normalize a single row's department to its canonical name.
export function normalizeDept(row) {
    const canon = DEPT_CANONICAL[row.department];
    return canon ? { ...row, department: canon } : row;
}

// fetchAppPins — returns { name → pin } map from app_pins table.
// Called once at startup. Returns empty map on error so startup never fails.
export async function fetchAppPins() {
    const { data } = await withRetry(() =>
        supabase.from('app_pins').select('name, pin')
    );
    const map = {};
    (data || []).forEach(r => { map[r.name] = r.pin; });
    return map;
}

// fetchCompletedWosByDept — returns completed (not yet closed) WOs for a dept, newest first.
export async function fetchCompletedWosByDept(dept) {
    const deptFilter = DEPT_ALIASES[dept] || [dept];
    const { data, error } = await withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .in('department', deptFilter)
            .eq('status', 'completed')
            .order('comp_date', { ascending: false, nullsFirst: false })
            .order('updated_at', { ascending: false })
            .limit(100)
    );
    if (error) logError('fetchCompletedWosByDept', error);
    return (data || []).map(normalizeDept);
}

// fetchArchivedWosByDept — returns closed-out WOs from completed_work_orders for past 90 days.
export async function fetchArchivedWosByDept(dept) {
    const deptFilter = DEPT_ALIASES[dept] || [dept];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const { data, error } = await withRetry(() =>
        supabase.from('completed_work_orders')
            .select('*')
            .in('department', deptFilter)
            .gte('archived_at', cutoff.toISOString())
            .order('archived_at', { ascending: false })
            .limit(200)
    );
    if (error) logError('fetchArchivedWosByDept', error);
    return (data || []).map(normalizeDept);
}

export { supabase };
