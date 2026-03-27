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

// ── Retry helper ──────────────────────────────────────────────
// Retries a Supabase operation up to maxRetries times on network failure.
// Returns { data, error } — same shape as Supabase responses.
async function withRetry(operation, maxRetries = 2) {
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

export async function fetchDeptOrders(dept) {
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
        if (currentOrder.department === 'TC Assy') {
            const fin = stageKey === 'tc_final'   ? newStatus : currentOrder.tc_final_status;
            const pre = stageKey === 'tc_pre_lap' ? newStatus : currentOrder.tc_pre_lap_status;
            if (fin === 'completed')                          overallStatus = 'completed';
            else if (pre === 'started' || fin === 'started') overallStatus = 'started';
            else                                              overallStatus = currentOrder.status;
        }

        // TV Assy: recompute from 3 sub-stages
        if (currentOrder.department === 'TV Assy') {
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
            currentOrder.department !== 'TC Assy' &&
            currentOrder.department !== 'TV Assy') {
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
    };
    return withRetry(() =>
        supabase.from('work_orders').update(restore).eq('id', id).select()
    );
}

// TV Assy: persist the job mode (unit|stock) for a WO so the user never has to re-select
export async function saveTvJobMode(id, mode) {
    if (!id || !mode) return { data: null, error: new Error('Missing id or mode') };
    return withRetry(() =>
        supabase.from('work_orders').update({ tv_job_mode: mode }).eq('id', id).select()
    );
}

// TC Assy: persist the job mode (unit|stock) for a WO
export async function saveTcJobMode(id, mode) {
    if (!id || !mode) return { data: null, error: new Error('Missing id or mode') };
    return withRetry(() =>
        supabase.from('work_orders').update({ tc_job_mode: mode }).eq('id', id).select()
    );
}

// TV Assy Unit: per-stage action with cumulative qty derived from notes history
export async function submitTvUnitStageAction({ id, currentOrder, stageKey, stagePrefix, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const prefix   = stagePrefix + '|';
    const noteLines = (currentOrder.notes || '').split('\n');
    const stageLast = noteLines.filter(l => l.startsWith(prefix)).at(-1);
    const prevCum  = stageLast ? parseFloat(stageLast.split('|')[5]) || 0 : 0;
    const session  = parseFloat(sessionQty) || 0;
    const newCum   = Math.max(0, prevCum + session);

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates[stageKey + '_status'] = newStatus;
        updates.operator = opName;

        // Recompute overall WO status from all 3 TV stages
        const eng = stageKey === 'tv_engine' ? newStatus : (currentOrder.tv_engine_status || '');
        const crt = stageKey === 'tv_cart'   ? newStatus : (currentOrder.tv_cart_status   || '');
        const fin = stageKey === 'tv_final' ? newStatus : (currentOrder.tv_final_status || '');

        if      (fin === 'completed')                                        updates.status = 'completed';
        else if (eng === 'started' || crt === 'started' || fin === 'started') updates.status = 'started';
        else if (eng === 'paused'  || crt === 'paused'  || fin === 'paused')  updates.status = 'paused';
        else if (eng === 'on_hold' || crt === 'on_hold')                      updates.status = 'on_hold';
        else                                                                   updates.status = currentOrder.status || newStatus;

        if (newStatus === 'started' && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed' && stageKey === 'tv_final') updates.comp_date = now;
    }

    // Update TV stage cumulative qty column in work_orders
    if (!keepStatus && session !== 0) updates[stageKey + '_qty_completed'] = newCum;

    const actionLabel = keepStatus ? "can't start" : newStatus;
    const sessionStr  = (!keepStatus && session !== 0)
        ? (session > 0 ? '+' + session : String(session)) : '';
    const cumStr      = keepStatus ? String(prevCum) : String(newCum);
    const histLine    = `${stagePrefix}|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes     = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    // Log to wo_progress_events (fire-and-forget)
    insertProgressEvent({
        workOrderId:         id,
        woNumber:            currentOrder.wo_number || '',
        department:          'TV Assy',
        stage:               stageKey,
        operatorName:        opName,
        action:              keepStatus ? "can't start" : newStatus,
        sessionQty:          session,
        cumulativeQtyAfter:  keepStatus ? prevCum : newCum,
        reason:              reason || ''
    });

    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// TV Assy Stock: write one action entry, additive qty, structured history
export async function submitTvStockAction({ id, currentOrder, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator name required') };

    const prevQty  = parseFloat(currentOrder.qty_completed) || 0;
    const session  = parseFloat(sessionQty) || 0;
    const newCum   = Math.max(0, prevQty + session);
    const now      = new Date().toISOString();
    const ts       = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates.status        = newStatus;
        updates.qty_completed = newCum;
        updates.operator      = opName;
        if (newStatus === 'started' && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed') updates.comp_date = now;
    }

    const actionLabel = keepStatus ? "can't start" : newStatus;
    const sessionStr  = (!keepStatus && session !== 0)
        ? (session > 0 ? '+' + session : String(session)) : '';
    const cumStr      = keepStatus ? String(prevQty) : String(newCum);
    // Pipe-delimited history line: TVST|ts|operator|action|sessionQty|cumQty|reason
    const histLine = `TVST|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    // Log to wo_progress_events (fire-and-forget)
    insertProgressEvent({
        workOrderId:         id,
        woNumber:            currentOrder.wo_number || '',
        department:          'TV Assy',
        stage:               'stock',
        operatorName:        opName,
        action:              keepStatus ? "can't start" : newStatus,
        sessionQty:          session,
        cumulativeQtyAfter:  keepStatus ? prevQty : newCum,
        reason:              reason || ''
    });

    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// TC Assy Unit: per-stage action with cumulative qty derived from notes history
export async function submitTcUnitStageAction({ id, currentOrder, stageKey, stagePrefix, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const prefix    = stagePrefix + '|';
    const noteLines = (currentOrder.notes || '').split('\n');
    const stageLast = noteLines.filter(l => l.startsWith(prefix)).at(-1);
    const prevCum   = stageLast ? parseFloat(stageLast.split('|')[5]) || 0 : 0;
    const session   = parseFloat(sessionQty) || 0;
    const newCum    = Math.max(0, prevCum + session);

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates[stageKey + '_status']   = newStatus;
        updates[stageKey + '_operator'] = opName;
        updates.operator = opName;

        // Recompute overall WO status from 2 TC stages
        const pre = stageKey === 'tc_pre_lap' ? newStatus : (currentOrder.tc_pre_lap_status || '');
        const fin = stageKey === 'tc_final'   ? newStatus : (currentOrder.tc_final_status   || '');
        if      (fin === 'completed')                    updates.status = 'completed';
        else if (pre === 'started' || fin === 'started') updates.status = 'started';
        else if (pre === 'paused'  || fin === 'paused')  updates.status = 'paused';
        else if (pre === 'on_hold' || fin === 'on_hold') updates.status = 'on_hold';
        else                                              updates.status = currentOrder.status || newStatus;

        if (newStatus === 'started'   && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed' && stageKey === 'tc_final')   updates.comp_date  = now;
    }

    // Update TC stage cumulative qty column in work_orders
    if (!keepStatus && session !== 0) updates[stageKey + '_qty_completed'] = newCum;

    const actionLabel = keepStatus ? "can't start" : newStatus;
    const sessionStr  = (!keepStatus && session !== 0)
        ? (session > 0 ? '+' + session : String(session)) : '';
    const cumStr      = keepStatus ? String(prevCum) : String(newCum);
    const histLine    = `${stagePrefix}|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes     = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    // Log to wo_progress_events (fire-and-forget)
    insertProgressEvent({
        workOrderId:         id,
        woNumber:            currentOrder.wo_number || '',
        department:          'TC Assy',
        stage:               stageKey,
        operatorName:        opName,
        action:              keepStatus ? "can't start" : newStatus,
        sessionQty:          session,
        cumulativeQtyAfter:  keepStatus ? prevCum : newCum,
        reason:              reason || ''
    });

    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// TC Assy Unit: mark whole WO complete regardless of stage completion
export async function completeTcWo({ id, currentOrder, opName }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });
    // TCWOC|ts|operator|WO completed (manual)|||
    const histLine = `TCWOC|${ts}|${opName}|WO completed (manual)|||`;
    const notes    = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    // Log to wo_progress_events (fire-and-forget)
    insertProgressEvent({
        workOrderId:         id,
        woNumber:            currentOrder.wo_number || '',
        department:          'TC Assy',
        stage:               null,
        operatorName:        opName,
        action:              'WO completed (manual)',
        sessionQty:          0,
        cumulativeQtyAfter:  currentOrder.qty_required || 0,
        reason:              ''
    });

    return withRetry(() =>
        supabase.from('work_orders').update({
            status:        'completed',
            qty_completed: currentOrder.qty_required || 0,
            comp_date:     now,
            operator:      opName,
            notes
        }).eq('id', id).select()
    );
}

// TC Assy Stock: write one action entry, additive qty, structured history
export async function submitTcStockAction({ id, currentOrder, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator name required') };

    const prevQty  = parseFloat(currentOrder.qty_completed) || 0;
    const session  = parseFloat(sessionQty) || 0;
    const newCum   = Math.max(0, prevQty + session);
    const now      = new Date().toISOString();
    const ts       = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates.status        = newStatus;
        updates.qty_completed = newCum;
        updates.operator      = opName;
        if (newStatus === 'started' && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed') updates.comp_date = now;
    }

    const actionLabel = keepStatus ? "can't start" : newStatus;
    const sessionStr  = (!keepStatus && session !== 0)
        ? (session > 0 ? '+' + session : String(session)) : '';
    const cumStr      = keepStatus ? String(prevQty) : String(newCum);
    // Pipe-delimited history line: TCST|ts|operator|action|sessionQty|cumQty|reason
    const histLine = `TCST|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    // Log to wo_progress_events (fire-and-forget)
    insertProgressEvent({
        workOrderId:         id,
        woNumber:            currentOrder.wo_number || '',
        department:          'TC Assy',
        stage:               'stock',
        operatorName:        opName,
        action:              keepStatus ? "can't start" : newStatus,
        sessionQty:          session,
        cumulativeQtyAfter:  keepStatus ? prevQty : newCum,
        reason:              reason || ''
    });

    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// Create a new manual work order (TV Assy / TC Assy only)
export async function insertManualWorkOrder({ partNumber, description, qty, dept, woType, tcJobMode, salesOrder, unitSerial, engine, engineSerial, numBlades }) {
    if (!partNumber) return { data: null, error: new Error('Part number is required') };
    if (!dept)       return { data: null, error: new Error('Department is required') };

    // Use timestamp-based suffix for collision avoidance
    const woNumber = 'MANUAL-' + Date.now().toString(36).toUpperCase().slice(-5);

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
            .in('department', ['Fab', 'Weld', 'TV Assy', 'TC Assy'])
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

export async function receiveWorkOrder(order, qty, receivedBy) {
    if (!receivedBy) return { data: null, error: new Error('Receiver name is required') };
    if (!order)      return { data: null, error: new Error('No order selected') };

    const payload = {
        wo_number:   order.wo_number,
        part_number: order.part_number,
        description: order.description,
        qty_required: order.qty_required,
        qty_received: qty || order.qty_completed || order.qty_required || 0,
        received_by:  receivedBy.trim(),
        erp_status:   'received',
        received_at:  new Date().toISOString()
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

    // 3 parallel queries
    const [completedRes, activeRes, trackingRes] = await Promise.all([
        withRetry(() =>
            supabase.from('work_orders')
                .select('id,wo_number,part_number,description,department,comp_date')
                .eq('status', 'completed')
                .lt('comp_date', sevenDaysAgo.toISOString())
        ),
        withRetry(() =>
            supabase.from('work_orders')
                .select('id,wo_number,part_number,description,department,status,start_date,qty_completed,created_at')
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
            supabase.from('work_orders')
                .select('wo_number,part_number,description,qty_completed')
                .in('wo_number', woNums)
        );
        const woMap = {};
        (wos || []).forEach(w => { woMap[w.wo_number] = w; });
        qtyMismatch = receivedOnly
            .filter(t => {
                const wo = woMap[t.wo_number];
                if (!wo) return false;
                return parseFloat(t.qty_received) !== parseFloat(wo.qty_completed);
            })
            .map(t => ({
                id:            t.id,
                wo_number:     t.wo_number,
                qty_received:  t.qty_received,
                qty_completed: woMap[t.wo_number]?.qty_completed,
                part_number:   woMap[t.wo_number]?.part_number,
                description:   woMap[t.wo_number]?.description
            }))
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
    return withRetry(() =>
        supabase.from('work_orders').select('*').neq('status', 'completed')
    );
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

export async function setWorkOrderPriority(id, priority) {
    if (id === undefined || id === null) return { data: null, error: new Error('Missing ID') };
    const p = parseInt(priority, 10);
    if (isNaN(p) || p < 0 || p > 5)    return { data: null, error: new Error('Priority must be 0-5') };

    return withRetry(() =>
        supabase.from('work_orders').update({ priority: p }).eq('id', id).select()
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
