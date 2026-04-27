// ============================================================
// pages/dashboard-view.js — Common dashboard logic + Fab/Weld
//
// Handles: open action panel, file attachments, updateStatus,
//          undo, manual WO creation, notes, WO problems,
//          Fab/Weld operator helpers.
//
// TV Assy logic → pages/dashboard-tv.js
// TC Assy logic → pages/dashboard-tc.js
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { deepClone, sanitizeText, isNonEmpty, isValidQty } from '../libs/utils.js';
import { fetchDeptOrders } from '../libs/db.js';
import { logError, fetchCompletedWosByDept, fetchArchivedWosByDept } from '../libs/db-shared.js';

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
        holdReason:   ''
    };
    store.reelWeldOperator.value  = '';
    store.reelGrindOperator.value = '';
    store.reelWeldOtherOp.value   = '';
    store.reelGrindOtherOp.value  = '';
    store.reelWeldQty.value       = 0;
    store.reelGrindQty.value      = 0;
    loadWoFiles(order.part_number);
}

// ── Part print attachment handlers ────────────────────────────
// Files are stored by Part # so uploads are shared across all WOs for the same part.

// Load the file list for a part number into store.woFiles
export async function loadWoFiles(partNumber) {
    if (!partNumber) { store.woFiles.value = []; return; }
    store.woFilesLoading.value = true;
    const { data, error } = await db.listWoFiles(partNumber);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Could not load files: ' + error.message); return; }
    store.woFiles.value = data || [];
}

// Handle file picker change event — upload selected file then refresh list
export async function handleWoFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !store.activeOrder.value?.part_number) return;
    event.target.value = '';   // reset so the same file can be re-uploaded
    store.woFilesLoading.value = true;
    const { error } = await db.uploadWoFile(store.activeOrder.value.part_number, file);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Upload failed: ' + error.message); return; }
    store.showToast('File uploaded.', 'success');
    await loadWoFiles(store.activeOrder.value.part_number);
}

// Delete a file from storage then refresh the list
export async function handleWoFileDelete(filename) {
    if (!store.activeOrder.value?.part_number) return;
    store.woFilesLoading.value = true;
    const { error } = await db.deleteWoFile(store.activeOrder.value.part_number, filename);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Delete failed: ' + error.message); return; }
    await loadWoFiles(store.activeOrder.value.part_number);
}

// ── getFinalOperatorName ──────────────────────────────────────
// Returns the typed operator name for the current action panel session.
export function getFinalOperatorName() {
    return store.selectedOperator.value.trim();
}

// ── updateOrderStatus ─────────────────────────────────────────
// Main action: update a WO's status (and optionally a sub-stage).
// Validates inputs, saves undo snapshot, writes to DB, refreshes list.
export async function updateOrderStatus(newStatus, stageKey = null) {
    const opName = getFinalOperatorName();
    if (!opName) {
        store.showToast('Select or enter your operator name first.', 'error');
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
        const { data, error, conflict } = await db.updateOrderStatus({
            id:           store.activeOrder.value.id,
            currentOrder: store.activeOrder.value,
            newStatus,
            stageKey,
            opName,
            actionForm:   store.actionForm.value
        });

        if (conflict) {
            store.showToast(
                'This WO was just updated by someone else. Refreshing — please review and try again.',
                'error', 6000
            );
            await _refreshDeptOrders();
            const fresh = store.orders.value.find(o => o.id === store.activeOrder.value.id);
            if (fresh) store.activeOrder.value = fresh;
            return;
        }
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
        logError('updateOrderStatus', err, { id: store.activeOrder.value?.id, newStatus });
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
        logError('undoLastAction', err, { id: store.lastUndoAction.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── submitNewWo ───────────────────────────────────────────────
// Creates a new manual work order for TV/TC Assy
export async function submitNewWo() {
    const form = store.newWoForm.value;
    const dept = store.selectedDept.value;

    // ── TC Assy: specific validation + save ───────────────────
    if (dept === 'Tru Cut Assy') {
        const errors = store.newWoFormErrors.value;
        errors.part = !isNonEmpty(form.part);
        errors.desc = !isNonEmpty(form.desc);

        if (errors.part || errors.desc) return;

        store.loading.value = true;
        try {
            const { error } = await db.insertManualWorkOrder({
                partNumber:     sanitizeText(form.part),
                description:    sanitizeText(form.desc),
                qty:            parseInt(form.qty, 10) || 1,
                dept,
                woType:         store.tcNewWoMode.value === 'unit' ? 'Unit' : 'Subassy',
                tcJobMode:      store.tcNewWoMode.value || 'stock',
                salesOrder:     sanitizeText(form.salesOrder),
                customWoNumber: sanitizeText(form.woNumber),
                unitSerial:     sanitizeText(form.unitSerial),
                engine:         sanitizeText(form.engine),
                engineSerial:   sanitizeText(form.engineSerial),
                numBlades:      sanitizeText(form.numBlades)
            });
            if (error) throw error;

            store.newWoModalOpen.value  = false;
            store.newWoFormErrors.value = { part: false, desc: false, qty: false };
            store.newWoForm.value = { part: '', desc: '', qty: 1, woType: 'Unit', woNumber: '', salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '' };
            store.tcNewWoModeOverride.value = null;
            await _refreshDeptOrders();
            store.showToast('Work order added to board.', 'success');
        } catch (err) {
            store.showToast('Failed to add work order: ' + err.message);
            logError('submitNewWo_tc', err, { dept, part: form.part });
        } finally {
            store.loading.value = false;
        }
        return;
    }

    // ── Generic / TV Assy ─────────────────────────────────────────
    if (!isNonEmpty(form.part)) {
        store.showToast('Part number is required.', 'error');
        return;
    }

    store.loading.value = true;
    try {
        const { error } = await db.insertManualWorkOrder({
            partNumber:     sanitizeText(form.part),
            description:    sanitizeText(form.desc),
            qty:            1,
            dept,
            salesOrder:     sanitizeText(form.salesOrder),
            customWoNumber: sanitizeText(form.woNumber)
        });
        if (error) throw error;

        store.newWoModalOpen.value = false;
        store.newWoForm.value = { part: '', desc: '', qty: 1, woType: 'Unit', woNumber: '', salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '' };
        await _refreshDeptOrders();
        store.showToast('Work order added to board.', 'success');
    } catch (err) {
        store.showToast('Failed to add work order: ' + err.message);
        logError('submitNewWo', err, { dept });
    } finally {
        store.loading.value = false;
    }
}

// ── toggleTcNewWoMode ────────────────────────────────────────
// Flips the user override for the new TC WO form between unit and stock.
export function toggleTcNewWoMode() {
    const current = store.tcNewWoMode.value;
    store.tcNewWoModeOverride.value = current === 'unit' ? 'stock' : 'unit';
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
        logError('submitNote', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── submitWoProblemFromUi ─────────────────────────────────────
// Save a WO problem from the action panel inline form.
export async function submitWoProblemFromUi() {
    let valid = true;
    if (!store.woProblemDraftText.value.trim()) {
        store.woProblemDraftError.value = true;
        valid = false;
    }
    if (!store.woProblemDraftName.value.trim()) {
        store.woProblemDraftNameError.value = true;
        valid = false;
    }
    if (!valid) return;

    const order = store.activeOrder.value;
    const name  = store.woProblemDraftName.value.trim();
    const text  = store.woProblemDraftText.value.trim();

    try {
        const { error } = await db.saveWoProblem(order.id, text, name);
        if (error) throw error;
        store.activeOrder.value = {
            ...store.activeOrder.value,
            wo_problem_text:       text,
            wo_problem_status:     'open',
            wo_problem_updated_by: name
        };
        const idx = store.orders.value.findIndex(o => o.id === order.id);
        if (idx !== -1) {
            store.orders.value[idx].wo_problem_text       = text;
            store.orders.value[idx].wo_problem_status     = 'open';
            store.orders.value[idx].wo_problem_updated_by = name;
        }
        store.woProblemDraftText.value      = '';
        store.woProblemDraftError.value     = false;
        store.woProblemDraftName.value      = '';
        store.woProblemDraftNameError.value = false;
        store.showToast('Problem logged.', 'success');
    } catch (err) {
        store.showToast('Failed to save problem: ' + err.message);
        logError('submitWoProblemFromUi', err, { id: store.activeOrder.value?.id });
    }
}

// ── _refreshDeptOrders ────────────────────────────────────────
// Private: re-fetch the current dept's orders after a status change.
async function _refreshDeptOrders() {
    const dept = store.selectedDept.value;
    if (!dept) return;
    try {
        const { data, error } = await fetchDeptOrders(dept);
        if (error) throw error;
        store.orders.value = data || [];
    } catch (err) {
        store.showToast('Failed to refresh orders: ' + err.message);
        logError('_refreshDeptOrders', err, { dept: store.selectedDept.value });
    }
}


// ── _getReelOpName ────────────────────────────────────────────
// Resolves the operator name for a reel operation.
// op: 'weld' | 'grind'. Returns '' if none selected.
function _getReelOpName(op) {
    const base = op === 'weld' ? store.reelWeldOperator.value : store.reelGrindOperator.value;
    if (base === 'Other') {
        return (op === 'weld' ? store.reelWeldOtherOp.value : store.reelGrindOtherOp.value).trim();
    }
    return base;
}

// ── _updateReelOp ─────────────────────────────────────────────
// Internal: validates, writes, and refreshes a single reel operation.
// op: 'weld' | 'grind', newStatus: 'started' | 'paused' | 'completed'
async function _updateReelOp(op, newStatus) {
    const opName = _getReelOpName(op);
    if (!opName) {
        store.showToast(`Select the ${op} operator first.`, 'error');
        return;
    }
    const sessionQty = parseFloat(op === 'weld' ? store.reelWeldQty.value : store.reelGrindQty.value) || 0;
    store.loading.value = true;
    const previousSnapshot = deepClone(store.activeOrder.value);
    try {
        const { data, error, conflict } = await db.updateReelOperation({
            id:           store.activeOrder.value.id,
            currentOrder: store.activeOrder.value,
            op, newStatus, opName, sessionQty
        });
        if (conflict) {
            store.showToast('This WO was just updated by someone else. Refreshing — please try again.', 'error', 6000);
            await _refreshDeptOrders();
            const fresh = store.orders.value.find(o => o.id === store.activeOrder.value.id);
            if (fresh) store.activeOrder.value = fresh;
            return;
        }
        if (error) throw error;
        store.lastUndoAction.value = {
            id:           store.activeOrder.value.id,
            previousData: previousSnapshot,
            description:  `${opName}: ${op} ${newStatus} on WO ${store.activeOrder.value.wo_number}`,
            dept:         store.selectedDept.value
        };
        // Reset session qty for this op after successful write
        if (op === 'weld') store.reelWeldQty.value = 0;
        else               store.reelGrindQty.value = 0;
        if (data && data[0]) store.activeOrder.value = data[0];
        await _refreshDeptOrders();
        store.showToast(`${op.charAt(0).toUpperCase() + op.slice(1)} ${newStatus}.`, 'success');
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('_updateReelOp', err, { id: store.activeOrder.value?.id, op, newStatus });
    } finally {
        store.loading.value = false;
    }
}

// Reel operation shortcuts
export function startReelOperation(op)    { return _updateReelOp(op, 'started');   }
export function pauseReelOperation(op)    { return _updateReelOp(op, 'paused');    }
export function completeReelOperation(op) { return _updateReelOp(op, 'completed'); }
// Revise a completed reel op — falls back to the stored operator, no fresh selection needed.
export async function reviseReelOperation(op) {
    const stored = op === 'weld' ? store.activeOrder.value?.weld_reel_operator : store.activeOrder.value?.grind_reel_operator;
    const opName = _getReelOpName(op) || stored || store.activeOrder.value?.operator || '';
    if (!opName) { store.showToast(`Select the ${op} operator first.`, 'error'); return; }
    if (op === 'weld') store.reelWeldOperator.value = opName;
    else               store.reelGrindOperator.value = opName;
    return _updateReelOp(op, 'paused');
}

// completeReelWo — explicitly completes the whole reel WO regardless of op statuses.
// Uses whichever reel operator is set, falling back to the current WO operator.
export async function completeReelWo() {
    const opName = store.reelWeldOperator.value || store.reelGrindOperator.value
        || store.activeOrder.value?.operator || '';
    if (!opName) {
        store.showToast('Select an operator before completing.', 'error');
        return;
    }
    store.loading.value = true;
    const previousSnapshot = deepClone(store.activeOrder.value);
    try {
        const { data, error, conflict } = await db.completeReelWo({
            id:           store.activeOrder.value.id,
            currentOrder: store.activeOrder.value,
            opName,
        });
        if (conflict) {
            store.showToast('This WO was just updated by someone else. Refreshing — please try again.', 'error', 6000);
            await _refreshDeptOrders();
            const fresh = store.orders.value.find(o => o.id === store.activeOrder.value.id);
            if (fresh) store.activeOrder.value = fresh;
            return;
        }
        if (error) throw error;
        store.lastUndoAction.value = {
            id:           store.activeOrder.value.id,
            previousData: previousSnapshot,
            description:  `${opName}: completed reel WO ${store.activeOrder.value.wo_number}`,
            dept:         store.selectedDept.value
        };
        await _refreshDeptOrders();
        store.actionPanelOpen.value = false;
        store.showToast('Work order completed.', 'success');
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('completeReelWo', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
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
// ── toggleCompletedDeptView — switches between active and completed view.
export async function toggleCompletedDeptView() {
    if (!store.showingCompletedDept.value) {
        store.completedDeptOrders.value = [];
        store.closedOutDeptOrders.value = [];
        const dept = store.selectedDept.value;
        store.showingCompletedDept.value = true;
        const [open, archived] = await Promise.all([
            fetchCompletedWosByDept(dept),
            fetchArchivedWosByDept(dept),
        ]);
        store.completedDeptOrders.value = open;
        store.closedOutDeptOrders.value = archived;
    } else {
        store.showingCompletedDept.value = false;
    }
}
