// ============================================================
// pages/wo-status-view.js — Office receiving & close-out logic
//
// Handles: search for WOs, receive modal, close-out modal,
//          refresh of tracking data
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { isNonEmpty, sanitizeText } from '../libs/utils.js';

// ── searchOfficeReceive ───────────────────────────────────────
export async function searchOfficeReceive() {
    const term = store.officeSearchTerm.value.trim();
    if (!term) return;

    store.loading.value          = true;
    store.officeSuccessMsg.value = '';

    try {
        const { data, error } = await db.searchWoForReceive(term);
        if (error) throw error;
        store.officeSearchResults.value = data || [];
    } catch (err) {
        store.showToast('Search failed: ' + err.message);
        store.officeSearchResults.value = [];
    } finally {
        store.loading.value = false;
    }
}

// ── openReceiveModal ──────────────────────────────────────────
export function openReceiveModal(order) {
    store.receiveTarget.value     = order;
    store.receiverName.value      = '';
    store.receiverQty.value       = null;
    store.receiverNameError.value = false;
    store.receiveModalOpen.value  = true;
}

// ── submitReceive ─────────────────────────────────────────────
export async function submitReceive() {
    store.receiverNameError.value = !isNonEmpty(store.receiverName.value);
    if (store.receiverNameError.value) return;

    store.loading.value = true;
    try {
        const order = store.receiveTarget.value;
        const qty   = store.receiverQty.value
                        || order.qty_completed
                        || order.qty_required
                        || 0;

        const { error } = await db.receiveWorkOrder(
            order,
            qty,
            sanitizeText(store.receiverName.value)
        );
        if (error) throw error;

        // Success: show confirmation, clear search, refresh list
        const woNum   = order.wo_number;
        const recName = sanitizeText(store.receiverName.value);
        store.receiveModalOpen.value     = false;
        store.officeSuccessMsg.value     = `WO #${woNum} received by ${recName} \u2713`;
        store.officeSearchTerm.value     = '';
        store.officeSearchResults.value  = [];

        await _refreshWoStatusData();

        // Auto-clear success message after 5 seconds
        setTimeout(() => { store.officeSuccessMsg.value = ''; }, 5000);
    } catch (err) {
        store.showToast('Failed to receive: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── openCloseoutModal ─────────────────────────────────────────
export function openCloseoutModal(order) {
    store.closeoutTarget.value     = order;
    store.closeoutName.value       = '';
    store.closeoutNameError.value  = false;
    store.closeoutModalOpen.value  = true;
}

// ── submitCloseout ────────────────────────────────────────────
export async function submitCloseout() {
    store.closeoutNameError.value = !isNonEmpty(store.closeoutName.value);
    if (store.closeoutNameError.value) return;

    store.loading.value = true;
    try {
        const { error } = await db.closeOutWorkOrder(
            store.closeoutTarget.value.id,
            sanitizeText(store.closeoutName.value)
        );
        if (error) throw error;

        store.closeoutModalOpen.value = false;
        store.showToast('Work order closed out successfully.', 'success');
        await _refreshWoStatusData();
    } catch (err) {
        store.showToast('Failed to close out: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── Internal helpers ──────────────────────────────────────────

async function _refreshWoStatusData() {
    try {
        const { woStatus, closeout, error } = await db.fetchWoStatusOrders();
        if (error) throw error;
        store.woStatusOrders.value = woStatus;
        store.closeoutOrders.value = closeout;
    } catch (err) {
        store.showToast('Failed to refresh WO status data: ' + err.message);
    }
}
