// ============================================================
// pages/splash-view.js — Splash screen & navigation logic
//
// Handles: department selection, PIN auth, goBack
// Imports store state directly (no prop passing needed)
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { MANAGER_PIN, CS_PIN, CLOSEOUT_PIN } from '../libs/config.js';

// ── selectCategory ────────────────────────────────────────────
// Navigate to a top-level category sub-menu (level 1).
export function selectCategory(cat) {
    store.splashCategory.value    = cat;
    store.splashSubCategory.value = '';
    store.splashLevel.value       = 1;
}

// ── selectSubCategory ─────────────────────────────────────────
// Navigate to a second-level sub-menu (level 2).
export function selectSubCategory(sub) {
    store.splashSubCategory.value = sub;
    store.splashLevel.value       = 2;
}

// ── splashBack ────────────────────────────────────────────────
// Step back one level within the splash navigation hierarchy.
export function splashBack() {
    if (store.splashLevel.value === 2) {
        store.splashLevel.value       = 1;
        store.splashSubCategory.value = '';
    } else {
        store.splashLevel.value    = 0;
        store.splashCategory.value = '';
    }
}

// ── promptPin ─────────────────────────────────────────────────
// Opens the PIN modal for manager or CS access
export function promptPin(role) {
    store.pinMode.value    = role;
    store.pinInput.value   = '';
    store.pinModalOpen.value = true;
}

// ── submitPin ─────────────────────────────────────────────────
// Validates PIN and navigates to the appropriate view
export async function submitPin() {
    const pin  = store.pinInput.value;
    const mode = store.pinMode.value;

    if (mode === 'manager' && pin === MANAGER_PIN) {
        store.pinModalOpen.value = false;
        store.currentView.value  = 'manager';
        store.managerSubView.value = 'home';
        // Pre-fetch all active orders for manager overview
        store.loading.value = true;
        try {
            const { data, error } = await db.fetchAllActiveOrders();
            if (error) throw error;
            store.allOrders.value = data || [];
        } catch (err) {
            store.showToast('Failed to load manager data: ' + err.message);
        } finally {
            store.loading.value = false;
        }
        return;
    }

    if (mode === 'cs' && pin === CS_PIN) {
        store.pinModalOpen.value = false;
        store.currentView.value  = 'cs';
        store.csSearchTerm.value = '';
        store.csResultInfo.value = null;
        store.csTimeline.value   = [];
        store.csOpenOrders.value = [];
        return;
    }

    if (mode === 'closeout_office' && pin === CLOSEOUT_PIN) {
        store.closeoutAuthorized.value = true;
        store.officeMode.value         = 'closeout';
        store.officeSearchTerm.value   = '';
        store.officeSearchResults.value = [];
        store.officeSuccessMsg.value   = '';
        store.pinModalOpen.value       = false;
        store.pinInput.value           = '';
        return;
    }

    store.showToast('Incorrect PIN. Please try again.', 'error', 3000);
    store.pinInput.value = '';
}

// ── selectDept ────────────────────────────────────────────────
// Navigate to a department view. Handles special routing for CS / WO Status.
export async function selectDept(dept) {
    // Customer Service — no PIN required
    if (dept === 'CS') {
        store.currentView.value  = 'cs';
        store.selectedDept.value = 'CS';
        store.csResultInfo.value = null;
        store.csTimeline.value   = [];
        store.csOpenOrders.value = [];
        return;
    }

    // Office / WO Status — load tracking data
    if (dept === 'WO Status') {
        store.currentView.value          = 'wo_status';
        store.selectedDept.value         = 'WO Status';
        store.officeMode.value           = 'receive';
        store.officeSearchTerm.value     = '';
        store.officeSearchResults.value  = [];
        store.officeSuccessMsg.value     = '';
        store.officeCloseoutFilter.value = '';
        await _loadWoStatusData();
        return;
    }

    // Production departments (Fab, Weld, TV Assy, TC Assy)
    store.selectedDept.value = dept;
    store.dashSearch.value   = '';
    store.currentView.value  = 'dashboard';
    await _loadDeptOrders(dept);
}

// ── enterWoRequestView ────────────────────────────────────────
// Navigate to the WO Request view. Sets splash state so Back returns
// to the Production sub-menu regardless of which entry point was used.
export function enterWoRequestView() {
    store.splashLevel.value    = 1;
    store.splashCategory.value = 'production';
    store.currentView.value    = 'wo_request';
}

// ── enterCreateWoView ─────────────────────────────────────────
// Navigate to the Create WO queue. Sets splash state so Back returns
// to the Production sub-menu.
export function enterCreateWoView() {
    store.splashLevel.value    = 1;
    store.splashCategory.value = 'production';
    store.currentView.value    = 'create_wo';
}

// ── enterInventoryView ────────────────────────────────────────
// Navigate to the inventory view for a specific tab.
// splashLevel/Category are preserved so goBack() returns to the inventory sub-menu.
export function enterInventoryView(tab) {
    store.inventoryTab.value    = tab;
    store.inventorySearch.value = '';
    store.inventoryItems.value  = [];
    store.currentView.value     = 'inventory';
}

// ── goBack ────────────────────────────────────────────────────
// Return to splash. Preserves splashLevel/Category/SubCategory so the
// user lands back on the sub-menu they came from, not the root.
export function goBack() {
    store.currentView.value    = 'splash';
    store.selectedDept.value   = '';
    store.dashSearch.value     = '';
    store.managerSubView.value = 'home';
    store.priorityDept.value   = '';
    store.priorityOrders.value = [];
    // Close any open modals
    store.actionPanelOpen.value  = false;
    store.newWoModalOpen.value   = false;
    store.notesPanelOpen.value   = false;
    store.pinModalOpen.value     = false;
}

// ── Internal helpers ──────────────────────────────────────────

async function _loadDeptOrders(dept) {
    store.loading.value = true;
    try {
        const [{ data, error }, partsSet] = await Promise.all([
            db.fetchDeptOrders(dept),
            db.fetchPartsWithFiles()
        ]);
        if (error) throw error;
        store.orders.value        = data || [];
        store.partsWithFiles.value = partsSet;
    } catch (err) {
        store.showToast('Failed to load orders: ' + err.message);
        store.orders.value = [];
    } finally {
        store.loading.value = false;
    }
}

async function _loadWoStatusData() {
    store.loading.value = true;
    try {
        const { woStatus, closeout, error } = await db.fetchWoStatusOrders();
        if (error) throw error;
        store.woStatusOrders.value = woStatus;
        store.closeoutOrders.value = closeout;
    } catch (err) {
        store.showToast('Failed to load WO status data: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}
