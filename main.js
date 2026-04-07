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
import { formatDateLocal, getStageCum, detectTcMode, sanitizePartKey } from './libs/utils.js';

// ── Page controllers ──────────────────────────────────────────
import { selectDept, promptPin, submitPin, goBack } from './pages/splash-view.js';
import {
    openActionPanel, openTvAssyEntry, tvAssyNameContinue, tvAssyContinue,
    submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
    openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
    saveTcStockNotes, saveTcUnitDetails,
    submitTcUnitStageFromUi, openTcAssyCompleteModal, confirmTcWoComplete, toggleTcNewWoMode,
    toggleTcEntryMode,
    getFinalOperatorName, getFabWeldOperatorName, holdSince,
    updateOrderStatus, undoLastAction,
    submitNewWo, submitNote, submitWoProblemFromUi,
    loadWoFiles, handleWoFileUpload, handleWoFileDelete
} from './pages/dashboard-view.js';
import { markAlereUpdated, signInAnonymously } from './libs/db.js';
import {
    searchOfficeReceive, openReceiveModal, submitReceive,
    openCloseoutModal, submitCloseout, loadReceivingEligible,
    openAlereConfirm, cancelAlereConfirm, submitAlereUpdated
} from './pages/wo-status-view.js';
import {
    openManagerSection, loadKpiData, loadDelayedOrders,
    fetchPriorityOrders, updatePriority, updateAssignedOperator,
    openNotesPanel, loadManagerAlerts,
    sendAiMessage,
    loadWoProblems, openWoProblemModal, closeWoProblemModal, confirmResolveWoProblem,
    openDelayedWoDetail, closeDelayedWoDetail
} from './pages/manager-view.js';
import { searchCS } from './pages/cs-view.js';

// ── Load HTML partials into #app before Vue mounts ───────────
// Fetches HTML fragment files from ./partials/ and concatenates them into #app.
// Vue reads the DOM at mount time, so partials must be injected first.
async function loadPartials() {
    const names = [
        'header', 'main-open',
        'view-splash', 'view-dashboard', 'view-office', 'view-manager', 'view-cs',
        'main-close',
        'modal-pin', 'modal-action-panel',
        'modal-tc-unit', 'modal-tc-stock',
        'modal-tv-unit', 'modal-tv-stock',
        'modal-misc'
    ];
    const chunks = await Promise.all(
        names.map(n => fetch(`./partials/${n}.html`).then(r => r.text()))
    );
    document.getElementById('app').innerHTML = chunks.join('\n');
}
await signInAnonymously();
await loadPartials();

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
            // Also pre-load manager alerts so the splash badge is populated immediately
            onMounted(() => {
                if (loadingEl) loadingEl.remove();
                loadManagerAlerts();
            });

            // Load data on view entry; reset Close-Out auth when leaving wo_status
            watch(store.currentView, (v) => {
                if (v !== 'wo_status') store.closeoutAuthorized.value = false;
                if (v === 'wo_status') loadReceivingEligible();
                if (v === 'manager')   loadManagerAlerts();
            });
            // Reload alerts when navigating back to Manager Hub home from any sub-section
            watch(store.managerSubView, (v) => {
                if (v === 'home' && store.currentView.value === 'manager') loadManagerAlerts();
            });

            // ── Expose everything the templates need ──────────
            // Close-Out mode switch: defined here in setup() to avoid cross-module caching issues.
            // Uses optional chaining so it degrades safely if closeoutAuthorized ref is missing.
            function goToCloseout() {
                store.officeSearchTerm.value    = '';
                store.officeSearchResults.value = [];
                store.officeSuccessMsg.value    = '';
                if (store.closeoutAuthorized?.value) {
                    store.officeMode.value = 'closeout';
                } else {
                    store.pinInput.value     = '';
                    store.pinMode.value      = 'closeout_office';
                    store.pinModalOpen.value = true;
                }
            }

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
                groupedOrders:           store.groupedOrders,
                assignedOrdersByOperator: store.assignedOrdersByOperator,
                dashSearch:         store.dashSearch,
                filteredOrders:     store.filteredOrders,
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
                newWoModalOpen:   store.newWoModalOpen,
                newWoForm:        store.newWoForm,
                newWoFormErrors:     store.newWoFormErrors,
                tcNewWoModeOverride: store.tcNewWoModeOverride,
                tcNewWoMode:         store.tcNewWoMode,
                tcEntryModeOverride: store.tcEntryModeOverride,
                tcEntryMode:         store.tcEntryMode,

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

                // TV Assy stock
                // TV Assy unit stage state
                tvEngStage:      store.tvEngStage,
                tvCrtStage:      store.tvCrtStage,
                tvFinStage:      store.tvFinStage,
                tvEngineCum:     store.tvEngineCum,
                tvCartCum:       store.tvCartCum,
                tvFinalCum:      store.tvFinalCum,

                tvAssyUnitOpen:   store.tvAssyUnitOpen,
                tvAssyStockOpen:  store.tvAssyStockOpen,
                tvStockPending:   store.tvStockPending,
                tvStockSessionQty: store.tvStockSessionQty,
                tvStockReason:    store.tvStockReason,
                tvStockQtyError:  store.tvStockQtyError,
                tvStockReasonError: store.tvStockReasonError,

                // TV Assy entry
                tvAssyEntryOpen: store.tvAssyEntryOpen,
                tvAssyEntryStep: store.tvAssyEntryStep,
                tvAssyEntryName: store.tvAssyEntryName,
                tvAssyOpEditing: store.tvAssyOpEditing,
                tvAssyNameError: store.tvAssyNameError,

                // TC Assy entry
                tcAssyEntryOpen:  store.tcAssyEntryOpen,
                tcAssyEntryName:  store.tcAssyEntryName,
                tcAssyNameError:  store.tcAssyNameError,
                tcAssyJobType:    store.tcAssyJobType,
                tcAssyUnitOpen:   store.tcAssyUnitOpen,
                tcAssyStockOpen:  store.tcAssyStockOpen,
                tcAssyOpEditing:  store.tcAssyOpEditing,
                tcStockPending:   store.tcStockPending,
                tcStockSessionQty: store.tcStockSessionQty,
                tcStockReason:    store.tcStockReason,
                tcStockQtyError:  store.tcStockQtyError,
                tcStockReasonError: store.tcStockReasonError,
                tcStockNotes:     store.tcStockNotes,

                // TC Assy unit stage state
                tcPreStage:   store.tcPreStage,
                tcFinStage:   store.tcFinStage,
                tcPreCum:     store.tcPreCum,
                tcFinCum:     store.tcFinCum,

                // TC Assy complete modal
                tcAssyCompleteModalOpen: store.tcAssyCompleteModalOpen,
                tcAssyCompleteForm:      store.tcAssyCompleteForm,
                tcAssyCompleteErrors:    store.tcAssyCompleteErrors,
                tcUnitInfoForm:          store.tcUnitInfoForm,
                tcPreStage:   store.tcPreStage,
                tcFinStage:   store.tcFinStage,
                tcPreCum:     store.tcPreCum,
                tcFinCum:     store.tcFinCum,

                // Office / WO Status
                officeMode:           store.officeMode,
                officeSearchTerm:     store.officeSearchTerm,
                officeSearchResults:  store.officeSearchResults,
                receiveEligibleList:  store.receiveEligibleList,
                closeoutAuthorized:   store.closeoutAuthorized,
                officeSuccessMsg:     store.officeSuccessMsg,
                officeCloseoutFilter: store.officeCloseoutFilter,
                filteredCloseoutOrders: store.filteredCloseoutOrders,
                woStatusOrders:       store.woStatusOrders,
                receiveModalOpen:     store.receiveModalOpen,
                receiveTarget:        store.receiveTarget,
                receiverName:         store.receiverName,
                receiverQty:          store.receiverQty,
                receiverBinLocation:  store.receiverBinLocation,
                receiverNameError:    store.receiverNameError,
                closeoutModalOpen:    store.closeoutModalOpen,
                closeoutTarget:       store.closeoutTarget,
                closeoutName:         store.closeoutName,
                closeoutNameError:    store.closeoutNameError,
                alerePendingOrders:   store.alerePendingOrders,
                alereConfirmId:       store.alereConfirmId,
                alereUpdaterName:     store.alereUpdaterName,
                alereUpdaterNameError: store.alereUpdaterNameError,

                // Manager AI chat
                aiChatOpen:     store.aiChatOpen,
                aiChatLoading:  store.aiChatLoading,
                aiChatInput:    store.aiChatInput,
                aiChatMessages: store.aiChatMessages,

                // Manager
                managerSubView: store.managerSubView,
                priorityDept:   store.priorityDept,
                priorityOrders: store.priorityOrders,
                delayedOrders:        store.delayedOrders,
                delayedOrdersByDept:  store.delayedOrdersByDept,
                kpiStats:       store.kpiStats,
                kpiByOperator:  store.kpiByOperator,
                kpiCycleTime:   store.kpiCycleTime,
                kpiHoldReasons: store.kpiHoldReasons,
                kpiOldestWos:   store.kpiOldestWos,
                managerAlerts:      store.managerAlerts,
                delayedWoCount:     store.delayedWoCount,
                managerAlertCount:  store.managerAlertCount,
                managerTotalBadge:  store.managerTotalBadge,

                // WO Problem draft (action panel)
                woProblemDraftText:      store.woProblemDraftText,
                woProblemDraftError:     store.woProblemDraftError,
                woProblemDraftName:      store.woProblemDraftName,
                woProblemDraftNameError: store.woProblemDraftNameError,
                submitWoProblemFromUi,

                // WO Problems
                woProblems:                 store.woProblems,
                woProblemCount:             store.woProblemCount,
                woProblemModalOpen:         store.woProblemModalOpen,
                woProblemTarget:            store.woProblemTarget,
                woProblemResolution:        store.woProblemResolution,
                woProblemResolutionError:   store.woProblemResolutionError,
                woProblemResolverName:      store.woProblemResolverName,
                woProblemResolverNameError: store.woProblemResolverNameError,

                // CS
                csSearchTerm:  store.csSearchTerm,
                csResultInfo:  store.csResultInfo,
                csTimeline:    store.csTimeline,
                csOpenOrders:  store.csOpenOrders,

                // WO file attachments
                woFiles:        store.woFiles,
                woFilesLoading: store.woFilesLoading,
                woActionTab:    store.woActionTab,
                partsWithFiles: store.partsWithFiles,

                // Toast
                toastMessage: store.toastMessage,
                toastType:    store.toastType,

                // ── Actions ────────────────────────────────────
                getStageCum,

                // Navigation
                selectDept, promptPin, submitPin, goBack,

                // Dashboard
                openActionPanel, openTvAssyEntry, tvAssyNameContinue, tvAssyContinue,
                submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
                openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
                saveTcStockNotes, saveTcUnitDetails,
                submitTcUnitStageFromUi, openTcAssyCompleteModal, confirmTcWoComplete,
                updateOrderStatus, undoLastAction,
                submitNewWo, submitNote, toggleTcNewWoMode, toggleTcEntryMode,
                loadWoFiles, handleWoFileUpload, handleWoFileDelete,

                // Office
                searchOfficeReceive, openReceiveModal, submitReceive,
                openCloseoutModal, submitCloseout, loadReceivingEligible,
                goToCloseout, markAlereUpdated,
                openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,

                // Manager
                openManagerSection, loadKpiData, loadDelayedOrders,
                fetchPriorityOrders, updatePriority, updateAssignedOperator,
                openNotesPanel, loadManagerAlerts,
                sendAiMessage,
                delayedWoDetailOpen: store.delayedWoDetailOpen,
                delayedWoDetail:     store.delayedWoDetail,
                openDelayedWoDetail, closeDelayedWoDetail,
                loadWoProblems, openWoProblemModal, closeWoProblemModal, confirmResolveWoProblem,

                // CS
                searchCS,

                // Utilities available in templates
                formatDateLocal, detectTcMode, sanitizePartKey
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
