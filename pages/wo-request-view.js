// ============================================================
// pages/wo-request-view.js — WO Request form logic
//
// Handles: loading requests, submitting, inline field saves,
//          selecting for detail editing, save, approve.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadWoRequests — fetch all requests (oldest first) and populate store + inline state.
export async function loadWoRequests() {
    store.woRequestsLoading.value = true;
    try {
        const { data, error } = await db.fetchWoRequests();
        if (error) throw error;
        const rows = data || [];
        store.woRequests.value = rows;
        // Populate inline editable state for each row (preserve existing input if still present)
        const prev  = store.woRequestInlineState.value;
        const state = {};
        rows.forEach(r => {
            state[r.id] = {
                alere_qty:          (prev[r.id]?.alere_qty          ?? '') !== '' ? prev[r.id].alere_qty          : (r.alere_qty          ?? ''),
                alere_bin:          (prev[r.id]?.alere_bin          ?? '') !== '' ? prev[r.id].alere_bin          : (r.alere_bin          || ''),
                qty_sold_used_12mo: (prev[r.id]?.qty_sold_used_12mo ?? '') !== '' ? prev[r.id].qty_sold_used_12mo : (r.qty_sold_used_12mo ?? ''),
                where_used:         (prev[r.id]?.where_used         ?? '') !== '' ? prev[r.id].where_used         : (r.where_used         || ''),
            };
        });
        store.woRequestInlineState.value = state;
    } catch (err) {
        store.showToast('Failed to load WO requests: ' + err.message);
        logError('loadWoRequests', err);
        store.woRequests.value = [];
    } finally {
        store.woRequestsLoading.value = false;
    }
}

// resetWoRequestForm — clear the submission form and validation errors.
export function resetWoRequestForm() {
    store.woRequestForm.value = {
        part_number: '', description: '', sales_order_number: '',
        qty_on_order: '', qty_in_stock: '', qty_used_per_unit: '',
        submitted_by: ''
    };
    store.woRequestFormErrors.value = { part_number: false, qty_in_stock: false, qty_used_per_unit: false, submitted_by: false };
}

// submitWoRequestForm — validate, insert new request, reload list.
export async function submitWoRequestForm() {
    const form   = store.woRequestForm.value;
    const errors = { part_number: false, qty_in_stock: false, qty_used_per_unit: false, submitted_by: false };
    if (!form.part_number.trim())                                      errors.part_number      = true;
    if (form.qty_in_stock === ''     || form.qty_in_stock     == null) errors.qty_in_stock     = true;
    if (form.qty_used_per_unit === '' || form.qty_used_per_unit == null) errors.qty_used_per_unit = true;
    if (!form.submitted_by.trim())                                     errors.submitted_by     = true;
    store.woRequestFormErrors.value = errors;
    if (errors.part_number || errors.qty_in_stock || errors.qty_used_per_unit || errors.submitted_by) return;

    store.loading.value = true;
    try {
        const { error } = await db.submitWoRequest(form);
        if (error) throw error;
        resetWoRequestForm();
        store.showToast('WO request submitted.', 'success');
        await loadWoRequests();
    } catch (err) {
        store.showToast('Failed to submit request: ' + err.message, 'error');
        logError('submitWoRequestForm', err);
    } finally {
        store.loading.value = false;
    }
}

// saveWoRequestInlineFields — silently save the 4 inline card fields for a request row.
// Called on @blur of any inline input. Updates the list item in place so the modal
// sees fresh values if opened immediately after.
export async function saveWoRequestInlineFields(id) {
    const s = store.woRequestInlineState.value[id];
    if (!s) return;
    const updates = {
        alere_qty:          s.alere_qty          !== '' ? parseFloat(s.alere_qty)          : null,
        alere_bin:          (s.alere_bin || '').trim()  || null,
        qty_sold_used_12mo: s.qty_sold_used_12mo  !== '' ? parseFloat(s.qty_sold_used_12mo) : null,
        where_used:         (s.where_used || '').trim()  || null,
    };
    try {
        const { error } = await db.updateWoRequest(id, updates);
        if (error) throw error;
        // Update item in place so the modal reads fresh data if opened next
        const idx = store.woRequests.value.findIndex(r => r.id === id);
        if (idx !== -1) {
            store.woRequests.value[idx] = { ...store.woRequests.value[idx], ...updates };
        }
    } catch (err) {
        store.showToast('Failed to save: ' + err.message, 'error');
        logError('saveWoRequestInlineFields', err, { id });
    }
}

// boolToYesNo — maps a boolean DB value to 'yes'/'no'/'' for dropdown binding.
function boolToYesNo(val) {
    if (val === true)  return 'yes';
    if (val === false) return 'no';
    return '';
}

// openWoRequestDetail — select a request and populate the manager detail form.
// Boolean DB fields (fab, weld, bent_rolled_part) are mapped to 'yes'/'no' strings
// to support <select> binding. fab_print/weld_print store 'yes'/'no' as text.
export function openWoRequestDetail(req) {
    store.selectedWoRequest.value   = req;
    store.woRequestDetailForm.value = {
        alere_qty:           req.alere_qty           ?? '',
        qty_sold_used_12mo:  req.qty_sold_used_12mo  ?? '',
        where_used:          req.where_used          || '',
        qty_to_make:         req.qty_to_make         ?? '',
        fab:                 req.fab       || '',   // TEXT 'yes'/'no' after migration
        fab_print:           req.fab_print === 'yes' ? 'yes' : req.fab_print === 'no' ? 'no' : '',
        weld:                req.weld      || '',   // TEXT area name after migration
        weld_print:          req.weld_print === 'yes' ? 'yes' : req.weld_print === 'no' ? 'no' : '',
        assy_wo:             req.assy_wo             || '',
        color:               req.color               || '',
        bent_rolled_part:    boolToYesNo(req.bent_rolled_part),
        set_up_time:         req.set_up_time         ?? '',
        alere_bin:           req.alere_bin           || '',
        estimated_lead_time: req.estimated_lead_time ?? '',
        sent_to_production:  req.sent_to_production  ?? false,
        date_to_start:       req.date_to_start       || ''
    };
}

export function closeWoRequestDetail() {
    store.selectedWoRequest.value = null;
}

// _buildDetailUpdates — shared helper to convert the detail form to DB update shape.
function _buildDetailUpdates(form) {
    return {
        alere_qty:           form.alere_qty          !== '' ? parseFloat(form.alere_qty)          : null,
        qty_sold_used_12mo:  form.qty_sold_used_12mo !== '' ? parseFloat(form.qty_sold_used_12mo) : null,
        where_used:          form.where_used.trim()  || null,
        qty_to_make:         form.qty_to_make        !== '' ? parseFloat(form.qty_to_make)        : null,
        fab:                 form.fab      || null,   // TEXT 'yes'/'no'
        fab_print:           form.fab_print || null,
        weld:                form.weld                || null,   // TEXT area name
        weld_print:          form.weld_print          || null,
        assy_wo:             form.assy_wo             || null,
        color:               form.color.trim()        || null,
        bent_rolled_part:    form.bent_rolled_part === 'yes' ? true : form.bent_rolled_part === 'no' ? false : null,
        set_up_time:         form.set_up_time         !== '' ? parseFloat(form.set_up_time)        : null,
        alere_bin:           form.alere_bin.trim()    || null,
        estimated_lead_time: form.estimated_lead_time !== '' ? parseFloat(form.estimated_lead_time): null,
        sent_to_production:  form.sent_to_production,
        date_to_start:       form.date_to_start       || null,
    };
}

// _syncAfterSave — reload list and re-sync selectedWoRequest after a detail save.
async function _syncAfterSave(id) {
    await loadWoRequests();
    const updated = store.woRequests.value.find(r => r.id === id);
    if (updated) store.selectedWoRequest.value = updated;
}

// saveWoRequestDetail — save manager fields without changing status.
export async function saveWoRequestDetail() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;

    store.loading.value = true;
    try {
        const { error } = await db.updateWoRequest(id, _buildDetailUpdates(form));
        if (error) throw error;
        store.showToast('Saved.', 'success');
        await _syncAfterSave(id);
    } catch (err) {
        store.showToast('Failed to save: ' + err.message, 'error');
        logError('saveWoRequestDetail', err, { id });
    } finally {
        store.loading.value = false;
    }
}

// approveWoRequest — validate all 10 required production fields, then save + set status='approved'.
// Required: qty_to_make, estimated_lead_time, date_to_start, weld, weld_print,
//           fab, fab_print, bent_rolled_part, set_up_time, assy_wo.
export async function approveWoRequest() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;

    const missing = [];
    if (form.qty_to_make        === '' || form.qty_to_make        == null) missing.push('Qty to Make');
    if (form.estimated_lead_time === '' || form.estimated_lead_time == null) missing.push('Est. Lead Time');
    if (!form.date_to_start)                                                missing.push('Date to Start');
    if (!form.weld)                                                         missing.push('Weld');
    if (!form.weld_print)                                                   missing.push('Weld Print');
    if (!form.fab)                                                          missing.push('Fab');
    if (!form.fab_print)                                                    missing.push('Fab Print');
    if (!form.bent_rolled_part)                                             missing.push('Bent / Rolled Part');
    if (form.set_up_time        === '' || form.set_up_time        == null) missing.push('Set Up Time');
    if (!form.assy_wo)                                                      missing.push('Assy WO');

    if (missing.length > 0) {
        store.showToast('Missing required: ' + missing.join(', '), 'error', 7000);
        return;
    }

    store.loading.value = true;
    try {
        const updates = { ..._buildDetailUpdates(form), status: 'approved' };
        const { error } = await db.updateWoRequest(id, updates);
        if (error) throw error;
        store.showToast('Approved — ready to create WO.', 'success');
        await _syncAfterSave(id);
    } catch (err) {
        store.showToast('Failed to approve: ' + err.message, 'error');
        logError('approveWoRequest', err, { id });
    } finally {
        store.loading.value = false;
    }
}

// deleteWoRequestItem — confirm then hard-delete a request.
export async function deleteWoRequestItem(id) {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    if (store.selectedWoRequest.value?.id === id) store.selectedWoRequest.value = null;
    store.loading.value = true;
    try {
        const { error } = await db.deleteWoRequest(id);
        if (error) throw error;
        store.showToast('Request deleted.', 'success');
        await loadWoRequests();
    } catch (err) {
        store.showToast('Failed to delete request: ' + err.message, 'error');
        logError('deleteWoRequestItem', err, { id });
    } finally {
        store.loading.value = false;
    }
}
