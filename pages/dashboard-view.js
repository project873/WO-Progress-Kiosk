// ============================================================
// pages/dashboard-view.js — Work order dashboard logic
//
// Handles: open action panel, update status, substages,
//          manual WO creation, notes, undo
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { deepClone, sanitizeText, isNonEmpty, isValidQty } from '../libs/utils.js';
import { fetchDeptOrders } from '../libs/db.js';

// ── openActionPanel ───────────────────────────────────────────
export function openActionPanel(order) {
    store.activeOrder.value      = order;
    store.actionPanelOpen.value  = true;
    store.selectedOperator.value = order.operator || '';
    store.otherOperator.value    = '';
    store.selectedOperators.value = [];
    store.actionForm.value       = {
        qtyCompleted: (order.department === 'Fab' || order.department === 'Weld') ? 0 : (order.qty_completed || 0),
        qtyScrap:     0,
        scrapReason:  '',
        notes:        '',
        holdReason:   '',
        weldGrind:    ''
    };
}

// ── getFinalOperatorName ──────────────────────────────────────
// Returns the selected operator name (resolves "Other" to free-text field)
export function getFinalOperatorName() {
    return store.selectedOperator.value === 'Other'
        ? store.otherOperator.value.trim()
        : store.selectedOperator.value;
}

// ── updateOrderStatus ─────────────────────────────────────────
// Main action: update a WO's status (and optionally a sub-stage).
// Validates inputs, saves undo snapshot, writes to DB, refreshes list.
export async function updateOrderStatus(newStatus, stageKey = null) {
    const dept = store.activeOrder.value?.department;
    const opName = (dept === 'Fab' || dept === 'Weld')
        ? getFabWeldOperatorName()
        : getFinalOperatorName();
    if (!opName) {
        store.showToast('Select or enter your operator name first.', 'error');
        return;
    }
    if (store.isReel.value && !store.actionForm.value.weldGrind && newStatus === 'started') {
        store.showToast('Select Weld or Grind for this reel part.', 'error');
        return;
    }
    if (newStatus === 'on_hold' && !store.actionForm.value.holdReason.trim()) {
        store.showToast('Select a hold reason first.', 'error');
        return;
    }

    store.loading.value = true;

    // Capture undo snapshot BEFORE writing
    const previousSnapshot = deepClone(store.activeOrder.value);
    const undoDesc = `${opName}: ${newStatus}${stageKey ? ' (' + stageKey + ')' : ''} on WO ${store.activeOrder.value.wo_number}`;

    try {
        const { data, error } = await db.updateOrderStatus({
            id:           store.activeOrder.value.id,
            currentOrder: store.activeOrder.value,
            newStatus,
            stageKey,
            opName,
            actionForm:   store.actionForm.value
        });
        if (error) throw error;

        // Store undo info after confirmed success
        store.lastUndoAction.value = {
            id:           store.activeOrder.value.id,
            previousData: previousSnapshot,
            description:  undoDesc,
            dept:         store.selectedDept.value
        };

        // START / RESUME (Fab/Weld only): stay in modal so operator can
        // immediately log qty and Pause or Complete without reopening.
        if (newStatus === 'started' && !stageKey) {
            // Update activeOrder from DB response so v-if chain flips to PAUSE+COMPLETE view
            store.activeOrder.value = (data && data[0]) ? data[0] : { ...store.activeOrder.value, status: 'started' };
            store.actionForm.value  = { ...store.actionForm.value, qtyCompleted: 0 };
        } else {
            store.actionPanelOpen.value = false;
        }
        await _refreshDeptOrders();
    } catch (err) {
        store.showToast('Failed to update status: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── undoLastAction ────────────────────────────────────────────
// Restores the pre-mutation snapshot of the last changed WO
export async function undoLastAction() {
    if (!store.lastUndoAction.value) return;

    store.loading.value = true;
    try {
        const { id, previousData, dept } = store.lastUndoAction.value;
        const { error } = await db.restoreOrderSnapshot(id, previousData);
        if (error) throw error;

        store.lastUndoAction.value = null;
        store.showToast('Action undone successfully.', 'success');

        // Refresh the current dept view
        if (dept) {
            const { data, err } = await fetchDeptOrders(dept);
            if (!err) store.orders.value = data || [];
        }
    } catch (err) {
        store.showToast('Failed to undo. Please update manually. ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── submitNewWo ───────────────────────────────────────────────
// Creates a new manual work order for TV/TC Assy
export async function submitNewWo() {
    const form = store.newWoForm.value;
    if (!isNonEmpty(form.part)) {
        store.showToast('Part number is required.', 'error');
        return;
    }
    if (!isValidQty(form.qty) || parseInt(form.qty, 10) < 1) {
        store.showToast('Quantity must be at least 1.', 'error');
        return;
    }

    store.loading.value = true;
    try {
        const { error } = await db.insertManualWorkOrder({
            partNumber:  sanitizeText(form.part),
            description: sanitizeText(form.desc),
            qty:         parseInt(form.qty, 10),
            dept:        store.selectedDept.value,
            woType:      form.type
        });
        if (error) throw error;

        store.newWoModalOpen.value = false;
        store.newWoForm.value = { part: '', desc: '', qty: 1, type: 'Unit' };
        await _refreshDeptOrders();
        store.showToast('Work order added to board.', 'success');
    } catch (err) {
        store.showToast('Failed to add work order: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── submitNote ────────────────────────────────────────────────
// Appends a manager note to the active work order
export async function submitNote() {
    store.noteAuthorError.value = !isNonEmpty(store.noteAuthor.value);
    store.noteTextError.value   = !isNonEmpty(store.noteText.value);
    if (store.noteAuthorError.value || store.noteTextError.value) return;

    store.loading.value = true;
    try {
        const { data, error } = await db.appendManagerNote(
            store.activeOrder.value.id,
            store.activeOrder.value.manager_notes || '',
            sanitizeText(store.noteAuthor.value),
            sanitizeText(store.noteText.value)
        );
        if (error) throw error;

        // Update the active order and the card in the orders list immediately
        const updatedNotes = data && data[0] ? data[0].manager_notes : null;
        if (updatedNotes !== null) {
            store.activeOrder.value.manager_notes = updatedNotes;
            const idx = store.orders.value.findIndex(o => o.id === store.activeOrder.value.id);
            if (idx !== -1) store.orders.value[idx].manager_notes = updatedNotes;
        }

        store.noteText.value        = '';
        store.notesPanelOpen.value  = false;
        store.showToast('Note saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save note: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── Internal helpers ──────────────────────────────────────────

export function openTvAssyEntry(order) {
    store.activeOrder.value      = order;
    store.tvAssyEntryOpen.value  = true;
    store.tvAssyEntryStep.value  = 1;
    store.tvAssyEntryName.value  = '';
    store.tvAssyNameError.value  = false;
}

export async function submitTvUnitStageFromUi(stageName) {
    const stageRef   = stageName === 'engine' ? store.tvEngStage : stageName === 'cart' ? store.tvCrtStage : store.tvFinStage;
    const stageKey   = 'tv_' + stageName;
    const prefix     = stageName === 'engine' ? 'TVENG' : stageName === 'cart' ? 'TVCRT' : 'TVFIN';
    const order      = store.activeOrder.value;
    const pending    = stageRef.value.pending;
    const operator   = store.tvAssyEntryName.value;
    const sessionQty = stageRef.value.sessionQty;
    const reason     = stageRef.value.reason.trim();

    stageRef.value.qtyError    = false;
    stageRef.value.reasonError = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        stageRef.value.qtyError = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        stageRef.value.reasonError = true; hasError = true;
    }
    if (hasError) return;

    const STATUS_MAP = { start: 'started', pause: 'paused', resume: 'started', complete: 'completed', hold: 'on_hold', cant_start: null };
    const keepStatus = pending === 'cant_start';

    store.loading.value = true;
    try {
        const result = await db.submitTvUnitStageAction({
            id:           order.id,
            currentOrder: order,
            stageKey,
            stagePrefix:  prefix,
            newStatus:    STATUS_MAP[pending],
            opName:       operator,
            sessionQty:   (pending === 'pause' || pending === 'complete') ? parseFloat(sessionQty) : 0,
            reason,
            keepStatus
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        stageRef.value.pending    = '';
        stageRef.value.sessionQty = '';
        stageRef.value.reason     = '';
        store.showToast('Stage action recorded', 'success');
    } catch (err) {
        store.showToast('Failed: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

export function openTvAssyUnit(order) {
    store.activeOrder.value      = order;
    store.tvAssyJobType.value    = 'unit';
    store.tvAssyEntryOpen.value  = false;
    store.tvAssyUnitOpen.value   = true;
    // Reset all stage pending states so reopening shows a clean slate
    const blank = { pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false };
    store.tvEngStage.value = { ...blank };
    store.tvCrtStage.value = { ...blank };
    store.tvFinStage.value = { ...blank };
}

export function openTvAssyStock(order) {
    store.activeOrder.value        = order;
    store.tvAssyJobType.value      = 'stock';
    store.tvAssyEntryOpen.value    = false;
    store.tvAssyStockOpen.value    = true;
    store.tvStockPending.value     = '';
    store.tvStockSessionQty.value  = '';
    store.tvStockReason.value      = '';
    store.tvStockQtyError.value    = false;
    store.tvStockReasonError.value = false;
}

export async function submitTvStockActionFromUi() {
    const order    = store.activeOrder.value;
    const pending  = store.tvStockPending.value;
    const operator = store.tvAssyEntryName.value;
    const sessionQty = store.tvStockSessionQty.value;
    const reason   = store.tvStockReason.value.trim();

    store.tvStockQtyError.value    = false;
    store.tvStockReasonError.value = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        store.tvStockQtyError.value = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        store.tvStockReasonError.value = true; hasError = true;
    }
    if (hasError) return;

    const STATUS_MAP = { start: 'started', pause: 'paused', resume: 'started', complete: 'completed', hold: 'on_hold', cant_start: null };
    const keepStatus = pending === 'cant_start';

    store.loading.value = true;
    try {
        const result = await db.submitTvStockAction({
            id:           order.id,
            currentOrder: order,
            newStatus:    STATUS_MAP[pending],
            opName:       operator,
            sessionQty:   (pending === 'pause' || pending === 'complete') ? parseFloat(sessionQty) : 0,
            reason,
            keepStatus
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.tvStockPending.value    = '';
        store.tvStockSessionQty.value = '';
        store.tvStockReason.value     = '';
        store.showToast('Action recorded', 'success');
    } catch (err) {
        store.showToast('Failed: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

export function tvAssyNameContinue() {
    if (!store.tvAssyEntryName.value.trim()) {
        store.tvAssyNameError.value = true;
        return;
    }
    store.tvAssyNameError.value = false;
    store.tvAssyEntryStep.value = 2;
}

async function _refreshDeptOrders() {
    const dept = store.selectedDept.value;
    if (!dept) return;
    try {
        const { data, error } = await fetchDeptOrders(dept);
        if (error) throw error;
        store.orders.value = data || [];
    } catch (err) {
        store.showToast('Failed to refresh orders: ' + err.message);
    }
}

// ── getFabWeldOperatorName ────────────────────────────────────
// Resolves the Fab/Weld multi-select (with optional "Other" free-text)
// into a single " & "-joined string for storage in work_orders.operator.
export function getFabWeldOperatorName() {
    const base = store.selectedOperators.value.filter(o => o !== 'Other');
    if (store.selectedOperators.value.includes('Other')) {
        const typed = store.otherOperator.value.trim();
        if (typed) {
            typed.split(',').map(s => s.trim()).filter(Boolean).forEach(n => base.push(n));
        }
    }
    return base.join(' & ');
}

// ── holdSince ─────────────────────────────────────────────────
// Parses the last "ON HOLD" log entry from order.notes and returns
// the timestamp string, or null if the WO is not on hold / has no log.
export function holdSince(order) {
    if (!order || order.status !== 'on_hold' || !order.notes) return null;
    const lines = order.notes.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes(': ON HOLD')) {
            const m = lines[i].match(/^\[([^\]]+)\]/);
            return m ? m[1] : null;
        }
    }
    return null;
}
