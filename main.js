// ============================================================
// main.js — Entry point. Wires together all modules.
//
// Imports:
//  - Vue (ESM build from CDN)
//  - Store (reactive state + computed values)
//  - All page controllers (splash, dashboard, wo-status, manager, cs)
//
// RULES:
//  - No business logic here — just wiring
//  - Global error handler prevents silent failures / blue screens
//  - Clock lifecycle is managed here (not inside store)
// ============================================================

import {
    createApp,
    onMounted,
    onUnmounted,
    watch
} from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── State & computed ──────────────────────────────────────────
import * as store from './libs/store.js';
import { OPERATORS_BY_DEPT, HOLD_REASONS, SCRAP_REASONS } from './libs/config.js';
import { formatDateLocal } from './libs/utils.js';

// ── Page controllers ──────────────────────────────────────────
import { selectDept, promptPin, submitPin, goBack } from './pages/splash-view.js';
import {
    openActionPanel, getFinalOperatorName, getFabWeldOperatorName, holdSince,
    updateOrderStatus, undoLastAction,
    submitNewWo, submitNote
} from './pages/dashboard-view.js';
import {
    searchOfficeReceive, openReceiveModal, submitReceive,
    openCloseoutModal, submitCloseout, loadReceivingEligible
} from './pages/wo-status-view.js';
import {
    openManagerSection, loadKpiData, loadDelayedOrders,
    fetchPriorityOrders, updatePriority, openNotesPanel
} from './pages/manager-view.js';
import { searchCS } from './pages/cs-view.js';

// ── Show loading fallback until Vue mounts ────────────────────
// The #app-loading div in index.html is visible by default and hidden here.
// If Vue never mounts (any error), the loading screen stays visible with an error.
const loadingEl = document.getElementById('app-loading');

// ── Vue App ───────────────────────────────────────────────────
try {
    const app = createApp({
        setup() {
            // Clock: update every second, cleanup on unmount (memory leak prevention)
            const clockInterval = setInterval(() => {
                store.currentTime.value = new Date().toLocaleTimeString([], {
                    hour:   '2-digit',
                    minute: '2-digit'
                });
            }, 1000);
            onUnmounted(() => clearInterval(clockInterval));

            // Remove loading fallback once Vue successfully mounts
            onMounted(() => {
                if (loadingEl) loadingEl.remove();
            });

            // Load receiving eligible list whenever entering the WO Status view
            watch(store.currentView, (v) => {
                if (v === 'wo_status') loadReceivingEligible();
            });

            // ── Expose everything the templates need ──────────
            return {
                // Navigation state
                currentView:   store.currentView,
                selectedDept:  store.selectedDept,
                loading:       store.loading,
                currentTime:   store.currentTime,
                appTitle:      store.appTitle,

                // Dashboard
                orders:             store.orders,
                allOrders:          store.allOrders,
                dashboardCategories: store.dashboardCategories,
                groupedOrders:      store.groupedOrders,
                isReel:             store.isReel,
                OPERATORS_BY_DEPT,
                HOLD_REASONS,
                SCRAP_REASONS,

                // Action panel
                actionPanelOpen:  store.actionPanelOpen,
                activeOrder:      store.activeOrder,
                selectedOperator:       store.selectedOperator,
                selectedOperators:      store.selectedOperators,
                fabWeldOperatorReady:   store.fabWeldOperatorReady,
                holdSince,
                otherOperator:    store.otherOperator,
                actionForm:       store.actionForm,

                // New WO modal
                newWoModalOpen: store.newWoModalOpen,
                newWoForm:      store.newWoForm,

                // Notes modal
                notesPanelOpen:  store.notesPanelOpen,
                noteAuthor:      store.noteAuthor,
                noteText:        store.noteText,
                noteAuthorError: store.noteAuthorError,
                noteTextError:   store.noteTextError,

                // Undo
                lastUndoAction: store.lastUndoAction,

                // Auth / PIN
                pinModalOpen: store.pinModalOpen,
                pinMode:      store.pinMode,
                pinInput:     store.pinInput,

                // Office / WO Status
                officeMode:           store.officeMode,
                officeSearchTerm:     store.officeSearchTerm,
                officeSearchResults:  store.officeSearchResults,
                receiveEligibleList:  store.receiveEligibleList,
                officeSuccessMsg:     store.officeSuccessMsg,
                officeCloseoutFilter: store.officeCloseoutFilter,
                filteredCloseoutOrders: store.filteredCloseoutOrders,
                woStatusOrders:       store.woStatusOrders,
                receiveModalOpen:     store.receiveModalOpen,
                receiveTarget:        store.receiveTarget,
                receiverName:         store.receiverName,
                receiverQty:          store.receiverQty,
                receiverNameError:    store.receiverNameError,
                closeoutModalOpen:    store.closeoutModalOpen,
                closeoutTarget:       store.closeoutTarget,
                closeoutName:         store.closeoutName,
                closeoutNameError:    store.closeoutNameError,

                // Manager
                managerSubView: store.managerSubView,
                priorityDept:   store.priorityDept,
                priorityOrders: store.priorityOrders,
                delayedOrders:  store.delayedOrders,
                kpiStats:       store.kpiStats,
                kpiByOperator:  store.kpiByOperator,
                kpiCycleTime:   store.kpiCycleTime,
                kpiHoldReasons: store.kpiHoldReasons,
                kpiOldestWos:   store.kpiOldestWos,

                // CS
                csSearchTerm:  store.csSearchTerm,
                csResultInfo:  store.csResultInfo,
                csTimeline:    store.csTimeline,
                csOpenOrders:  store.csOpenOrders,

                // Toast
                toastMessage: store.toastMessage,
                toastType:    store.toastType,

                // ── Actions ────────────────────────────────────
                // Navigation
                selectDept, promptPin, submitPin, goBack,

                // Dashboard
                openActionPanel, updateOrderStatus, undoLastAction,
                submitNewWo, submitNote,

                // Office
                searchOfficeReceive, openReceiveModal, submitReceive,
                openCloseoutModal, submitCloseout, loadReceivingEligible,

                // Manager
                openManagerSection, loadKpiData, loadDelayedOrders,
                fetchPriorityOrders, updatePriority, openNotesPanel,

                // CS
                searchCS,

                // Utilities available in templates
                formatDateLocal
            };
        }
    });

    // ── Vue runtime error handler ─────────────────────────────
    // Catches errors that happen AFTER mount (during user interactions)
    app.config.errorHandler = (err, vm, info) => {
        console.error('[Vue Error]', info, err);
        store.showToast('Something went wrong. Please try again.', 'error');
    };

    app.mount('#app');

} catch (err) {
    // ── Mount error handler ───────────────────────────────────
    // Catches errors that happen DURING app creation / mount
    console.error('[Mount Error]', err);
    if (loadingEl) {
        loadingEl.innerHTML = `
            <div style="text-align:center;padding:2rem;">
                <h2 style="font-size:2rem;font-weight:bold;color:#ef4444;margin-bottom:1rem;">App Failed to Load</h2>
                <p style="color:#94a3b8;margin-bottom:0.5rem;">${err.message}</p>
                <button onclick="location.reload()"
                    style="background:#2563eb;color:white;padding:0.75rem 2rem;border-radius:0.5rem;
                           font-weight:bold;border:none;cursor:pointer;font-size:1.125rem;margin-top:1rem;">
                    Reload Page
                </button>
            </div>`;
    }
}
