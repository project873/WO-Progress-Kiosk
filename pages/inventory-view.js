// ============================================================
// pages/inventory-view.js — Inventory tab logic
//
// Handles: loading items, adding/editing/deleting parts, recording pulls,
//          viewing pull history.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';

// loadInventoryItems — fetch all rows for the current tab and update store.
// Called on tab entry and after every mutation.
export async function loadInventoryItems() {
    store.inventoryLoading.value = true;
    try {
        const { data, error } = await db.fetchInventory(store.inventoryTab.value);
        if (error) throw error;
        store.inventoryItems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load inventory: ' + err.message);
        store.inventoryItems.value = [];
    } finally {
        store.inventoryLoading.value = false;
    }
}

// switchInventoryTab — change active tab and reload items.
// Input: tab ('chute'|'hitch'|'engine'|'hardware'|'hoses').
export async function switchInventoryTab(tab) {
    store.inventoryTab.value    = tab;
    store.inventorySearch.value = '';
    await loadInventoryItems();
}

// ── Pull form ─────────────────────────────────────────────────

// openPullForm — open pull form for a specific inventory item.
export function openPullForm(item) {
    store.pullFormTarget.value = item;
    store.pullForm.value = {
        name:         '',
        qty_pulled:   '',
        new_location: '',
        where_used:   '',
        date_pulled:  new Date().toISOString().slice(0, 10)
    };
    store.pullFormErrors.value = { name: false, qty_pulled: false };
    store.pullFormOpen.value   = true;
}

export function closePullForm() {
    store.pullFormOpen.value   = false;
    store.pullFormTarget.value = null;
}

// submitPull — validate, insert pull log row + decrement qty, reload.
export async function submitPull() {
    const form   = store.pullForm.value;
    const errors = { name: false, qty_pulled: false };
    if (!form.name.trim())                                errors.name       = true;
    if (!form.qty_pulled || parseFloat(form.qty_pulled) <= 0) errors.qty_pulled = true;
    store.pullFormErrors.value = errors;
    if (errors.name || errors.qty_pulled) return;

    store.loading.value = true;
    try {
        const { error } = await db.recordPull(
            store.inventoryTab.value,
            store.pullFormTarget.value.id,
            form
        );
        if (error) throw error;
        store.pullFormOpen.value = false;
        store.showToast('Pull recorded.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to record pull: ' + err.message, 'error');
    } finally {
        store.loading.value = false;
    }
}

// ── Add item form ─────────────────────────────────────────────

export function openAddItemForm() {
    store.addItemForm.value       = { part_number: '', description: '', qty: 0, location: '', refill_location: '' };
    store.addItemFormErrors.value = { part_number: false };
    store.addItemFormOpen.value   = true;
}

export function closeAddItemForm() {
    store.addItemFormOpen.value = false;
}

// submitAddItem — validate + insert new part row, reload.
export async function submitAddItem() {
    const form = store.addItemForm.value;
    if (!form.part_number.trim()) {
        store.addItemFormErrors.value.part_number = true;
        return;
    }
    store.loading.value = true;
    try {
        const { error } = await db.addInventoryItem(store.inventoryTab.value, form);
        if (error) throw error;
        store.addItemFormOpen.value = false;
        store.showToast('Part added.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to add part: ' + err.message, 'error');
    } finally {
        store.loading.value = false;
    }
}

// ── Edit item form ────────────────────────────────────────────

// openEditItemForm — pre-fill edit form with current row values.
export function openEditItemForm(item) {
    store.editItemFormTarget.value = item;
    store.editItemForm.value       = {
        part_number:     item.part_number,
        description:     item.description     || '',
        qty:             item.qty,
        location:        item.location        || '',
        refill_location: item.refill_location || ''
    };
    store.editItemFormErrors.value = { part_number: false };
    store.editItemFormOpen.value   = true;
}

export function closeEditItemForm() {
    store.editItemFormOpen.value   = false;
    store.editItemFormTarget.value = null;
}

// submitEditItem — validate + update row, reload.
export async function submitEditItem() {
    const form = store.editItemForm.value;
    if (!form.part_number.trim()) {
        store.editItemFormErrors.value.part_number = true;
        return;
    }
    store.loading.value = true;
    try {
        const { error } = await db.updateInventoryItem(
            store.inventoryTab.value,
            store.editItemFormTarget.value.id,
            form
        );
        if (error) throw error;
        store.editItemFormOpen.value = false;
        store.showToast('Part updated.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to update part: ' + err.message, 'error');
    } finally {
        store.loading.value = false;
    }
}

// ── Delete ────────────────────────────────────────────────────

// confirmDeleteInventoryItem — confirm dialog, then hard delete (pull log cascades).
export async function confirmDeleteInventoryItem(item) {
    if (!confirm(`Delete ${item.part_number}? Pull history will also be removed. This cannot be undone.`)) return;
    store.loading.value = true;
    try {
        const { error } = await db.deleteInventoryItem(store.inventoryTab.value, item.id);
        if (error) throw error;
        store.showToast('Part deleted.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to delete part: ' + err.message, 'error');
    } finally {
        store.loading.value = false;
    }
}

// ── Pull history ──────────────────────────────────────────────

// openPullHistory — load pull log for an item and show history modal.
export async function openPullHistory(item) {
    store.pullHistoryTarget.value  = item;
    store.pullHistoryItems.value   = [];
    store.pullHistoryLoading.value = true;
    store.pullHistoryOpen.value    = true;
    try {
        const { data, error } = await db.fetchPullHistory(store.inventoryTab.value, item.id);
        if (error) throw error;
        store.pullHistoryItems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load pull history: ' + err.message, 'error');
    } finally {
        store.pullHistoryLoading.value = false;
    }
}

export function closePullHistory() {
    store.pullHistoryOpen.value   = false;
    store.pullHistoryTarget.value = null;
    store.pullHistoryItems.value  = [];
}
