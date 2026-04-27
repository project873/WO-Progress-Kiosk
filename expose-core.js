// ============================================================
// expose-core.js — Vue template bindings: shop floor modules
// Navigation, engineering, dashboard, TC/TV assy, office, CS
// ============================================================

import * as store from './libs/store.js';
import { OPERATORS_BY_DEPT, HOLD_REASONS, SCRAP_REASONS,
         ENG_STATUSES, ENG_PRIORITIES, ENG_ASSIGNEES } from './libs/config.js';
import { formatDateLocal, getStageCum, detectTcMode,
         sanitizePartKey, isChutePart } from './libs/utils.js';
import { selectDept, promptPin, submitPin, goBack,
         selectCategory, selectSubCategory, splashBack,
         submitLogin, logout, enterManagerView,
         loadHeaderLinks } from './pages/splash-view.js';
import { openActionPanel, holdSince,
         updateOrderStatus, undoLastAction,
         submitNewWo, submitNote, toggleTcNewWoMode,
         submitWoProblemFromUi,
         loadWoFiles, handleWoFileUpload, handleWoFileDelete,
         startReelOperation, pauseReelOperation, completeReelOperation,
         reviseReelOperation, completeReelWo,
         toggleCompletedDeptView } from './pages/dashboard-view.js';
import { openTvAssyEntry, tvSelectMode,
         submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
         tvStockDirectAction, saveTvStockNotes,
         tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold,
         saveTvUnitDetails, markTvUnitWoComplete } from './pages/dashboard-tv.js';
import { openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
         saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
         submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
         openTcAssyCompleteModal, confirmTcWoComplete, tcUnitNextStep,
         toggleTcEntryMode } from './pages/dashboard-tc.js';
import { markAlereUpdated } from './libs/db.js';
import { searchOfficeReceive, openReceiveModal, submitReceive,
         openCloseoutModal, submitCloseout, loadReceivingEligible,
         openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,
         goToCloseout,
         saveCloseoutNoteInline, loadClosedOutOrders, openClosedOutHistory } from './pages/wo-status-view.js';
import { searchCS, searchPastOrders, selectPastWo, clearPastOrders } from './pages/cs-view.js';
import { enterEngineeringInquiriesView, enterEngineeringFollowupView,
         openEngInquiryForm, closeEngInquiryForm, submitEngInquiry,
         handleEngNewInquiryFileSelect, removeEngNewInquiryFile,
         openEngInquiryDetail, closeEngInquiryDetail,
         saveEngInquiry, saveEngInquiryInline, handleEngImageUpload,
         openEngImagesModal, closeEngImagesModal,
         appendEngNote } from './pages/engineering-view.js';

export function buildCoreExpose() {
    return {
        // Navigation state
        currentView:       store.currentView,
        selectedDept:      store.selectedDept,
        loading:           store.loading,
        currentTime:       store.currentTime,
        appTitle:          store.appTitle,
        splashLevel:       store.splashLevel,
        splashCategory:    store.splashCategory,
        splashSubCategory: store.splashSubCategory,

        // Engineering
        engView:               store.engView,
        engInquiries:          store.engInquiries,
        engInquiriesLoading:   store.engInquiriesLoading,
        engStatusFilter:       store.engStatusFilter,
        engPriorityFilter:     store.engPriorityFilter,
        engAssigneeFilter:     store.engAssigneeFilter,
        engManualSort:         store.engManualSort,
        engInquiryFormOpen:    store.engInquiryFormOpen,
        engInquiryForm:        store.engInquiryForm,
        engInquiryFormErrors:  store.engInquiryFormErrors,
        engNewInquiryFiles:    store.engNewInquiryFiles,
        engSelectedInquiry:    store.engSelectedInquiry,
        engInquiryDetailOpen:  store.engInquiryDetailOpen,
        engImagesModalOpen:    store.engImagesModalOpen,
        engInquiryImages:      store.engInquiryImages,
        engImagesLoading:      store.engImagesLoading,
        filteredEngInquiries:  store.filteredEngInquiries,
        engStatuses:           ENG_STATUSES,
        engPriorities:         ENG_PRIORITIES,
        engAssignees:          ENG_ASSIGNEES,

        // Dashboard
        orders:                   store.orders,
        allOrders:                store.allOrders,
        dashboardCategories:      store.dashboardCategories,
        groupedOrders:            store.groupedOrders,
        assignedOrdersByOperator: store.assignedOrdersByOperator,
        dashSearch:               store.dashSearch,
        filteredOrders:           store.filteredOrders,
        isReel:                   store.isReel,
        OPERATORS_BY_DEPT,
        HOLD_REASONS,
        SCRAP_REASONS,

        // Action panel
        actionPanelOpen:      store.actionPanelOpen,
        activeOrder:          store.activeOrder,
        selectedOperator:     store.selectedOperator,
        selectedOperators:    store.selectedOperators,
        fabWeldOperatorReady: store.fabWeldOperatorReady,
        holdSince,
        otherOperator:        store.otherOperator,
        actionForm:           store.actionForm,

        // Reel Weld per-operation state
        reelWeldOperator:  store.reelWeldOperator,
        reelGrindOperator: store.reelGrindOperator,
        reelWeldOtherOp:   store.reelWeldOtherOp,
        reelGrindOtherOp:  store.reelGrindOtherOp,
        reelWeldQty:       store.reelWeldQty,
        reelGrindQty:      store.reelGrindQty,

        // New WO modal
        newWoModalOpen:      store.newWoModalOpen,
        newWoForm:           store.newWoForm,
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
        tvEngineCum:           store.tvEngineCum,
        tvCartCum:             store.tvCartCum,
        tvFinalCum:            store.tvFinalCum,
        tvAssyUnitOpen:        store.tvAssyUnitOpen,
        tvAssyStockOpen:       store.tvAssyStockOpen,
        tvStockPending:        store.tvStockPending,
        tvStockSessionQty:     store.tvStockSessionQty,
        tvStockReason:         store.tvStockReason,
        tvStockQtyError:       store.tvStockQtyError,
        tvStockReasonError:    store.tvStockReasonError,
        tvStockNotes:          store.tvStockNotes,
        tvModeSelectOpen:      store.tvModeSelectOpen,
        tvAssyEntryName:       store.tvAssyEntryName,
        tvAssyOpEditing:       store.tvAssyOpEditing,
        tvAssyNameError:       store.tvAssyNameError,

        // TV Assy unit inline detail fields
        tvUnitInfoForm:   store.tvUnitInfoForm,
        tvUnitInfoErrors: store.tvUnitInfoErrors,

        // TC Assy entry
        tcAssyEntryOpen:    store.tcAssyEntryOpen,
        tcAssyEntryName:    store.tcAssyEntryName,
        tcAssyNameError:    store.tcAssyNameError,
        tcAssyJobType:      store.tcAssyJobType,
        tcAssyUnitOpen:     store.tcAssyUnitOpen,
        tcAssyStockOpen:    store.tcAssyStockOpen,
        tcAssyOpEditing:    store.tcAssyOpEditing,
        tcStockPending:     store.tcStockPending,
        tcStockSessionQty:  store.tcStockSessionQty,
        tcStockReason:      store.tcStockReason,
        tcStockQtyError:    store.tcStockQtyError,
        tcStockReasonError: store.tcStockReasonError,
        tcStockNotes:       store.tcStockNotes,

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
        tcUnitStep:              store.tcUnitStep,
        tcUnitForms:             store.tcUnitForms,
        tcUnitTotal:             store.tcUnitTotal,
        tcUnitStepError:         store.tcUnitStepError,

        // Office / WO Status
        officeMode:             store.officeMode,
        officeSearchTerm:       store.officeSearchTerm,
        officeSearchResults:    store.officeSearchResults,
        receiveEligibleList:    store.receiveEligibleList,
        closeoutAuthorized:     store.closeoutAuthorized,
        officeSuccessMsg:       store.officeSuccessMsg,
        officeCloseoutFilter:   store.officeCloseoutFilter,
        filteredCloseoutOrders: store.filteredCloseoutOrders,
        woStatusOrders:         store.woStatusOrders,
        receiveModalOpen:       store.receiveModalOpen,
        receiveTarget:          store.receiveTarget,
        receiverName:           store.receiverName,
        receiverQty:            store.receiverQty,
        receiverBinLocation:    store.receiverBinLocation,
        receiverNameError:      store.receiverNameError,
        closeoutModalOpen:      store.closeoutModalOpen,
        closeoutTarget:         store.closeoutTarget,
        closeoutName:           store.closeoutName,
        closeoutNameError:      store.closeoutNameError,
        alerePendingOrders:     store.alerePendingOrders,
        alereConfirmId:         store.alereConfirmId,
        alereUpdaterName:       store.alereUpdaterName,
        alereUpdaterNameError:  store.alereUpdaterNameError,

        // WO Problem draft (action panel)
        woProblemDraftText:      store.woProblemDraftText,
        woProblemDraftError:     store.woProblemDraftError,
        woProblemDraftName:      store.woProblemDraftName,
        woProblemDraftNameError: store.woProblemDraftNameError,
        submitWoProblemFromUi,

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

        // ── Actions ──────────────────────────────────────────
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
        engNewEntries: store.engNewEntries,
        appendEngNote,

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
        closedOutOrders:         store.closedOutOrders,
        closedOutFrom:           store.closedOutFrom,
        closedOutTo:             store.closedOutTo,
        closedOutFilter:         store.closedOutFilter,
        filteredClosedOutOrders: store.filteredClosedOutOrders,

        // CS
        searchCS, searchPastOrders, selectPastWo, clearPastOrders,

        // Dept completed WOs
        completedDeptOrders:  store.completedDeptOrders,
        closedOutDeptOrders:  store.closedOutDeptOrders,
        showingCompletedDept: store.showingCompletedDept,
        toggleCompletedDeptView,

        // Utilities
        formatDateLocal, detectTcMode, sanitizePartKey, isChutePart,
    };
}
