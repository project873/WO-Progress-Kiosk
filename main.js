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
import { OPERATORS_BY_DEPT, HOLD_REASONS, SCRAP_REASONS, OPEN_ORDER_STATUSES, CHUTE_PART_STATUSES, OPEN_ORDER_SORT_FIELDS, INVENTORY_TABS, PARTIAL_NAMES, ENG_STATUSES, ENG_PRIORITIES, ENG_ASSIGNEES } from './libs/config.js';
import { formatDateLocal, getStageCum, detectTcMode, sanitizePartKey, isChutePart } from './libs/utils.js';
import { fetchAppPins } from './libs/db-shared.js';
import { setPins } from './libs/pins.js';

// ── Page controllers ──────────────────────────────────────────
import { selectDept, promptPin, submitPin, goBack,
         selectCategory, selectSubCategory, splashBack,
         enterInventoryView, enterWoRequestView, enterCreateWoView,
         enterOpenOrdersView, enterWoForecastingView,
         submitLogin, logout, enterManagerView } from './pages/splash-view.js';
import { loadWoRequests, submitWoRequestForm, deleteWoRequestItem,
         openWoRequestDetail, closeWoRequestDetail,
         saveWoRequestDetail, approveWoRequest,
         saveWoRequestInlineFields,
         checkWoRequestPartMatch, acceptSoHint, dismissSoHint,
         openSendToForecast, closeSendToForecast, submitSendToForecast,
         handleWoFileUploadForRequest } from './pages/wo-request-view.js';
import { loadForecastedItems,
         openDeleteConfirm, cancelDeleteForecast, confirmDeleteForecast,
         openMoveBackConfirm, cancelMoveBack, confirmMoveBack } from './pages/wo-forecasting-view.js';
import { loadCreateWoItems, confirmCreateWoItem, switchCreateWoTab, loadCreatedWoItems } from './pages/create-wo-view.js';
import { enterCompletedOrdersView, loadCompletedOrders, restoreCompletedOrder } from './pages/completed-orders-view.js';
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
    getFinalOperatorName, holdSince,
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
    tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold,
    saveTvUnitDetails, markTvUnitWoComplete
} from './pages/dashboard-tv.js';
import {
    openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
    saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
    submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
    openTcAssyCompleteModal, confirmTcWoComplete, tcUnitNextStep, toggleTcEntryMode
} from './pages/dashboard-tc.js';
import { markAlereUpdated, checkConnectivity, supabase } from './libs/db.js';
import {
    searchOfficeReceive, openReceiveModal, submitReceive,
    openCloseoutModal, submitCloseout, loadReceivingEligible,
    openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,
    goToCloseout,
    saveCloseoutNoteInline, loadClosedOutOrders, openClosedOutHistory
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
import { openAlertResolve, submitAlertResolve } from './pages/manager-alerts.js';
import { searchCS, searchPastOrders, selectPastWo, clearPastOrders } from './pages/cs-view.js';
import {
    loadOpenOrders, setSectionSort, openOrderSortIcon,
    setRowColor, effectiveRowColor, openOrderRowClass, openOrderColorDotClass,
    loadReminderEmail, saveReminderEmail,
    openOrderStatusClass, chuteStatusClass, openOrderHasLine3,
    cancelAddModal, parsePasteRows, saveOpenOrderRow,
    moveToSection, bulkChangeStatus,
    startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder,
    toggleOpenOrderExpand,
    openWoDetailPanel, closeWoDetailPanel,
    woDeptBadgeClass, woStatusBadgeClass,
} from './pages/open-orders-view.js';
import { onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
    onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
    onScrollAreaDragOver, onGripDragStart, onGripDragEnd,
    onDropZoneDragOver, clearDropZone, reorderDrop } from './pages/open-orders-drag.js';
import { enterEngineeringInquiriesView, enterEngineeringFollowupView,
         openEngInquiryForm, closeEngInquiryForm, submitEngInquiry,
         handleEngNewInquiryFileSelect, removeEngNewInquiryFile,
         openEngInquiryDetail, closeEngInquiryDetail,
         saveEngInquiry, saveEngInquiryInline, handleEngImageUpload,
         openEngImagesModal, closeEngImagesModal } from './pages/engineering-view.js';

// ── Load HTML partials into #app before Vue mounts ───────────
// Fetches HTML fragment files from ./partials/ and concatenates them into #app.
// Vue reads the DOM at mount time, so partials must be injected first.
async function loadPartials() {
    const chunks = await Promise.all(
        PARTIAL_NAMES.map(n => fetch(`./partials/${n}.html`).then(r => r.text()))
    );
    document.getElementById('app').innerHTML = chunks.join('\n');
}
const [, pinsMap] = await Promise.all([loadPartials(), fetchAppPins()]);
setPins(pinsMap);

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

            // Remove loading fallback once Vue successfully mounts.
            // Restore an existing Supabase Auth session so a page refresh doesn't log out.
            onMounted(async () => {
                if (loadingEl) loadingEl.remove();
                probeConnectivity();
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    const role = session.user.app_metadata?.role || null;
                    if (role) {
                        store.sessionRole.value = role;
                        store.currentView.value = 'splash';
                        loadManagerAlerts();
                    }
                }
            });

            // Load data on view entry; reset Close-Out auth when leaving wo_status
            watch(store.currentView, (v) => {
                if (v !== 'wo_status') store.closeoutAuthorized.value = false;
                if (v === 'wo_status')  loadReceivingEligible();
                if (v === 'manager')    loadManagerAlerts();
                if (v === 'inventory')  loadInventoryItems();
                if (v === 'wo_request')     loadWoRequests();
                if (v === 'wo_forecasting') loadForecastedItems();
                if (v === 'create_wo')   loadCreateWoItems();
                if (v === 'open_orders')      { loadOpenOrders(); loadReminderEmail(); }
                if (v === 'completed_orders') loadCompletedOrders();
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

                // Engineering
                engView:                store.engView,
                engInquiries:           store.engInquiries,
                engInquiriesLoading:    store.engInquiriesLoading,
                engStatusFilter:        store.engStatusFilter,
                engPriorityFilter:      store.engPriorityFilter,
                engAssigneeFilter:      store.engAssigneeFilter,
                engManualSort:          store.engManualSort,
                engInquiryFormOpen:     store.engInquiryFormOpen,
                engInquiryForm:         store.engInquiryForm,
                engInquiryFormErrors:   store.engInquiryFormErrors,
                engNewInquiryFiles:     store.engNewInquiryFiles,
                engSelectedInquiry:     store.engSelectedInquiry,
                engInquiryDetailOpen:   store.engInquiryDetailOpen,
                engImagesModalOpen:     store.engImagesModalOpen,
                engInquiryImages:       store.engInquiryImages,
                engImagesLoading:       store.engImagesLoading,
                filteredEngInquiries:   store.filteredEngInquiries,
                engStatuses:            ENG_STATUSES,
                engPriorities:          ENG_PRIORITIES,
                engAssignees:           ENG_ASSIGNEES,

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

                // Session login
                sessionRole:       store.sessionRole,
                loginUsername:     store.loginUsername,
                loginPassword:     store.loginPassword,
                loginError:        store.loginError,
                loginLoading:      store.loginLoading,
                showLoginPassword: store.showLoginPassword,

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

                // TV Assy unit inline detail fields
                tvUnitInfoForm:   store.tvUnitInfoForm,
                tvUnitInfoErrors: store.tvUnitInfoErrors,

                // TC Assy complete modal
                tcAssyCompleteModalOpen: store.tcAssyCompleteModalOpen,
                tcAssyCompleteForm:      store.tcAssyCompleteForm,
                tcAssyCompleteErrors:    store.tcAssyCompleteErrors,
                tcUnitInfoForm:          store.tcUnitInfoForm,
                tcUnitStep:              store.tcUnitStep,
                tcUnitForms:             store.tcUnitForms,
                tcUnitTotal:             store.tcUnitTotal,
                tcUnitStepError:         store.tcUnitStepError,

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
                submitLogin, logout, enterManagerView,
                enterEngineeringInquiriesView, enterEngineeringFollowupView,
                openEngInquiryForm, closeEngInquiryForm, submitEngInquiry,
                handleEngNewInquiryFileSelect, removeEngNewInquiryFile,
                openEngInquiryDetail, closeEngInquiryDetail,
                saveEngInquiry, saveEngInquiryInline, handleEngImageUpload,
                openEngImagesModal, closeEngImagesModal,

                // Dashboard
                openActionPanel, openTvAssyEntry, tvSelectMode,
                submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
                tvStockDirectAction, saveTvStockNotes,
                tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold,
                saveTvUnitDetails, markTvUnitWoComplete,
                openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
                saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
                submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
                openTcAssyCompleteModal, confirmTcWoComplete, tcUnitNextStep,
                updateOrderStatus, undoLastAction,
                submitNewWo, submitNote, toggleTcNewWoMode, toggleTcEntryMode,
                loadWoFiles, handleWoFileUpload, handleWoFileDelete,
                startReelOperation, pauseReelOperation, completeReelOperation, reviseReelOperation, completeReelWo,

                // Office
                searchOfficeReceive, openReceiveModal, submitReceive,
                openCloseoutModal, submitCloseout, loadReceivingEligible,
                goToCloseout, markAlereUpdated,
                openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,
                saveCloseoutNoteInline, loadClosedOutOrders, openClosedOutHistory,
                closedOutOrders:          store.closedOutOrders,
                closedOutFrom:            store.closedOutFrom,
                closedOutTo:              store.closedOutTo,
                closedOutFilter:          store.closedOutFilter,
                filteredClosedOutOrders:  store.filteredClosedOutOrders,

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
                alertResolveOpen:      store.alertResolveOpen,
                alertResolveTarget:    store.alertResolveTarget,
                alertResolveType:      store.alertResolveType,
                alertResolveBy:        store.alertResolveBy,
                alertResolveByError:   store.alertResolveByError,
                alertResolveText:      store.alertResolveText,
                alertResolveTextError: store.alertResolveTextError,
                openAlertResolve, submitAlertResolve,

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
                woRequestSoHint:        store.woRequestSoHint,
                enterWoRequestView,
                submitWoRequestForm,
                deleteWoRequestItem,
                openWoRequestDetail,
                closeWoRequestDetail,
                saveWoRequestDetail,
                approveWoRequest,
                saveWoRequestInlineFields,
                checkWoRequestPartMatch, acceptSoHint, dismissSoHint,
                openSendToForecast, closeSendToForecast, submitSendToForecast,
                handleWoFileUploadForRequest,
                sendToForecastOpen:   store.sendToForecastOpen,
                sendToForecastTarget: store.sendToForecastTarget,
                sendToForecastForm:   store.sendToForecastForm,
                sendToForecastErrors: store.sendToForecastErrors,

                // WO Forecasting
                forecastingItems: store.forecastingItems, forecastingLoading: store.forecastingLoading,
                forecastDeleteId: store.forecastDeleteId, forecastMoveBackId: store.forecastMoveBackId,
                enterWoForecastingView, loadForecastedItems,
                openDeleteConfirm, cancelDeleteForecast, confirmDeleteForecast,
                openMoveBackConfirm, cancelMoveBack, confirmMoveBack,

                // Create WO
                createWoItems: store.createWoItems, createWoLoading: store.createWoLoading,
                createWoInlineState: store.createWoInlineState, createWoTab: store.createWoTab, createdWoItems: store.createdWoItems,
                enterCreateWoView, loadCreateWoItems, confirmCreateWoItem, switchCreateWoTab, loadCreatedWoItems,

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

                // Completed Orders
                completedOrders:        store.completedOrders,
                completedOrdersLoading: store.completedOrdersLoading,
                enterCompletedOrdersView, loadCompletedOrders, restoreCompletedOrder,

                // Open Orders
                openOrders:              store.openOrders,
                openOrdersLoading:       store.openOrdersLoading,
                openOrdersSort:          store.openOrdersSort,
                openOrderSections:       store.openOrderSections,
                openOrderColorPickerRow: store.openOrderColorPickerRow,
                openOrderEditingCell:     store.openOrderEditingCell,
                openOrderEditingValue:    store.openOrderEditingValue,
                openOrderSelectedIds:     store.openOrderSelectedIds,
                openOrderBulkStatus:      store.openOrderBulkStatus,
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
                chutePartStatuses:        CHUTE_PART_STATUSES,
                openOrderSortFields: OPEN_ORDER_SORT_FIELDS,
                enterOpenOrdersView,
                loadOpenOrders,
                setSectionSort,
                openOrderSortIcon,
                setRowColor,
                effectiveRowColor,
                openOrderRowClass,
                reminderEmailModalOpen: store.reminderEmailModalOpen,
                reminderEmail:          store.reminderEmail,
                reminderEmailSaving:    store.reminderEmailSaving,
                saveReminderEmail,
                openOrderColorDotClass,
                openOrderStatusClass,
                chuteStatusClass,
                openOrderHasLine3,
                cancelAddModal,
                parsePasteRows,
                saveOpenOrderRow,
                moveToSection, bulkChangeStatus,
                onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
                onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
                onScrollAreaDragOver, onGripDragStart, onGripDragEnd,
                onDropZoneDragOver, clearDropZone, reorderDrop,
                startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder,
                toggleOpenOrderExpand,
                openOrderWoPanel:         store.openOrderWoPanel,
                openOrderWoPanelOrders:   store.openOrderWoPanelOrders,
                openOrderWoPanelLoading:  store.openOrderWoPanelLoading,
                openWoDetailPanel, closeWoDetailPanel,
                woDeptBadgeClass, woStatusBadgeClass,

                // Utilities available in templates
                formatDateLocal, detectTcMode, sanitizePartKey, isChutePart
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
