// ============================================================
// libs/db-inventory.js — Inventory, WO Requests, Open Orders queries
//
// Extracted from db.js to keep files under 500 lines.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { detectTcMode } from './utils.js';

// ── Inventory queries ─────────────────────────────────────────

const INVENTORY_TABLES = new Set(['chute', 'hitch', 'engine', 'hardware', 'hoses']);

function assertInventoryTable(table) {
    if (!INVENTORY_TABLES.has(table)) throw new Error(`Invalid inventory table: ${table}`);
}

// fetchInventory — all rows from <table>_inventory, ordered by part_number.
export async function fetchInventory(table) {
    assertInventoryTable(table);
    return withRetry(() =>
        supabase.from(`${table}_inventory`)
            .select('*')
            .order('part_number', { ascending: true })
    );
}

// addInventoryItem — insert a new part into <table>_inventory.
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

// deleteInventoryItem — hard delete. Pull log rows cascade-delete via FK.
export async function deleteInventoryItem(table, id) {
    assertInventoryTable(table);
    if (!id) return { data: null, error: new Error('Missing inventory item ID') };
    return withRetry(() =>
        supabase.from(`${table}_inventory`).delete().eq('id', id).select()
    );
}

// recordPull — inserts a pull log row and decrements qty on the inventory row.
export async function recordPull(table, inventoryId, pull) {
    assertInventoryTable(table);
    if (!inventoryId)           return { data: null, error: new Error('Missing inventory item ID') };
    if (!pull?.name?.trim())    return { data: null, error: new Error('Name is required') };
    const qtyPulled = parseFloat(pull.qty_pulled);
    if (!qtyPulled || qtyPulled <= 0) return { data: null, error: new Error('qty_pulled must be a positive number') };

    const { data: current, error: fetchErr } = await withRetry(() =>
        supabase.from(`${table}_inventory`).select('qty').eq('id', inventoryId).single()
    );
    if (fetchErr) return { data: null, error: fetchErr };

    const newQty = (parseFloat(current.qty) || 0) - qtyPulled;

    const { error: updateErr } = await withRetry(() =>
        supabase.from(`${table}_inventory`).update({
            qty:        newQty,
            updated_at: new Date().toISOString()
        }).eq('id', inventoryId)
    );
    if (updateErr) return { data: null, error: updateErr };

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

// insertWorkOrdersFromRequest — creates work_order rows from an approved WO request.
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

    const weldArea  = (req.weld       || '').trim();
    const fab       = (req.fab        || '').trim().toLowerCase();
    const fabPrint  = (req.fab_print  || '').trim().toLowerCase();
    const weldPrint = (req.weld_print || '').trim().toLowerCase();

    if (fab === 'yes' && fabPrint === 'yes') {
        const fabRow = { ...base, department: 'Fab' };
        if (weldArea && weldPrint !== 'yes') {
            fabRow.fab_bring_to = weldArea;
        }
        inserts.push(fabRow);
    }

    if (weldArea && weldArea !== 'Paint' && weldPrint === 'yes') {
        const weldRow = {
            ...base,
            department: 'Weld',
            priority:   weldArea === 'Urgent' ? 5 : 0,
        };
        if (weldArea !== 'Urgent') weldRow.notes = `Weld Area: ${weldArea}`;
        inserts.push(weldRow);
    }

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

export async function fetchApprovedWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('status', 'approved')
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// fetchCreatedWoRequests — all wo_requests with status 'created', 'in production', or 'completed', newest first.
export async function fetchCreatedWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .in('status', ['created', 'in production', 'completed'])
            .order('created_date', { ascending: false })
            .order('created_at',   { ascending: false })
    );
}

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

export async function fetchWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('forecasted', false)
            .eq('status', 'pending')
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// fetchForecastedRequests — returns all wo_requests rows marked forecasted=true.
export async function fetchForecastedRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('forecasted', true)
            .order('forecast_date', { ascending: true })
            .order('created_at',    { ascending: true })
    );
}

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

export async function updateWoRequest(id, updates) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.from('wo_requests').update(updates).eq('id', id).select()
    );
}

export async function deleteWoRequest(id) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.from('wo_requests').delete().eq('id', id).select()
    );
}

// ── Open Orders queries ───────────────────────────────────────

// findOpenOrderBySoAndPart — find a single open_orders row matching both SO# and part number.
// Used for WO Request → Open Orders status sync on submit, approve, and create.
export async function findOpenOrderBySoAndPart(soNumber, partNumber) {
    if (!soNumber || !partNumber) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('open_orders')
            .select('id, status, wo_po_number, deadline')
            .eq('sales_order',  soNumber.trim())
            .eq('part_number',  partNumber.trim().toUpperCase())
            .limit(1)
    );
    return { data: (data && data[0]) || null, error };
}

// findOpenOrdersByPartNumber — look up open_orders rows matching a part number
// that also have a sales_order value, for the WO Request SO# hint feature.
export async function findOpenOrdersByPartNumber(partNumber) {
    if (!partNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('open_orders')
            .select('id, part_number, sales_order, to_ship')
            .eq('part_number', partNumber.trim().toUpperCase())
            .not('sales_order', 'is', null)
    );
}

export async function fetchOpenOrders() {
    return withRetry(() =>
        supabase.from('open_orders')
            .select('*')
            .order('sort_order', { ascending: true })
    );
}

// fetchWorkOrdersByWoNumber — active WOs matching a given wo_number (for open order drill-down).
// Returns key production fields only; excludes completed orders.
export async function fetchWorkOrdersByWoNumber(woNumber) {
    if (!woNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('id,wo_number,part_number,description,department,status,operator,qty_completed,qty_required,start_date,due_date')
            .eq('wo_number', woNumber.trim())
            .neq('status', 'completed')
    );
}

export async function updateOpenOrder(id, updates) {
    if (!id) return { data: null, error: new Error('Missing order ID') };
    updates.updated_at = new Date().toISOString();
    return withRetry(() =>
        supabase.from('open_orders').update(updates).eq('id', id).select()
    );
}

export async function insertOpenOrders(rows) {
    if (!rows?.length) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('open_orders').insert(rows).select()
    );
}

export async function deleteOpenOrder(id) {
    if (!id) return { error: new Error('Missing order ID') };
    return withRetry(() =>
        supabase.from('open_orders').delete().eq('id', id)
    );
}

// ── Completed Orders queries ──────────────────────────────────

// shipOpenOrder — copies a row from open_orders into completed_orders then deletes the original.
// row: full open_orders object. shipped_at is set to now().
export async function shipOpenOrder(row) {
    const now = new Date().toISOString();
    const { id, created_at, updated_at, ...fields } = row;
    const { error: insertErr } = await withRetry(() =>
        supabase.from('completed_orders').insert([{
            ...fields,
            original_id: id,
            status:      'Shipped',
            shipped_at:  now,
            updated_at:  now,
        }])
    );
    if (insertErr) return { error: insertErr };
    return withRetry(() => supabase.from('open_orders').delete().eq('id', id));
}

// fetchCompletedOrders — all completed_orders rows, oldest shipped first.
export async function fetchCompletedOrders() {
    return withRetry(() =>
        supabase.from('completed_orders')
            .select('*')
            .order('shipped_at', { ascending: true })
    );
}

// deleteCompletedOrder — hard-delete one completed_orders row (used by Restore).
export async function deleteCompletedOrder(id) {
    if (!id) return { error: new Error('Missing completed order ID') };
    return withRetry(() => supabase.from('completed_orders').delete().eq('id', id));
}
