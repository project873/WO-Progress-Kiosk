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
import { OPERATORS_BY_DEPT, HOLD_REASONS, SCRAP_REASONS, OPEN_ORDER_STATUSES, OPEN_ORDER_SORT_FIELDS, INVENTORY_TABS } from './libs/config.js';
import { formatDateLocal, getStageCum, detectTcMode, sanitizePartKey } from './libs/utils.js';

// ── Page controllers ──────────────────────────────────────────
import { selectDept, promptPin, submitPin, goBack,
         selectCategory, selectSubCategory, splashBack,
         enterInventoryView, enterWoRequestView, enterCreateWoView,
         enterOpenOrdersView } from './pages/splash-view.js';
import { loadWoRequests, submitWoRequestForm, deleteWoRequestItem,
         openWoRequestDetail, closeWoRequestDetail,
         saveWoRequestDetail, approveWoRequest,
         saveWoRequestInlineFields } from './pages/wo-request-view.js';
import { loadCreateWoItems, confirmCreateWoItem } from './pages/create-wo-view.js';
import {
    loadInventoryItems, switchInventoryTab,
    openPullForm, closePullForm, submitPull,
    openAddItemForm, closeAddItemForm, submitAddItem,
    openEditItemForm, closeEditItemForm, submitEditItem,
    confirmDeleteInventoryItem,
    openPullHistory, closePullHistory
} from './pages/inventory-view.js';
import {
    openActionPanel,
    getFinalOperatorName, getFabWeldOperatorName, holdSince,
    updateOrderStatus, undoLastAction,
    submitNewWo, submitNote, toggleTcNewWoMode,
    submitWoProblemFromUi,
    loadWoFiles, handleWoFileUpload, handleWoFileDelete,
    startReelOperation, pauseReelOperation, completeReelOperation, reviseReelOperation, completeReelWo
} from './pages/dashboard-view.js';
import {
    openTvAssyEntry, tvSelectMode,
    submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
    tvStockDirectAction, saveTvStockNotes,
    tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold
} from './pages/dashboard-tv.js';
import {
    openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
    saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
    submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
    openTcAssyCompleteModal, confirmTcWoComplete, toggleTcEntryMode
} from './pages/dashboard-tc.js';
import { markAlereUpdated, signInAnonymously, checkConnectivity } from './libs/db.js';
import {
    searchOfficeReceive, openReceiveModal, submitReceive,
    openCloseoutModal, submitCloseout, loadReceivingEligible,
    openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,
    goToCloseout
} from './pages/wo-status-view.js';
import {
    openManagerSection, loadKpiData, loadDelayedOrders,
    fetchPriorityOrders, updatePriority, updateAssignedOperator,
    handleAssignChange, submitCustomAssign, cancelCustomAssign,
    openNotesPanel, loadManagerAlerts,
    sendAiMessage, loadTimeReport,
    loadWoProblems, openWoProblemModal, closeWoProblemModal, confirmResolveWoProblem,
    openDelayedWoDetail, closeDelayedWoDetail
} from './pages/manager-view.js';
import { searchCS, searchPastOrders, selectPastWo, clearPastOrders } from './pages/cs-view.js';
import {
    loadOpenOrders, setSectionSort, openOrderSortIcon,
    setRowColor, openOrderRowClass, openOrderColorDotClass,
    openOrderStatusClass, openOrderHasLine3,
    cancelAddModal, parsePasteRows, saveOpenOrderRow,
    moveToSection,
    onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
    onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
    onScrollAreaDragOver,
    startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder,
    onGripDragStart, onGripDragEnd,
    onDropZoneDragOver, clearDropZone, reorderDrop,
    toggleOpenOrderExpand
} from './pages/open-orders-view.js';

// ── Load HTML partials into #app before Vue mounts ───────────
// Fetches HTML fragment files from ./partials/ and concatenates them into #app.
// Vue reads the DOM at mount time, so partials must be injected first.
async function loadPartials() {
    const names = [
        'header', 'main-open',
        'view-splash', 'view-dashboard', 'view-office',
        'view-manager-home', 'view-manager-kpi', 'view-manager-priorities',
        'view-manager-ai', 'view-manager-problems', 'view-manager-delayed',
        'view-cs', 'view-inventory', 'view-wo-request', 'view-create-wo', 'view-open-orders',
        'main-close',
        'modal-pin', 'modal-action-panel',
        'modal-tc-unit', 'modal-tc-stock',
        'modal-tv-unit', 'modal-tv-stock',
        'modal-misc', 'modal-open-orders-add',
        'modal-action-panel-print'
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

            // Offline detection: browser events + periodic Supabase probe
            async function probeConnectivity() {
                store.isOffline.value = !(await checkConnectivity());
            }
            const onOfflineEvent = () => { store.isOffline.value = true; };
            window.addEventListener('offline', onOfflineEvent);
            window.addEventListener('online',  probeConnectivity);
            const connectivityInterval = setInterval(probeConnectivity, 30_000);
            onUnmounted(() => {
                clearInterval(connectivityInterval);
                window.removeEventListener('offline', onOfflineEvent);
                window.removeEventListener('online',  probeConnectivity);
            });

            // Remove loading fallback once Vue successfully mounts
            // Also pre-load manager alerts so the splash badge is populated immediately
            onMounted(() => {
                if (loadingEl) loadingEl.remove();
                loadManagerAlerts();
                probeConnectivity();
            });

            // Load data on view entry; reset Close-Out auth when leaving wo_status
            watch(store.currentView, (v) => {
                if (v !== 'wo_status') store.closeoutAuthorized.value = false;
                if (v === 'wo_status')  loadReceivingEligible();
                if (v === 'manager')    loadManagerAlerts();
                if (v === 'inventory')  loadInventoryItems();
                if (v === 'wo_request')  loadWoRequests();
                if (v === 'create_wo')   loadCreateWoItems();
                if (v === 'open_orders') loadOpenOrders();
            });
            // Reload alerts when navigating back to Manager Hub home from any sub-section
            watch(store.managerSubView, (v) => {
                if (v === 'home' && store.currentView.value === 'manager') loadManagerAlerts();
            });

            return {
                // Navigation state
                currentView:      store.currentView,
                selectedDept:     store.selectedDept,
                loading:          store.loading,
                currentTime:      store.currentTime,
                appTitle:         store.appTitle,
                splashLevel:      store.splashLevel,
                splashCategory:   store.splashCategory,
                splashSubCategory: store.splashSubCategory,

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

                // Reel Weld per-operation state
                reelWeldOperator:  store.reelWeldOperator,
                reelGrindOperator: store.reelGrindOperator,
                reelWeldOtherOp:   store.reelWeldOtherOp,
                reelGrindOtherOp:  store.reelGrindOtherOp,
                reelWeldQty:       store.reelWeldQty,
                reelGrindQty:      store.reelGrindQty,

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
                tvUnitHoldOpen:        store.tvUnitHoldOpen,
                tvUnitHoldReason:      store.tvUnitHoldReason,
                tvUnitHoldReasonError: store.tvUnitHoldReasonError,
                tcUnitHoldOpen:        store.tcUnitHoldOpen,
                tcUnitHoldReason:      store.tcUnitHoldReason,
                tcUnitHoldReasonError: store.tcUnitHoldReasonError,
                tvEngStage:            store.tvEngStage,
                tvCrtStage:            store.tvCrtStage,
                tvFinStage:            store.tvFinStage,
                tvEngineCum:     store.tvEngineCum,
                tvCartCum:       store.tvCartCum,
                tvFinalCum:      store.tvFinalCum,

                tvAssyUnitOpen:   store.tvAssyUnitOpen,
                tvAssyStockOpen:  store.tvAssyStockOpen,
                tvStockPending:     store.tvStockPending,
                tvStockSessionQty:  store.tvStockSessionQty,
                tvStockReason:      store.tvStockReason,
                tvStockQtyError:    store.tvStockQtyError,
                tvStockReasonError: store.tvStockReasonError,
                tvStockNotes:       store.tvStockNotes,

                // TV Assy entry
                tvModeSelectOpen: store.tvModeSelectOpen,
                tvAssyEntryName:  store.tvAssyEntryName,
                tvAssyOpEditing:  store.tvAssyOpEditing,
                tvAssyNameError:  store.tvAssyNameError,

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
                assignCustomInput: store.assignCustomInput,
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
                csSearchTerm:   store.csSearchTerm,
                csResultInfo:   store.csResultInfo,
                csTimeline:     store.csTimeline,
                csOpenOrders:   store.csOpenOrders,
                csPastSearch:   store.csPastSearch,
                csPastResults:  store.csPastResults,
                csPastSort:     store.csPastSort,
                csPastSortDir:  store.csPastSortDir,
                csPastSelected: store.csPastSelected,

                // WO file attachments
                woFiles:        store.woFiles,
                woFilesLoading: store.woFilesLoading,
                woActionTab:    store.woActionTab,
                partsWithFiles: store.partsWithFiles,

                // Toast
                toastMessage: store.toastMessage,
                toastType:    store.toastType,
                isOffline:    store.isOffline,

                // ── Actions ────────────────────────────────────
                getStageCum,

                // Navigation
                selectDept, promptPin, submitPin, goBack,
                selectCategory, selectSubCategory, splashBack,

                // Dashboard
                openActionPanel, openTvAssyEntry, tvSelectMode,
                submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
                tvStockDirectAction, saveTvStockNotes,
                tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold,
                openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
                saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
                submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
                openTcAssyCompleteModal, confirmTcWoComplete,
                updateOrderStatus, undoLastAction,
                submitNewWo, submitNote, toggleTcNewWoMode, toggleTcEntryMode,
                loadWoFiles, handleWoFileUpload, handleWoFileDelete,
                startReelOperation, pauseReelOperation, completeReelOperation, reviseReelOperation, completeReelWo,

                // Office
                searchOfficeReceive, openReceiveModal, submitReceive,
                openCloseoutModal, submitCloseout, loadReceivingEligible,
                goToCloseout, markAlereUpdated,
                openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,

                // Manager
                openManagerSection, loadKpiData, loadDelayedOrders,
                fetchPriorityOrders, updatePriority, updateAssignedOperator,
                handleAssignChange, submitCustomAssign, cancelCustomAssign,
                openNotesPanel, loadManagerAlerts,
                sendAiMessage, loadTimeReport,
                delayedWoDetailOpen: store.delayedWoDetailOpen,
                delayedWoDetail:     store.delayedWoDetail,
                openDelayedWoDetail, closeDelayedWoDetail,
                loadWoProblems, openWoProblemModal, closeWoProblemModal, confirmResolveWoProblem,

                // Time Report
                timeReportSessions:     store.timeReportSessions,
                timeReportFrom:         store.timeReportFrom,
                timeReportTo:           store.timeReportTo,
                timeReportTab:          store.timeReportTab,
                timeReportExpandedWo:   store.timeReportExpandedWo,
                timeReportExpandedPart: store.timeReportExpandedPart,
                timeReportByWo:         store.timeReportByWo,
                timeReportByPart:       store.timeReportByPart,

                // CS
                searchCS, searchPastOrders, selectPastWo, clearPastOrders,

                // WO Requests
                woRequests:             store.woRequests,
                woRequestsLoading:      store.woRequestsLoading,
                woRequestForm:          store.woRequestForm,
                woRequestFormErrors:    store.woRequestFormErrors,
                woRequestSearch:        store.woRequestSearch,
                filteredWoRequests:     store.filteredWoRequests,
                selectedWoRequest:      store.selectedWoRequest,
                woRequestDetailForm:    store.woRequestDetailForm,
                woRequestInlineState:   store.woRequestInlineState,
                enterWoRequestView,
                submitWoRequestForm,
                deleteWoRequestItem,
                openWoRequestDetail,
                closeWoRequestDetail,
                saveWoRequestDetail,
                approveWoRequest,
                saveWoRequestInlineFields,

                // Create WO
                createWoItems:          store.createWoItems,
                createWoLoading:        store.createWoLoading,
                createWoInlineState:    store.createWoInlineState,
                enterCreateWoView,
                loadCreateWoItems,
                confirmCreateWoItem,

                // Inventory
                inventoryTab:              store.inventoryTab,
                inventoryItems:            store.inventoryItems,
                inventoryLoading:          store.inventoryLoading,
                inventorySearch:           store.inventorySearch,
                filteredInventoryItems:    store.filteredInventoryItems,
                pullFormOpen:              store.pullFormOpen,
                pullFormTarget:            store.pullFormTarget,
                pullForm:                  store.pullForm,
                pullFormErrors:            store.pullFormErrors,
                addItemFormOpen:           store.addItemFormOpen,
                addItemForm:               store.addItemForm,
                addItemFormErrors:         store.addItemFormErrors,
                editItemFormOpen:          store.editItemFormOpen,
                editItemFormTarget:        store.editItemFormTarget,
                editItemForm:              store.editItemForm,
                editItemFormErrors:        store.editItemFormErrors,
                pullHistoryOpen:           store.pullHistoryOpen,
                pullHistoryTarget:         store.pullHistoryTarget,
                pullHistoryItems:          store.pullHistoryItems,
                pullHistoryLoading:        store.pullHistoryLoading,
                inventoryTabs: INVENTORY_TABS,
                enterInventoryView, switchInventoryTab,
                openPullForm, closePullForm, submitPull,
                openAddItemForm, closeAddItemForm, submitAddItem,
                openEditItemForm, closeEditItemForm, submitEditItem,
                confirmDeleteInventoryItem,
                openPullHistory, closePullHistory,

                // Open Orders
                openOrders:              store.openOrders,
                openOrdersLoading:       store.openOrdersLoading,
                openOrdersSort:          store.openOrdersSort,
                openOrderSections:       store.openOrderSections,
                openOrderColorPickerRow: store.openOrderColorPickerRow,
                openOrderEditingCell:     store.openOrderEditingCell,
                openOrderEditingValue:    store.openOrderEditingValue,
                openOrderSelectedIds:     store.openOrderSelectedIds,
                openOrderDragOverSection: store.openOrderDragOverSection,
                openOrderDropZoneTarget:  store.openOrderDropZoneTarget,
                openOrderExpandedCols:    store.openOrderExpandedCols,
                openOrderAddModalOpen:    store.openOrderAddModalOpen,
                openOrderAddMode:         store.openOrderAddMode,
                openOrderAddForm:         store.openOrderAddForm,
                openOrderAddFormErrors:   store.openOrderAddFormErrors,
                openOrderAddPasteText:    store.openOrderAddPasteText,
                openOrderAddPasteRows:    store.openOrderAddPasteRows,
                openOrderStatuses:        OPEN_ORDER_STATUSES,
                openOrderSortFields: OPEN_ORDER_SORT_FIELDS,
                enterOpenOrdersView,
                loadOpenOrders,
                setSectionSort,
                openOrderSortIcon,
                setRowColor,
                openOrderRowClass,
                openOrderColorDotClass,
                openOrderStatusClass,
                openOrderHasLine3,
                cancelAddModal,
                parsePasteRows,
                saveOpenOrderRow,
                moveToSection,
                onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
                onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
                onScrollAreaDragOver,
                startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder,
                onGripDragStart, onGripDragEnd,
                onDropZoneDragOver, clearDropZone, reorderDrop,
                toggleOpenOrderExpand,

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
