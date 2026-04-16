// ============================================================
// pages/completed-orders-view.js — Completed (Shipped) Orders view logic
//
// Handles: loading completed orders, restoring a row to open orders,
//          entering the view. Imports from store + db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// enterCompletedOrdersView — navigate to the completed orders view.
export function enterCompletedOrdersView() {
    store.currentView.value = 'completed_orders';
}

// loadCompletedOrders — fetch all completed_orders rows (oldest shipped first).
export async function loadCompletedOrders() {
    store.completedOrdersLoading.value = true;
    try {
        const { data, error } = await db.fetchCompletedOrders();
        if (error) throw error;
        store.completedOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load completed orders: ' + err.message);
        logError('loadCompletedOrders', err);
    } finally {
        store.completedOrdersLoading.value = false;
    }
}

// restoreCompletedOrder — move a row from completed_orders back to open_orders.
// Resets status to 'New/Picking' and clears shipped_at.
export async function restoreCompletedOrder(id) {
    if (!window.confirm('Restore this row to Open Orders?')) return;
    const row = store.completedOrders.value.find(o => o.id === id);
    if (!row) return;

    const { id: cId, original_id, shipped_at, created_at, updated_at, ...fields } = row;
    const { error: insertErr } = await db.insertOpenOrders([{
        ...fields,
        status:            'New/Picking',
        last_status_update: new Date().toISOString(),
    }]);
    if (insertErr) { store.showToast('Failed to restore: ' + insertErr.message); return; }

    const { error: deleteErr } = await db.deleteCompletedOrder(id);
    if (deleteErr) { store.showToast('Restored but failed to remove from Completed: ' + deleteErr.message); return; }

    store.completedOrders.value = store.completedOrders.value.filter(o => o.id !== id);
    store.showToast('Row restored to Open Orders.', 'success');
}
