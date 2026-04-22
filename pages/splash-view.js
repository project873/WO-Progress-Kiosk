// ============================================================
// pages/splash-view.js — Splash screen & navigation logic
//
// Handles: department selection, PIN auth, goBack
// Imports store state directly (no prop passing needed)
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { kioskSignIn, kioskSignOut } from '../libs/db.js';
import { MANAGER_PIN, CS_PIN, CLOSEOUT_PIN } from '../libs/config.js';
import { logError } from '../libs/db-shared.js';

// ── submitLogin ───────────────────────────────────────────────
// Validates username/password against Supabase Auth and sets sessionRole.
export async function submitLogin() {
    const username = store.loginUsername.value.trim().toLowerCase();
    const password = store.loginPassword.value;
    if (!username || !password) {
        store.loginError.value = 'Enter username and password.';
        return;
    }
    store.loginLoading.value = true;
    store.loginError.value   = '';
    try {
        const { role, error } = await kioskSignIn(username, password);
        if (error) throw error;
        if (!role) throw new Error('Account not configured. Contact manager.');
        store.sessionRole.value    = role;
        store.loginUsername.value  = '';
        store.loginPassword.value  = '';
        store.currentView.value    = 'splash';
        store.splashLevel.value    = 0;
        store.splashCategory.value = '';
    } catch {
        store.loginError.value = 'Incorrect username or password.';
    } finally {
        store.loginLoading.value = false;
    }
}

// ── logout ────────────────────────────────────────────────────
// Signs out of Supabase Auth and returns to the login screen.
export async function logout() {
    await kioskSignOut();
    store.sessionRole.value       = null;
    store.currentView.value       = 'login';
    store.splashLevel.value       = 0;
    store.splashCategory.value    = '';
    store.splashSubCategory.value = '';
    store.selectedDept.value      = '';
    store.actionPanelOpen.value   = false;
    store.pinModalOpen.value      = false;
}

// ── enterManagerView ──────────────────────────────────────────
// Navigates directly to manager hub (no PIN — session already verified as manager).
export async function enterManagerView() {
    store.currentView.value    = 'manager';
    store.managerSubView.value = 'home';
    store.loading.value = true;
    try {
        const { data, error } = await db.fetchAllActiveOrders();
        if (error) throw error;
        store.allOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load manager data: ' + err.message);
        logError('enterManagerView', err);
    } finally {
        store.loading.value = false;
    }
}

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
            logError('submitPin_manager', err);
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

// ── enterOpenOrdersView ───────────────────────────────────────
// Navigate to the Open Orders shipping view. Preserves shipping sub-menu
// as the back destination.
export function enterOpenOrdersView() {
    store.splashLevel.value       = 2;
    store.splashCategory.value    = 'production';
    store.splashSubCategory.value = 'shipping';
    store.currentView.value       = 'open_orders';
}

// ── enterWoForecastingView ────────────────────────────────────
// Navigate to the WO Forecasting view.
export function enterWoForecastingView() {
    store.splashLevel.value    = 1;
    store.splashCategory.value = 'production';
    store.currentView.value    = 'wo_forecasting';
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
        logError('_loadDeptOrders', err, { dept });
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
        logError('_loadWoStatusData', err);
    } finally {
        store.loading.value = false;
    }
}
