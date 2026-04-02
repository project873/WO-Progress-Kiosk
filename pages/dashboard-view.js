// ============================================================
// pages/dashboard-view.js — Work order dashboard logic
//
// Handles: open action panel, update status, substages,
//          manual WO creation, notes, undo
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { deepClone, sanitizeText, isNonEmpty, isValidQty, detectTcMode } from '../libs/utils.js';
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
    loadWoFiles(order.wo_number);
}

// ── WO file attachment handlers ───────────────────────────────

// Load the file list for a WO number into store.woFiles
export async function loadWoFiles(woNumber) {
    if (!woNumber) { store.woFiles.value = []; return; }
    store.woFilesLoading.value = true;
    const { data, error } = await db.listWoFiles(woNumber);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Could not load files: ' + error.message); return; }
    store.woFiles.value = data || [];
}

// Handle file picker change event — upload selected file then refresh list
export async function handleWoFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !store.activeOrder.value?.wo_number) return;
    event.target.value = '';   // reset so the same file can be re-uploaded
    store.woFilesLoading.value = true;
    const { error } = await db.uploadWoFile(store.activeOrder.value.wo_number, file);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Upload failed: ' + error.message); return; }
    store.showToast('File uploaded.', 'success');
    await loadWoFiles(store.activeOrder.value.wo_number);
}

// Delete a file from storage then refresh the list
export async function handleWoFileDelete(filename) {
    if (!store.activeOrder.value?.wo_number) return;
    const path = `${store.activeOrder.value.wo_number}/${filename}`;
    store.woFilesLoading.value = true;
    const { error } = await db.deleteWoFile(path);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Delete failed: ' + error.message); return; }
    await loadWoFiles(store.activeOrder.value.wo_number);
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
    const dept = store.selectedDept.value;

    // ── TC Assy: specific validation + save ───────────────────
    if (dept === 'Tru Cut Assy') {
        const errors = store.newWoFormErrors.value;
        errors.part    = !isNonEmpty(form.part);
        errors.desc    = !isNonEmpty(form.desc);
        errors.qty     = !isValidQty(form.qty) || parseInt(form.qty, 10) < 1;

        if (errors.part || errors.desc || errors.qty) return;

        store.loading.value = true;
        try {
            const { error } = await db.insertManualWorkOrder({
                partNumber:   sanitizeText(form.part),
                description:  sanitizeText(form.desc),
                qty:          parseInt(form.qty, 10),
                dept,
                woType:       store.tcNewWoMode.value === 'unit' ? 'Unit' : 'Subassy',
                tcJobMode:    store.tcNewWoMode.value || 'stock',
                customWoNumber: sanitizeText(form.woNumber),
                unitSerial:   sanitizeText(form.unitSerial),
                engine:       sanitizeText(form.engine),
                engineSerial: sanitizeText(form.engineSerial),
                numBlades:    sanitizeText(form.numBlades)
            });
            if (error) throw error;

            store.newWoModalOpen.value  = false;
            store.newWoFormErrors.value = { part: false, desc: false, qty: false };
            store.newWoForm.value = { part: '', desc: '', qty: 1, type: 'Unit', woNumber: '', salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '' };
            store.tcNewWoModeOverride.value = null;
            await _refreshDeptOrders();
            store.showToast('Work order added to board.', 'success');
        } catch (err) {
            store.showToast('Failed to add work order: ' + err.message);
        } finally {
            store.loading.value = false;
        }
        return;
    }

    // ── Generic / TV Assy: original flow unchanged ─────────────
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
            dept,
            woType:      form.type
        });
        if (error) throw error;

        store.newWoModalOpen.value = false;
        store.newWoForm.value = { part: '', desc: '', qty: 1, type: 'Unit', woNumber: '', salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '' };
        await _refreshDeptOrders();
        store.showToast('Work order added to board.', 'success');
    } catch (err) {
        store.showToast('Failed to add work order: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── toggleTcNewWoMode ────────────────────────────────────────
// Flips the user override for the new TC WO form between unit and stock.
// If no auto-detected mode exists, defaults the override to 'unit'.
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
    } finally {
        store.loading.value = false;
    }
}

// ── Internal helpers ──────────────────────────────────────────

// Always skips the entry modal and goes directly to the workflow screen.
// Mode resolution: saved tv_job_mode → 'unit' default.
// If no operator is saved, opens the inline name editor automatically.
export function openTvAssyEntry(order) {
    const mode = order.tv_job_mode || 'unit';
    store.tvAssyEntryName.value = order.operator || '';
    if (mode === 'unit') openTvAssyUnit(order);
    else                 openTvAssyStock(order);
    // Set AFTER open functions — they both reset opEditing to false
    store.tvAssyOpEditing.value = !order.operator;
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
    store.tvAssyOpEditing.value  = false;
    // Reset all stage pending states so reopening shows a clean slate
    const blank = { pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false };
    store.tvEngStage.value = { ...blank };
    store.tvCrtStage.value = { ...blank };
    store.tvFinStage.value = { ...blank };
    // Persist mode on first selection so future openings skip the choice screen
    if (!order.tv_job_mode) {
        db.saveTvJobMode(order.id, 'unit').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

export function openTvAssyStock(order) {
    store.activeOrder.value        = order;
    store.tvAssyJobType.value      = 'stock';
    store.tvAssyEntryOpen.value    = false;
    store.tvAssyStockOpen.value    = true;
    store.tvAssyOpEditing.value  = false;
    store.tvStockPending.value     = '';
    store.tvStockSessionQty.value  = '';
    store.tvStockReason.value      = '';
    store.tvStockQtyError.value    = false;
    store.tvStockReasonError.value = false;
    // Persist mode on first selection so future openings skip the choice screen
    if (!order.tv_job_mode) {
        db.saveTvJobMode(order.id, 'stock').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
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

// Single-screen entry: validate name then route to unit or stock workflow
export function tvAssyContinue(mode) {
    if (!store.tvAssyEntryName.value.trim()) {
        store.tvAssyNameError.value = true;
        return;
    }
    store.tvAssyNameError.value = false;
    const order = store.activeOrder.value;
    if (mode === 'unit')  openTvAssyUnit(order);
    else                  openTvAssyStock(order);
}

// ── TC Assy entry ──────────────────────────────────────────────
// Always skips the entry modal and goes directly to the workflow screen.
// Mode resolution: saved tc_job_mode → detectTcMode(part#) → 'stock' default.
// If no operator is saved, opens the inline name editor automatically.
export function openTcAssyEntry(order) {
    const mode = order.tc_job_mode || detectTcMode(order.part_number) || 'stock';
    store.tcAssyEntryName.value = order.operator || '';
    if (mode === 'unit') openTcAssyUnit(order);
    else                 openTcAssyStock(order);
    // Set AFTER openTcAssyUnit/Stock — they both reset opEditing to false
    store.tcAssyOpEditing.value = !order.operator;
}

// ── toggleTcEntryMode ────────────────────────────────────────
// Flips the user override in the entry modal between unit and stock.
export function toggleTcEntryMode() {
    const current = store.tcEntryMode.value;
    store.tcEntryModeOverride.value = current === 'unit' ? 'stock' : 'unit';
}

export function tcAssyContinue(mode) {
    if (!store.tcAssyEntryName.value.trim()) {
        store.tcAssyNameError.value = true;
        return;
    }
    store.tcAssyNameError.value = false;
    const order = store.activeOrder.value;
    if (mode === 'unit')  openTcAssyUnit(order);
    else                  openTcAssyStock(order);
}

export function openTcAssyUnit(order) {
    store.activeOrder.value     = order;
    store.tcAssyJobType.value   = 'unit';
    store.tcAssyEntryOpen.value = false;
    store.tcAssyUnitOpen.value  = true;
    store.tcAssyOpEditing.value = false;
    const _blank = { pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false };
    store.tcPreStage.value = { ..._blank };
    store.tcFinStage.value = { ..._blank };
    store.tcUnitInfoForm.value = {
        salesOrder:   order.sales_order                    || '',
        unitSerial:   order.unit_serial_number             || '',
        engine:       order.engine                         || '',
        engineSerial: order.engine_serial_number           || '',
        numBlades:    order.num_blades                     || '',
        notes:        order.tc_assy_notes_differences_mods || '',
    };
    // Persist mode on first selection
    if (!order.tc_job_mode) {
        db.saveTcJobMode(order.id, 'unit').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

// ── saveTcUnitDetails ─────────────────────────────────────────
// Saves all unit info fields from the TC Unit workflow screen.
export async function saveTcUnitDetails() {
    const order = store.activeOrder.value;
    if (!order) return;
    store.loading.value = true;
    try {
        const result = await db.saveTcUnitInfo(order.id, store.tcUnitInfoForm.value);
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('Details saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save details: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

export function openTcAssyStock(order) {
    store.activeOrder.value        = order;
    store.tcAssyJobType.value      = 'stock';
    store.tcAssyEntryOpen.value    = false;
    store.tcAssyStockOpen.value    = true;
    store.tcAssyOpEditing.value    = false;
    store.tcStockPending.value     = '';
    store.tcStockSessionQty.value  = '';
    store.tcStockReason.value      = '';
    store.tcStockQtyError.value    = false;
    store.tcStockReasonError.value = false;
    store.tcStockNotes.value       = order.tc_assy_notes_differences_mods || '';
    // Persist mode on first selection
    if (!order.tc_job_mode) {
        db.saveTcJobMode(order.id, 'stock').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

export async function submitTcStockActionFromUi() {
    const order      = store.activeOrder.value;
    const pending    = store.tcStockPending.value;
    const operator   = store.tcAssyEntryName.value;
    const sessionQty = store.tcStockSessionQty.value;
    const reason     = store.tcStockReason.value.trim();
    const notes      = pending === 'complete' ? store.tcStockNotes.value.trim() : '';

    store.tcStockQtyError.value    = false;
    store.tcStockReasonError.value = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        store.tcStockQtyError.value = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        store.tcStockReasonError.value = true; hasError = true;
    }
    if (hasError) return;

    const STATUS_MAP = { start: 'started', pause: 'paused', resume: 'started', complete: 'completed', hold: 'on_hold', cant_start: null };
    const keepStatus = pending === 'cant_start';

    store.loading.value = true;
    try {
        const result = await db.submitTcStockAction({
            id:           order.id,
            currentOrder: order,
            newStatus:    STATUS_MAP[pending],
            opName:       operator,
            sessionQty:   (pending === 'pause' || pending === 'complete') ? parseFloat(sessionQty) : 0,
            reason,
            keepStatus,
            notes
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.tcStockPending.value    = '';
        store.tcStockSessionQty.value = '';
        store.tcStockReason.value     = '';
        store.tcStockNotes.value      = updated.tc_assy_notes_differences_mods || '';
        store.showToast('Action recorded', 'success');
    } catch (err) {
        store.showToast('Failed: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── saveTcStockNotes ──────────────────────────────────────────
// Saves the notes/differences/mods textarea on the subassy screen.
// Can be called at any point during the workflow.
export async function saveTcStockNotes() {
    const order = store.activeOrder.value;
    if (!order) return;
    store.loading.value = true;
    try {
        const result = await db.saveTcAssyNotes(order.id, store.tcStockNotes.value);
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('Notes saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save notes: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

export async function submitTcUnitStageFromUi(stageName) {
    const stageRef   = stageName === 'prelap' ? store.tcPreStage : store.tcFinStage;
    const stageKey   = stageName === 'prelap' ? 'tc_pre_lap' : 'tc_final';
    const prefix     = stageName === 'prelap' ? 'TCPRE' : 'TCFIN';
    const order      = store.activeOrder.value;
    const pending    = stageRef.value.pending;
    const operator   = store.tcAssyEntryName.value;
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
        const result = await db.submitTcUnitStageAction({
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

export function openTcAssyCompleteModal() {
    const order    = store.activeOrder.value;
    const operator = store.tcAssyEntryName.value.trim();
    if (!operator) {
        store.showToast('Enter your name before completing the WO.', 'error');
        return;
    }
    store.tcAssyCompleteForm.value = {
        salesOrder:   order.sales_order || '',
        unitSerial:   order.unit_serial_number || '',
        engine:       order.engine || '',
        engineSerial: order.engine_serial_number || '',
        numBlades:    order.num_blades || '',
        notes:        ''
    };
    store.tcAssyCompleteErrors.value = {
        salesOrder: false, unitSerial: false, engine: false, engineSerial: false, numBlades: false
    };
    store.tcAssyCompleteModalOpen.value = true;
}

export async function confirmTcWoComplete() {
    const order = store.activeOrder.value;
    const operator = store.tcAssyEntryName.value.trim();
    const form = store.tcAssyCompleteForm.value;
    const errors = store.tcAssyCompleteErrors.value;

    // Unit fields are only required for unit mode
    if (order.tc_job_mode === 'unit') {
        errors.salesOrder   = !isNonEmpty(form.salesOrder);
        errors.unitSerial   = !isNonEmpty(form.unitSerial);
        errors.engine       = !isNonEmpty(form.engine);
        errors.engineSerial = !isNonEmpty(form.engineSerial);
        errors.numBlades    = !isNonEmpty(form.numBlades);
        if (errors.salesOrder || errors.unitSerial || errors.engine || errors.engineSerial || errors.numBlades) {
            return;
        }
    }

    store.loading.value = true;
    try {
        const result = await db.completeTcWo({ 
            id: order.id, 
            currentOrder: order, 
            opName: operator,
            unitFields: {
                sales_order: form.salesOrder,
                unit_serial_number: form.unitSerial,
                engine: form.engine,
                engine_serial_number: form.engineSerial,
                num_blades: form.numBlades
            },
            notes: form.notes
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('WO marked complete', 'success');
        store.tcAssyCompleteModalOpen.value = false;
    } catch (err) {
        store.showToast('Failed: ' + err.message);
    } finally {
        store.loading.value = false;
    }
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
