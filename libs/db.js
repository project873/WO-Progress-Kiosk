// ============================================================
// libs/db.js — All Supabase database operations
//
// RULES:
//  - NO Vue imports, NO state mutations, NO UI logic
//  - Every function returns { data, error } or throws
//  - Retry logic on network errors (exponential backoff)
//  - Validate inputs before writes
// ============================================================

import { supabase } from './config.js';
import { sanitizePartKey, detectTcMode } from './utils.js';

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
            if (attempt === maxRetries) throw err;
        }
        // Exponential backoff: 300ms, 600ms, 1200ms...
        await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt)));
    }
    return { data: null, error: lastError };
}

// ── Dashboard queries ─────────────────────────────────────────

// Department aliases: Google Sheets sends "TC. Assy" / "TV. Assy" with a dot.
// DEPT_ALIASES maps canonical name → all accepted DB variants (for querying).
// DEPT_CANONICAL maps any variant → canonical name (for normalizing results).
const DEPT_ALIASES = {
    'Tru Cut Assy':  ['TC Assy', 'TC. Assy', 'Tru Cut Assy'],
    'Trac Vac Assy': ['TV Assy', 'TV. Assy', 'TV Assy.', 'Trac Vac Assy'],
};
const DEPT_CANONICAL = {
    'TC Assy':  'Tru Cut Assy',
    'TC. Assy': 'Tru Cut Assy',
    'TV Assy':  'Trac Vac Assy',
    'TV. Assy': 'Trac Vac Assy',
    'TV Assy.': 'Trac Vac Assy',
};

// Normalize a single row's department to its canonical name.
function normalizeDept(row) {
    const canon = DEPT_CANONICAL[row.department];
    return canon ? { ...row, department: canon } : row;
}

export async function fetchDeptOrders(dept) {
    if (!dept) return { data: [], error: null };
    const deptFilter = DEPT_ALIASES[dept] || [dept];
    const result = await withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .in('department', deptFilter)
            .neq('status', 'completed')
            .order('priority', { ascending: false })
            .order('due_date',  { ascending: true })
    );
    if (result.data) result.data = result.data.map(normalizeDept);
    return result;
}

export async function fetchAllActiveOrders() {
    return withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .neq('status', 'completed')
            .order('priority', { ascending: false })
    );
}

// updateOrderStatus: builds the full update payload and writes it atomically.
// Returns { data, error }.
export async function updateOrderStatus({ id, currentOrder, newStatus, stageKey, opName, actionForm }) {
    // Validate required inputs
    if (!id)       return { data: null, error: new Error('Missing work order ID') };
    if (!newStatus) return { data: null, error: new Error('Missing new status') };
    if (!opName)   return { data: null, error: new Error('Operator name is required') };

    const now = new Date().toISOString();
    const isFabWeld = !stageKey &&
        (currentOrder.department === 'Fab' || currentOrder.department === 'Weld');
    const sessionQty = parseFloat(actionForm.qtyCompleted) || 0;
    const updates = {
        operator:      opName,
        qty_completed: isFabWeld
            ? (parseFloat(currentOrder.qty_completed) || 0) + sessionQty
            : sessionQty
    };

    // ── Sub-stage logic (TC Assy / TV Assy) ──────────────────
    let overallStatus = newStatus;
    if (stageKey) {
        updates[stageKey + '_status'] = newStatus;
        if (stageKey.startsWith('tc_')) updates[stageKey + '_operator'] = opName;

        // TC Assy: recompute overall status from pre-lap + final (packaging removed)
        if (currentOrder.department === 'Tru Cut Assy') {
            const fin = stageKey === 'tc_final'   ? newStatus : currentOrder.tc_final_status;
            const pre = stageKey === 'tc_pre_lap' ? newStatus : currentOrder.tc_pre_lap_status;
            if (fin === 'completed')                          overallStatus = 'completed';
            else if (pre === 'started' || fin === 'started') overallStatus = 'started';
            else                                              overallStatus = currentOrder.status;
        }

        // TV Assy: recompute from 3 sub-stages
        if (currentOrder.department === 'Trac Vac Assy') {
            const fin = stageKey === 'tv_final'  ? newStatus : currentOrder.tv_final_status;
            const eng = stageKey === 'tv_engine' ? newStatus : currentOrder.tv_engine_status;
            const crt = stageKey === 'tv_cart'   ? newStatus : currentOrder.tv_cart_status;
            if (fin === 'completed')                                                 overallStatus = 'completed';
            else if (fin === 'started' || eng === 'started' || crt === 'started')   overallStatus = 'started';
            else                                                                     overallStatus = currentOrder.status;
        }
    }

    updates.status = overallStatus;

    // ── Timestamps ────────────────────────────────────────────
    if (overallStatus === 'started' && !currentOrder.start_date) {
        updates.start_date = now;
    }
    if (overallStatus === 'completed') {
        updates.comp_date = now;
        // For standard Fab/Weld: if qty not set, default to required qty
        if (!stageKey &&
            currentOrder.department !== 'Tru Cut Assy' &&
            currentOrder.department !== 'Trac Vac Assy') {
            if (!updates.qty_completed) updates.qty_completed = currentOrder.qty_required;
        }
    }

        // ── Notes / history log ─────────────────────────────────
    let newLine;
    if (isFabWeld) {
        const ts = new Date().toLocaleString([], {
            month: '2-digit', day: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const label = { started: 'STARTED', paused: 'PAUSED', on_hold: 'ON HOLD', completed: 'COMPLETED' }[newStatus] || newStatus.toUpperCase();
        newLine = `[${ts}] ${opName}: ${label}`;
        if ((newStatus === 'paused' || newStatus === 'completed') && sessionQty > 0) {
            newLine += ` | ${sessionQty} pcs this session | Total: ${updates.qty_completed} / ${currentOrder.qty_required}`;
        }
        if (newStatus === 'on_hold' && actionForm.holdReason) {
            newLine += ` | Reason: ${actionForm.holdReason}`;
        }
        if (actionForm.qtyScrap > 0) {
            newLine += ` | Scrap: ${actionForm.qtyScrap}${actionForm.scrapReason ? ' (' + actionForm.scrapReason + ')' : ''}`;
        }
        if (actionForm.notes) newLine += ` | ${actionForm.notes}`;
    } else {
        newLine = `[${new Date().toLocaleDateString()}] ${opName} marked ${stageKey ? stageKey + ' ' : ''}${newStatus}`;
        if (newStatus === 'on_hold' && actionForm.holdReason) newLine += ` - Reason: ${actionForm.holdReason}`;
        if (actionForm.qtyScrap > 0) newLine += ` | SCRAP: ${actionForm.qtyScrap} (${actionForm.scrapReason || 'no reason'})`;
        if (actionForm.notes) newLine += ` | Notes: ${actionForm.notes}`;
    }
    updates.notes = currentOrder.notes ? currentOrder.notes + '\n' + newLine : newLine;

    // Log Fab/Weld actions to wo_progress_events (fire-and-forget)
    if (isFabWeld) {
        insertProgressEvent({
            workOrderId:        id,
            woNumber:           currentOrder.wo_number || '',
            department:         currentOrder.department,
            stage:              null,
            operatorName:       opName,
            action:             newStatus,
            sessionQty:         sessionQty,
            cumulativeQtyAfter: updates.qty_completed || 0,
            reason:             actionForm.holdReason || ''
        });
    }

    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// Undo: restore a previous snapshot of a work order
export async function restoreOrderSnapshot(id, previousData) {
    if (!id || !previousData) return { data: null, error: new Error('Missing undo data') };
    const restore = {
        status:                previousData.status,
        qty_completed:         previousData.qty_completed,
        operator:              previousData.operator,
        notes:                 previousData.notes,
        start_date:            previousData.start_date,
        comp_date:             previousData.comp_date,
        tc_pre_lap_status:     previousData.tc_pre_lap_status,
        tc_pre_lap_operator:   previousData.tc_pre_lap_operator,
        tc_final_status:       previousData.tc_final_status,
        tc_final_operator:     previousData.tc_final_operator,
        tc_packaging_status:   previousData.tc_packaging_status,
        tc_packaging_operator: previousData.tc_packaging_operator,
        tv_engine_status:      previousData.tv_engine_status,
        tv_cart_status:        previousData.tv_cart_status,
        tv_final_status:       previousData.tv_final_status,
        fab_bring_to:          previousData.fab_bring_to,
    };
    return withRetry(() =>
        supabase.from('work_orders').update(restore).eq('id', id).select()
    );
}

// TV + TC Assy DB functions live in libs/db-assy.js

// Create a new manual work order (TV Assy / TC Assy only)
export async function insertManualWorkOrder({ partNumber, description, qty, dept, woType, tcJobMode, salesOrder, unitSerial, engine, engineSerial, numBlades, customWoNumber }) {
    if (!partNumber) return { data: null, error: new Error('Part number is required') };
    if (!dept)       return { data: null, error: new Error('Department is required') };

    // Optional custom WO #: check for duplicate then use; else auto-generate
    let woNumber;
    if (customWoNumber && customWoNumber.trim()) {
        const chk = await withRetry(() =>
            supabase.from('work_orders').select('id').eq('wo_number', customWoNumber.trim()).maybeSingle()
        );
        if (chk.data) return { data: null, error: new Error(`WO # ${customWoNumber.trim()} already exists.`) };
        woNumber = customWoNumber.trim().toUpperCase();
    } else {
        // Use timestamp-based suffix for collision avoidance
        woNumber = 'MANUAL-' + Date.now().toString(36).toUpperCase().slice(-5);
    }

    const row = {
        wo_number:     woNumber,
        part_number:   partNumber.trim().toUpperCase(),
        description:   description || '',
        qty_required:  parseInt(qty, 10) || 1,
        department:    dept,
        wo_type:       woType || 'Unit',
        status:        'not_started',
        qty_completed: 0,
        priority:      0
    };

    // TC Assy specific fields — only written when provided
    if (tcJobMode)    row.tc_job_mode            = tcJobMode;
    if (salesOrder)   row.sales_order            = salesOrder.trim();
    if (unitSerial)   row.unit_serial_number     = unitSerial.trim();
    if (engine)       row.engine                 = engine.trim();
    if (engineSerial) row.engine_serial_number   = engineSerial.trim();
    if (numBlades)    row.num_blades             = numBlades.trim();

    return withRetry(() =>
        supabase.from('work_orders').insert([row]).select()
    );
}

// Append a manager note to a work order
export async function appendManagerNote(id, existingNotes, authorName, noteContent) {
    if (!id)          return { data: null, error: new Error('Missing work order ID') };
    if (!authorName)  return { data: null, error: new Error('Author name is required') };
    if (!noteContent) return { data: null, error: new Error('Note content is required') };

    const timestamp = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    const newLine  = `[${timestamp}] ${authorName.trim()}: ${noteContent.trim()}`;
    const combined = existingNotes ? existingNotes + '\n' + newLine : newLine;

    return withRetry(() =>
        supabase.from('work_orders').update({ manager_notes: combined }).eq('id', id).select()
    );
}

// ── Office (WO Status) queries ────────────────────────────────

export async function fetchWoStatusOrders() {
    // Parallel fetch: all non-closed tracking rows + received rows for closeout
    const [trackRes, receivedRes] = await Promise.all([
        withRetry(() =>
            supabase.from('wo_status_tracking')
                .select('*')
                .neq('erp_status', 'closed')
                .order('created_at', { ascending: false })
        ),
        withRetry(() =>
            supabase.from('wo_status_tracking')
                .select('*')
                .eq('erp_status', 'received')
                .order('received_at', { ascending: false })
        )
    ]);

    if (trackRes.error) return { woStatus: [], closeout: [], error: trackRes.error };

    // Join qty_completed from work_orders for closeout display
    const received = receivedRes.data || [];
    const woNums   = [...new Set(received.map(r => r.wo_number))];
    let woLookup   = {};

    if (woNums.length > 0) {
        const { data: wos } = await withRetry(() =>
            supabase.from('work_orders').select('wo_number,qty_completed').in('wo_number', woNums)
        );
        (wos || []).forEach(w => {
            if (!woLookup[w.wo_number]) woLookup[w.wo_number] = w.qty_completed;
        });
    }

    const closeout = received.map(r => ({
        ...r,
        qty_completed_fallback: woLookup[r.wo_number] || null
    }));

    return { woStatus: trackRes.data || [], closeout, error: null };
}

export async function searchWoForReceive(searchTerm) {
    if (!searchTerm) return { data: [], error: null };
    const t = searchTerm.trim();
    const [r1, r2, r3] = await Promise.all([
        withRetry(() => supabase.from('work_orders').select('*').eq('wo_number', t).neq('status', 'completed')),
        withRetry(() => supabase.from('work_orders').select('*').eq('sales_order', t).neq('status', 'completed')),
        withRetry(() => supabase.from('work_orders').select('*').ilike('part_number', '%' + t + '%').neq('status', 'completed'))
    ]);
    const combined = [...(r1.data || []), ...(r2.data || []), ...(r3.data || [])];
    const seen = new Set();
    const deduped = combined.filter(o => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
    });
    return { data: deduped, error: r1.error || r2.error || r3.error };
}

export async function fetchReceivingEligible() {
    // Fetch all WOs from eligible departments (no status filter â include completed)
    const { data: wos, error: woErr } = await withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .in('department', ['Fab', 'Weld', 'TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy'])
    );
    if (woErr) return { data: [], error: woErr };

    // Get WO numbers already received or closed in tracking
    const { data: tracked } = await withRetry(() =>
        supabase.from('wo_status_tracking')
            .select('wo_number, erp_status')
            .in('erp_status', ['received', 'closed'])
    );
    const excludedWoNums = new Set((tracked || []).map(t => t.wo_number));

    // Filter to only WOs not yet received or closed
    const eligible = (wos || []).filter(w => !excludedWoNums.has(w.wo_number));
    return { data: eligible, error: null };
}

// receiveWorkOrder — upserts a wo_status_tracking row as 'received'.
// If binLocation is non-empty, saves it to `location` and sets alere_bin_update_needed = true.
export async function receiveWorkOrder(order, qty, receivedBy, binLocation) {
    if (!receivedBy) return { data: null, error: new Error('Receiver name is required') };
    if (!order)      return { data: null, error: new Error('No order selected') };

    const cleanBin = (binLocation || '').trim();
    const payload = {
        wo_number:    order.wo_number,
        part_number:  order.part_number,
        description:  order.description,
        qty_required: order.qty_required,
        qty_received: qty || order.qty_completed || order.qty_required || 0,
        received_by:  receivedBy.trim(),
        erp_status:   'received',
        received_at:  new Date().toISOString(),
        ...(cleanBin ? {
            location:               cleanBin,
            alere_bin_update_needed: true
        } : {
            alere_bin_update_needed: false
        })
    };

    // Upsert: update if WO already exists in tracking, else insert
    const { data: existing } = await withRetry(() =>
        supabase.from('wo_status_tracking').select('id').eq('wo_number', order.wo_number).single()
    );

    if (existing) {
        return withRetry(() =>
            supabase.from('wo_status_tracking').update(payload).eq('id', existing.id).select()
        );
    } else {
        return withRetry(() =>
            supabase.from('wo_status_tracking').insert([payload]).select()
        );
    }
}

// autoReceiveAssyWo — inserts a 'received' tracking row when an Assy WO is
// completed, so it appears in the Close-Out list automatically.
// No-ops if a tracking row already exists for this WO number.
// Input: order object, operator string (name of completing operator).
export async function autoReceiveAssyWo(order, operator) {
    if (!order?.wo_number) return;
    const { data: existing } = await withRetry(() =>
        supabase.from('wo_status_tracking').select('id').eq('wo_number', order.wo_number).single()
    );
    if (existing) return; // already tracked, don't overwrite
    const { error } = await withRetry(() =>
        supabase.from('wo_status_tracking').insert([{
            wo_number:               order.wo_number,
            part_number:             order.part_number,
            qty_required:            order.qty_required,
            qty_received:            order.qty_completed || order.qty_required || 0,
            received_by:             operator || 'Auto (Assy Complete)',
            erp_status:              'received',
            received_at:             new Date().toISOString(),
            alere_bin_update_needed: false
        }])
    );
    if (error) throw error;
}

// markAlereUpdated — clears the Alere bin update alert for a tracking row.
// Records who cleared it and when. Input: tracking row id, office user name.
export async function markAlereUpdated(id, updatedBy) {
    if (!id)        return { data: null, error: new Error('Missing tracking row ID') };
    if (!updatedBy) return { data: null, error: new Error('User name is required') };

    return withRetry(() =>
        supabase.from('wo_status_tracking').update({
            alere_bin_update_needed: false,
            alere_bin_updated_at:    new Date().toISOString(),
            alere_bin_updated_by:    updatedBy.trim()
        }).eq('id', id).select()
    );
}

export async function closeOutWorkOrder(id, closedBy) {
    if (!id)       return { data: null, error: new Error('Missing tracking row ID') };
    if (!closedBy) return { data: null, error: new Error('Closer name is required') };

    return withRetry(() =>
        supabase.from('wo_status_tracking').update({
            erp_status: 'closed',
            closed_by:  closedBy.trim(),
            closed_at:  new Date().toISOString()
        }).eq('id', id).select()
    );
}

// ── Manager queries ───────────────────────────────────────────

export async function fetchManagerAlerts() {
    const now          = new Date();
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
    const fiveDaysAgo  = new Date(now); fiveDaysAgo.setDate(now.getDate() - 5);
    const twoDaysAgo   = new Date(now); twoDaysAgo.setDate(now.getDate() - 2);

    // 3 parallel queries — select * so alert click-through shows full WO detail
    const [completedRes, activeRes, trackingRes] = await Promise.all([
        withRetry(() =>
            supabase.from('work_orders')
                .select('*')
                .eq('status', 'completed')
                .lt('comp_date', sevenDaysAgo.toISOString())
        ),
        withRetry(() =>
            supabase.from('work_orders')
                .select('*')
                .in('status', ['paused', 'on_hold', 'started', 'resumed'])
        ),
        withRetry(() =>
            supabase.from('wo_status_tracking')
                .select('id,wo_number,qty_received,erp_status')
                .in('erp_status', ['received', 'closed'])
        )
    ]);

    const completedWos = completedRes.data || [];
    const activeWos    = activeRes.data    || [];
    const tracked      = trackingRes.data  || [];

    // Alert 1: Completed Not Received (completed > 7 days, not in tracking)
    const receivedOrClosedNums = new Set(tracked.map(t => t.wo_number));
    const completedNotReceived = completedWos
        .filter(w => !receivedOrClosedNums.has(w.wo_number))
        .slice(0, 5);

    // Alert 2: Paused / On Hold > 5 Days (use start_date as proxy)
    const pausedOnHold = activeWos
        .filter(w => ['paused', 'on_hold'].includes(w.status))
        .filter(w => {
            const ref = w.start_date || w.created_at;
            return ref && new Date(ref) < fiveDaysAgo;
        })
        .slice(0, 5);

    // Alert 3: Started with no qty progress for > 2 days
    const startedNoProgress = activeWos
        .filter(w => ['started', 'resumed'].includes(w.status))
        .filter(w => {
            const ref = w.start_date || w.created_at;
            return ref && new Date(ref) < twoDaysAgo && (parseFloat(w.qty_completed) || 0) === 0;
        })
        .slice(0, 5);

    // Alert 4: Qty Mismatch (received qty != completed qty on work_orders)
    const receivedOnly = tracked.filter(t => t.erp_status === 'received');
    let qtyMismatch = [];
    if (receivedOnly.length > 0) {
        const woNums = receivedOnly.map(t => t.wo_number);
        const { data: wos } = await withRetry(() =>
            supabase.from('work_orders').select('*').in('wo_number', woNums)
        );
        const woMap = {};
        (wos || []).forEach(w => { woMap[w.wo_number] = w; });
        qtyMismatch = receivedOnly
            .filter(t => {
                const wo = woMap[t.wo_number];
                if (!wo) return false;
                return parseFloat(t.qty_received) !== parseFloat(wo.qty_completed);
            })
            .map(t => ({ ...woMap[t.wo_number], qty_received: t.qty_received }))
            .slice(0, 5);
    }

    return {
        completedNotReceived,
        pausedOnHold,
        startedNoProgress,
        qtyMismatch,
        error: completedRes.error || activeRes.error || trackingRes.error
    };
}

export async function fetchKpiData() {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo  = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart     = new Date(); weekStart.setDate(weekStart.getDate() - 7);

    const [completedRes, activeRes] = await Promise.all([
        withRetry(() =>
            supabase.from('work_orders').select('*')
                .eq('status', 'completed')
                .gte('comp_date', thirtyDaysAgo.toISOString())
        ),
        withRetry(() =>
            supabase.from('work_orders').select('*').neq('status', 'completed')
        )
    ]);

    return {
        completed:    completedRes.data || [],
        active:       activeRes.data    || [],
        weekStart,
        sevenDaysAgo,
        error: completedRes.error || activeRes.error
    };
}

export async function fetchDelayedOrders() {
    const result = await withRetry(() =>
        supabase.from('work_orders').select('*').neq('status', 'completed')
    );
    if (result.data) result.data = result.data.map(normalizeDept);
    return result;
}

export async function fetchPriorityOrdersForDept(dept) {
    if (!dept) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .eq('department', dept)
            .neq('status', 'completed')
            .order('priority', { ascending: false })
            .order('due_date',  { ascending: true })
    );
}

// Set assigned_operator on a work order (planning field, does not affect logging).
export async function setAssignedOperator(id, operatorName) {
    if (id === undefined || id === null) return { data: null, error: new Error('Missing ID') };
    return withRetry(() =>
        supabase.from('work_orders')
            .update({ assigned_operator: operatorName || null })
            .eq('id', id).select()
    );
}

export async function setWorkOrderPriority(id, priority) {
    if (id === undefined || id === null) return { data: null, error: new Error('Missing ID') };
    const p = parseInt(priority, 10);
    if (isNaN(p) || p < 0 || p > 5)    return { data: null, error: new Error('Priority must be 0-5') };

    return withRetry(() =>
        supabase.from('work_orders').update({ priority: p }).eq('id', id).select()
    );
}

// ── WO Problem queries ────────────────────────────────────────

// Fetch all WOs with an open problem (wo_problem_text set + status = 'open').
// Returns { data, error }
export async function fetchWoProblems() {
    return withRetry(() =>
        supabase.from('work_orders')
            .select('id,wo_number,part_number,department,operator,wo_problem_text,wo_problem_status,wo_problem_updated_at,wo_problem_updated_by,wo_problem_resolution')
            .eq('wo_problem_status', 'open')
            .not('wo_problem_text', 'is', null)
            .neq('wo_problem_text', '')
            .order('wo_problem_updated_at', { ascending: false })
    );
}

// Save a problem on a WO. Sets status to 'open' and records who/when.
// Input: work order id, problem text, operator name (may be empty string).
export async function saveWoProblem(id, problemText, updatedBy) {
    if (!id)          return { data: null, error: new Error('Missing work order ID') };
    if (!problemText) return { data: null, error: new Error('Problem text is required') };

    return withRetry(() =>
        supabase.from('work_orders').update({
            wo_problem_text:       problemText.trim(),
            wo_problem_status:     'open',
            wo_problem_updated_at: new Date().toISOString(),
            wo_problem_updated_by: (updatedBy || '').trim() || null
        }).eq('id', id).select()
    );
}

// Mark a WO problem resolved. Resolution text is required.
// Input: work order id, resolution text, manager name.
export async function resolveWoProblem(id, resolution, resolvedBy) {
    if (!id)         return { data: null, error: new Error('Missing work order ID') };
    if (!resolution) return { data: null, error: new Error('Resolution is required') };
    if (!resolvedBy) return { data: null, error: new Error('Resolver name is required') };

    return withRetry(() =>
        supabase.from('work_orders').update({
            wo_problem_status:     'resolved',
            wo_problem_resolution: resolution.trim(),
            wo_problem_updated_at: new Date().toISOString(),
            wo_problem_updated_by: resolvedBy.trim()
        }).eq('id', id).select()
    );
}

// ── AI Assistant context query ────────────────────────────────

// Fetch lightweight snapshots of active + recently-completed WOs for the AI assistant.
// Returns { active, completed, todayStart, error }
export async function fetchAiContextData() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);

    const [activeRes, completedRes] = await Promise.all([
        withRetry(() =>
            supabase.from('work_orders')
                .select('id,wo_number,part_number,description,department,status,operator,start_date,created_at,qty_completed,qty_required')
                .neq('status', 'completed')
        ),
        withRetry(() =>
            supabase.from('work_orders')
                .select('id,wo_number,part_number,department,operator,comp_date,qty_completed,qty_required')
                .eq('status', 'completed')
                .gte('comp_date', weekStart.toISOString())
        )
    ]);

    return {
        active:    activeRes.data    || [],
        completed: completedRes.data || [],
        todayStart,
        error: activeRes.error || completedRes.error
    };
}

// ── Inventory queries ─────────────────────────────────────────

// Allowed inventory categories — guards against dynamic table name injection.
const INVENTORY_TABLES = new Set(['chute', 'hitch', 'engine', 'hardware', 'hoses']);

function assertInventoryTable(table) {
    if (!INVENTORY_TABLES.has(table)) throw new Error(`Invalid inventory table: ${table}`);
}

// fetchInventory — all rows from <table>_inventory, ordered by part_number.
// Input: table (string, e.g. 'chute'). Returns { data, error }.
export async function fetchInventory(table) {
    assertInventoryTable(table);
    return withRetry(() =>
        supabase.from(`${table}_inventory`)
            .select('*')
            .order('part_number', { ascending: true })
    );
}

// addInventoryItem — insert a new part into <table>_inventory.
// Input: table, item { part_number, description, qty, location, refill_location }.
// Returns { data, error }.
export async function addInventoryItem(table, item) {
    assertInventoryTable(table);
    if (!item?.part_number?.trim()) return { data: null, error: new Error('Part number is required') };
    return withRetry(() =>
        supabase.from(`${table}_inventory`).insert([{
            part_number:     item.part_number.trim().toUpperCase(),
            description:     (item.description  || '').trim() || null,
            qty:             parseFloat(item.qty) || 0,
            location:        (item.location      || '').trim() || null,
            refill_location: (item.refill_location || '').trim() || null,
        }]).select()
    );
}

// updateInventoryItem — update fields on a part row.
// Input: table, id (uuid), updates (partial item fields).
// Returns { data, error }.
export async function updateInventoryItem(table, id, updates) {
    assertInventoryTable(table);
    if (!id) return { data: null, error: new Error('Missing inventory item ID') };
    const payload = {};
    if (updates.part_number     !== undefined) payload.part_number     = updates.part_number.trim().toUpperCase();
    if (updates.description     !== undefined) payload.description     = (updates.description     || '').trim() || null;
    if (updates.qty             !== undefined) payload.qty             = parseFloat(updates.qty) || 0;
    if (updates.location        !== undefined) payload.location        = (updates.location        || '').trim() || null;
    if (updates.refill_location !== undefined) payload.refill_location = (updates.refill_location || '').trim() || null;
    payload.updated_at = new Date().toISOString();
    return withRetry(() =>
        supabase.from(`${table}_inventory`).update(payload).eq('id', id).select()
    );
}

// deleteInventoryItem — hard delete a part from <table>_inventory.
// Pull log rows cascade-delete automatically via FK.
// Input: table, id (uuid). Returns { data, error }.
export async function deleteInventoryItem(table, id) {
    assertInventoryTable(table);
    if (!id) return { data: null, error: new Error('Missing inventory item ID') };
    return withRetry(() =>
        supabase.from(`${table}_inventory`).delete().eq('id', id).select()
    );
}

// recordPull — inserts a pull log row and decrements qty on the inventory row.
// Input: table, inventoryId (uuid), pull { name, qty_pulled, new_location, where_used }.
// Returns { data, error } from the pull insert.
export async function recordPull(table, inventoryId, pull) {
    assertInventoryTable(table);
    if (!inventoryId)           return { data: null, error: new Error('Missing inventory item ID') };
    if (!pull?.name?.trim())    return { data: null, error: new Error('Name is required') };
    const qtyPulled = parseFloat(pull.qty_pulled);
    if (!qtyPulled || qtyPulled <= 0) return { data: null, error: new Error('qty_pulled must be a positive number') };

    // Fetch current qty first
    const { data: current, error: fetchErr } = await withRetry(() =>
        supabase.from(`${table}_inventory`).select('qty').eq('id', inventoryId).single()
    );
    if (fetchErr) return { data: null, error: fetchErr };

    const newQty = (parseFloat(current.qty) || 0) - qtyPulled;

    // Decrement qty on the inventory row
    const { error: updateErr } = await withRetry(() =>
        supabase.from(`${table}_inventory`).update({
            qty:        newQty,
            updated_at: new Date().toISOString()
        }).eq('id', inventoryId)
    );
    if (updateErr) return { data: null, error: updateErr };

    // Insert pull log row
    return withRetry(() =>
        supabase.from(`${table}_pulls`).insert([{
            inventory_id: inventoryId,
            name:         pull.name.trim(),
            qty_pulled:   qtyPulled,
            date_pulled:  pull.date_pulled || new Date().toISOString().slice(0, 10),
            new_location: (pull.new_location || '').trim() || null,
            where_used:   (pull.where_used   || '').trim() || null,
        }]).select()
    );
}

// fetchPullHistory — all pull log rows for one inventory item, newest first.
// Input: table, inventoryId (uuid). Returns { data, error }.
export async function fetchPullHistory(table, inventoryId) {
    assertInventoryTable(table);
    if (!inventoryId) return { data: [], error: null };
    return withRetry(() =>
        supabase.from(`${table}_pulls`)
            .select('*')
            .eq('inventory_id', inventoryId)
            .order('created_at', { ascending: false })
    );
}

// ── WO Request → work_orders routing ─────────────────────────
//
// insertWorkOrdersFromRequest — creates work_order rows from an approved WO request.
// Routing rules (mirrors the GAS runWOProcessing script):
//   fab=true  AND fab_print='yes'                     → dept 'Fab'
//   weld area is set AND weld≠'Paint' AND weld_print='yes' → dept 'Weld'
//     weld='Urgent' → priority 5, otherwise priority 0
//   assy_wo='Trac Vac Assy'                           → dept 'Trac Vac Assy'
//   assy_wo='Tru Cut Assy'                            → dept 'Tru Cut Assy'
//   assy_wo='Non Assy WO' or null                     → no assy row
//
// Input: req (full wo_request row), woNumber (string already saved to req).
// Returns { data, error }.
export async function insertWorkOrdersFromRequest(req, woNumber) {
    const inserts = [];
    const base = {
        wo_number:     (woNumber || req.alere_wo_number || '').trim().toUpperCase(),
        part_number:   (req.part_number  || '').trim().toUpperCase(),
        description:   (req.description  || ''),
        qty_required:  parseInt(req.qty_to_make, 10) || 1,
        wo_type:       'Unit',
        status:        'not_started',
        qty_completed: 0,
        priority:      0,
    };
    if (req.sales_order_number) base.sales_order = req.sales_order_number.trim();

    // Resolve weld area once — used by both Fab and Weld routing blocks
    const weldArea = (req.weld || '').trim();

    // Fab routing
    // If weld area is set but weld_print is NOT 'yes', the area is a "bring-to" destination
    // for Fab when done — store it in the Fab row's notes so the operator sees it.
    if (req.fab === 'yes' && req.fab_print === 'yes') {
        const fabRow = { ...base, department: 'Fab' };
        if (weldArea && req.weld_print !== 'yes') {
            fabRow.fab_bring_to = weldArea;
        }
        inserts.push(fabRow);
    }

    // Weld routing — weld column is now TEXT (area name); Paint skips weld dept
    if (weldArea && weldArea !== 'Paint' && req.weld_print === 'yes') {
        const weldRow = {
            ...base,
            department: 'Weld',
            priority:   weldArea === 'Urgent' ? 5 : 0,
        };
        // Store area in notes so it's visible on the weld board
        if (weldArea !== 'Urgent') weldRow.notes = `Weld Area: ${weldArea}`;
        inserts.push(weldRow);
    }

    // Assy routing
    if (req.assy_wo === 'Trac Vac Assy') {
        inserts.push({ ...base, department: 'Trac Vac Assy' });
    }
    if (req.assy_wo === 'Tru Cut Assy') {
        const tcMode = detectTcMode(req.part_number) || 'stock';
        inserts.push({ ...base, department: 'Tru Cut Assy', tc_job_mode: tcMode });
    }

    if (inserts.length === 0) return { data: [], error: null };
    return withRetry(() => supabase.from('work_orders').insert(inserts).select());
}

// ── WO Request queries ────────────────────────────────────────

// fetchApprovedWoRequests — requests with status='approved', oldest first. Returns { data, error }.
export async function fetchApprovedWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('status', 'approved')
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// confirmCreateWo — mark a request as 'in production' with Alere WO # and creator initials.
// Input: id (uuid), woNumber (string), initials (string), date (YYYY-MM-DD string).
// Returns { data, error }.
export async function confirmCreateWo(id, woNumber, initials, date) {
    if (!id)       return { data: null, error: new Error('Missing request ID') };
    if (!woNumber) return { data: null, error: new Error('WO number is required') };
    if (!initials) return { data: null, error: new Error('Initials are required') };
    return withRetry(() =>
        supabase.from('wo_requests')
            .update({
                alere_wo_number:     woNumber.trim().toUpperCase(),
                created_by_initials: initials.trim().toUpperCase(),
                created_date:        date,
                status:              'in production'
            })
            .eq('id', id)
            .select()
    );
}

// fetchWoRequests — all requests, oldest first (request_date asc). Returns { data, error }.
export async function fetchWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// submitWoRequest — insert a new WO request.
// Input: form { part_number, description, sales_order_number, qty_on_order,
//               qty_in_stock, qty_used_per_unit, submitted_by }.
// Returns { data, error }.
export async function submitWoRequest(form) {
    if (!form?.part_number?.trim())  return { data: null, error: new Error('Part number is required') };
    if (!form?.submitted_by?.trim()) return { data: null, error: new Error('Submitted by is required') };
    return withRetry(() =>
        supabase.from('wo_requests').insert([{
            part_number:        form.part_number.trim().toUpperCase(),
            description:        (form.description        || '').trim() || null,
            sales_order_number: (form.sales_order_number || '').trim() || null,
            qty_on_order:       form.qty_on_order       ? parseFloat(form.qty_on_order)       : null,
            qty_in_stock:       form.qty_in_stock       ? parseFloat(form.qty_in_stock)       : null,
            qty_used_per_unit:  form.qty_used_per_unit  ? parseFloat(form.qty_used_per_unit)  : null,
            request_date:       new Date().toISOString().slice(0, 10),
            submitted_by:       form.submitted_by.trim(),
            status:             'pending'
        }]).select()
    );
}

// updateWoRequest — partial update on a request row (status changes, manager edits).
// Input: id (uuid), updates (partial fields). Returns { data, error }.
export async function updateWoRequest(id, updates) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.from('wo_requests').update(updates).eq('id', id).select()
    );
}

// deleteWoRequest — hard delete a request row. Input: id (uuid). Returns { data, error }.
export async function deleteWoRequest(id) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.from('wo_requests').delete().eq('id', id).select()
    );
}

// ── Open Orders queries ───────────────────────────────────────

// fetchOpenOrders — all rows ordered by sort_order. Returns { data, error }.
export async function fetchOpenOrders() {
    return withRetry(() =>
        supabase.from('open_orders')
            .select('*')
            .order('sort_order', { ascending: true })
    );
}

// updateOpenOrder — partial update on a row. Input: id (uuid), updates (object).
export async function updateOpenOrder(id, updates) {
    if (!id) return { data: null, error: new Error('Missing order ID') };
    updates.updated_at = new Date().toISOString();
    return withRetry(() =>
        supabase.from('open_orders').update(updates).eq('id', id).select()
    );
}

// insertOpenOrders — bulk insert rows. Input: rows (array of objects).
export async function insertOpenOrders(rows) {
    if (!rows?.length) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('open_orders').insert(rows).select()
    );
}

// deleteOpenOrder — delete a single row by id. Returns { error }.
export async function deleteOpenOrder(id) {
    if (!id) return { error: new Error('Missing order ID') };
    return withRetry(() =>
        supabase.from('open_orders').delete().eq('id', id)
    );
}

// ── Customer Service queries ──────────────────────────────────

export async function searchCsOrders(term) {
    if (!term) return { timeline: [], open: [], error: null };
    const t = term.trim();
    const [r1, r2, r3] = await Promise.all([
        withRetry(() => supabase.from('work_orders').select('*').eq('wo_number', t)),
        withRetry(() => supabase.from('work_orders').select('*').eq('sales_order', t)),
        withRetry(() => supabase.from('work_orders').select('*').ilike('part_number', '%' + t + '%').neq('status', 'completed'))
    ]);
    return {
        byWo:     r1.data || [],
        bySo:     r2.data || [],
        byPart:   r3.data || [],
        error:    r1.error || r2.error || r3.error
    };
}

export async function fetchCsSupplementalData(woNumber, partNumber) {
    const [statusRes, historyRes] = await Promise.all([
        withRetry(() =>
            supabase.from('wo_status_tracking').select('*').eq('wo_number', woNumber)
        ),
        withRetry(() =>
            supabase.from('work_orders')
                .select('department,start_date,comp_date')
                .eq('part_number', partNumber)
                .eq('status', 'completed')
        )
    ]);
    return {
        statusRows:  statusRes.data  || [],
        historyRows: historyRes.data || [],
        error:       statusRes.error || historyRes.error
    };
}

// ── searchPastAssyOrders ───────────────────────────────────────
// Search completed assembly WOs by WO#, SO#, Part#, or Description.
// Returns up to 50 rows with assy-specific fields selected.
// Input: term string. Output: { rows, error }
const ASSY_DEPTS = ['TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy', 'Assy'];
export async function searchPastAssyOrders(term) {
    if (!term) return { rows: [], error: null };
    const t = term.trim();
    const cols = 'id,wo_number,sales_order,part_number,description,department,comp_date,qty_required,tv_assy_notes,tc_assy_notes_differences_mods,unit_serial_number,engine_serial_number,num_blades';
    const base = () => supabase.from('work_orders')
        .select(cols)
        .eq('status', 'completed')
        .in('department', ASSY_DEPTS)
        .limit(50);

    const [r1, r2, r3, r4] = await Promise.all([
        withRetry(() => base().eq('wo_number',    t)),
        withRetry(() => base().eq('sales_order',  t)),
        withRetry(() => base().ilike('part_number',  '%' + t + '%')),
        withRetry(() => base().ilike('description',  '%' + t + '%')),
    ]);
    const err = r1.error || r2.error || r3.error || r4.error;
    if (err) return { rows: [], error: err };

    // Merge and deduplicate by id
    const seen = new Set();
    const rows = [];
    for (const row of [...(r1.data||[]), ...(r2.data||[]), ...(r3.data||[]), ...(r4.data||[])]) {
        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    }
    return { rows, error: null };
}

// ── Part Print Storage (Supabase Storage: bucket "wo-files") ─
// Files are keyed by Part # so the same print is shared across all WOs for that part.
// Storage path: {sanitized_part_number}/{filename}
// e.g. part "TC11490" → folder "TC11490"; part "TC 11490/A" → folder "TC_11490_A"

// Sign in anonymously so storage RLS (authenticated role) grants access.
// Called once on app load. Safe to call repeatedly — Supabase reuses the session.
export async function signInAnonymously() {
    const { error } = await supabase.auth.signInAnonymously();
    if (error && error.message !== 'User already registered') {
        console.warn('Anonymous sign-in failed:', error.message);
    }
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

// ── Progress event logging ────────────────────────────────────
// Fire-and-forget: inserts one row into wo_progress_events.
// Failures are logged to console only — never blocks the main action.
export async function insertProgressEvent({ workOrderId, woNumber, department, stage, operatorName, action, sessionQty, cumulativeQtyAfter, reason }) {
    try {
        await supabase.from('wo_progress_events').insert([{
            work_order_id:        workOrderId  || null,
            wo_number:            woNumber     || '',
            department:           department   || '',
            stage:                stage        || null,
            operator_name:        operatorName || '',
            action:               action       || '',
            session_qty:          parseFloat(sessionQty)         || 0,
            cumulative_qty_after: parseFloat(cumulativeQtyAfter) || 0,
            reason:               reason       || null
        }]);
    } catch (err) {
        console.warn('[insertProgressEvent] failed silently:', err);
    }
}
