// ============================================================
// libs/store.js — Reactive application state (single source of truth)
//
// RULES:
//  - Only ref() and computed() here — NO fetch calls, NO side effects
//  - NO imports from db.js or any page module (prevents circular deps)
//  - All state mutations go through view controllers, not directly here
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { REEL_PART_NUMBERS } from './config.js';
import { detectTcMode } from './utils.js';

// ── Navigation ────────────────────────────────────────────────
export const currentView   = ref('splash');   // 'splash'|'dashboard'|'wo_status'|'cs'|'manager'
export const selectedDept  = ref('');
export const loading       = ref(false);
export const currentTime   = ref('');

// Multi-level splash navigation
// splashLevel: 0=root, 1=category sub-menu, 2=subcategory sub-menu
export const splashLevel       = ref(0);
export const splashCategory    = ref('');  // 'production'|'inventory'|'purchasing'
export const splashSubCategory = ref(''); // 'active-wos'|'shipping'

// ── Work order data ───────────────────────────────────────────
export const orders        = ref([]);   // current dept orders (dashboard)
export const dashSearch    = ref('');   // per-department search filter
export const allOrders     = ref([]);   // all active orders (manager overview)
export const woStatusOrders = ref([]);  // wo_status_tracking rows (not yet closed)
export const closeoutOrders = ref([]);  // wo_status_tracking rows with erp_status='received'

// ── Action panel ──────────────────────────────────────────────
export const actionPanelOpen   = ref(false);
export const activeOrder       = ref(null);
export const selectedOperator  = ref('');
export const otherOperator     = ref('');
export const selectedOperators = ref([]);        // Fab/Weld multi-select
export const fabWeldOperatorReady = computed(() =>
    selectedOperators.value.length > 0 &&
    (!selectedOperators.value.includes('Other') || otherOperator.value.trim().length > 0)
);
export const actionForm        = ref({
    qtyCompleted: 0,
    qtyScrap:     0,
    scrapReason:  '',
    notes:        '',
    holdReason:   '',
    weldGrind:    ''   // 'weld' | 'grind' — only for reel parts
});

// ── New manual WO modal ───────────────────────────────────────
export const newWoModalOpen = ref(false);
// Base fields (all depts) + TC-specific fields (salesOrder, unitSerial, engine, engineSerial, numBlades)
export const newWoForm      = ref({
    // Shared
    part: '', desc: '', qty: 1, type: 'Unit',
    // TC Assy specific
    woNumber:     '',   // optional custom WO #
    salesOrder:   '',
    unitSerial:   '',
    engine:       '',
    engineSerial: '',
    numBlades:    ''
});
// Inline field-level validation errors for the TC Assy form
export const newWoFormErrors = ref({ part: false, desc: false, qty: false });

// TC manual-WO mode: null = auto-detect from part#, 'unit'/'stock' = user override
export const tcNewWoModeOverride = ref(null);
// The effective mode shown in the form (override takes priority over auto-detect)
export const tcNewWoMode = computed(() => tcNewWoModeOverride.value ?? detectTcMode(newWoForm.value.part));

// ── Notes modal ───────────────────────────────────────────────
export const notesPanelOpen  = ref(false);
export const noteAuthor      = ref('');
export const noteText        = ref('');
export const noteAuthorError = ref(false);
export const noteTextError   = ref(false);

// ── Undo ─────────────────────────────────────────────────────
// Stores the pre-mutation snapshot of the last changed WO
// Shape: { id, previousData, description, dept }
export const lastUndoAction = ref(null);

// ── Auth / PIN ────────────────────────────────────────────────
export const pinModalOpen = ref(false);
export const pinMode      = ref('');   // 'manager' | 'cs'
export const pinInput     = ref('');

// ── Office (WO Status) ────────────────────────────────────────
export const officeMode           = ref('receive');  // 'receive' | 'closeout'
export const officeSearchTerm     = ref('');
export const officeSearchResults  = ref([]);
export const officeSuccessMsg     = ref('');
export const officeCloseoutFilter  = ref('');
export const receiveEligibleList   = ref([]);   // eligible WOs for receiving (from eligible depts, not yet received/closed)
export const closeoutAuthorized    = ref(false); // true once Close-Out PIN verified; reset when leaving wo_status

// Receive modal
export const receiveModalOpen      = ref(false);
export const receiveTarget         = ref(null);
export const receiverName          = ref('');
export const receiverQty           = ref(null);
export const receiverBinLocation   = ref('');   // corrected bin location; triggers Alere alert when non-empty
export const receiverNameError     = ref(false);

// Closeout modal
export const closeoutModalOpen  = ref(false);
export const closeoutTarget     = ref(null);
export const closeoutName       = ref('');
export const closeoutNameError  = ref(false);

// Alere bin update confirmation (inline in receive view)
export const alereConfirmId        = ref(null);   // tracking row id currently being confirmed
export const alereUpdaterName      = ref('');
export const alereUpdaterNameError = ref(false);

// ── Manager AI Chat ───────────────────────────────────────────
export const aiChatOpen     = ref(false);
export const aiChatLoading  = ref(false);
export const aiChatInput    = ref('');
export const aiChatMessages = ref([]);  // [{role:'user'|'assistant', text:'...'}]

// ── Manager ───────────────────────────────────────────────────
export const assignCustomInput = ref({ id: null, text: '' }); // tracks "Other" inline input for priority assign-to
export const managerSubView = ref('home');   // 'home'|'kpi'|'priorities'|'delayed'
export const priorityDept   = ref('');
export const priorityOrders = ref([]);
export const delayedOrders  = ref([]);
// Always shows all 4 production dept columns, even when empty.
// Dept names normalized by fetchDelayedOrders so grouping is reliable.
const DELAYED_DEPT_ORDER = ['Fab', 'Weld', 'Trac Vac Assy', 'Tru Cut Assy'];
export const delayedOrdersByDept = computed(() => {
    const grouped = {};
    delayedOrders.value.forEach(o => {
        if (!grouped[o.department]) grouped[o.department] = [];
        grouped[o.department].push(o);
    });
    return DELAYED_DEPT_ORDER.map(dept => ({ dept, orders: grouped[dept] || [] }));
});
export const kpiStats       = ref({ completedThisWeek: 0, activeJobs: 0, onHoldCount: 0, delayedCount: 0 });
export const kpiByOperator  = ref([]);
export const kpiCycleTime   = ref([]);
export const kpiHoldReasons = ref([]);
export const kpiOldestWos   = ref([]);
export const managerAlerts  = ref({
    completedNotReceived: [],
    pausedOnHold:         [],
    startedNoProgress:    [],
    qtyMismatch:          []
});

// ── Delayed WO detail modal ───────────────────────────────────
export const delayedWoDetailOpen = ref(false);
export const delayedWoDetail     = ref(null);

// ── WO Problem draft (action panel inline form) ───────────────
export const woProblemDraftText      = ref('');
export const woProblemDraftError     = ref(false);
export const woProblemDraftName      = ref('');
export const woProblemDraftNameError = ref(false);

// ── WO Problems ───────────────────────────────────────────────
export const woProblems            = ref([]);   // open WO problems list
export const woProblemCount        = computed(() => woProblems.value.length);

// ── Manager badge counts ──────────────────────────────────────
// delayedWoCount: sum of all WOs across all dept groups (computed from live delayedOrdersByDept)
export const delayedWoCount = computed(() =>
    delayedOrdersByDept.value.reduce((sum, g) => sum + g.orders.length, 0)
);
// managerAlertCount: total of all 4 live alert arrays
export const managerAlertCount = computed(() => {
    const a = managerAlerts.value;
    return (a.completedNotReceived?.length || 0)
         + (a.pausedOnHold?.length        || 0)
         + (a.startedNoProgress?.length   || 0)
         + (a.qtyMismatch?.length         || 0);
});
export const managerTotalBadge = computed(() =>
    delayedWoCount.value + woProblemCount.value + managerAlertCount.value
);

// Resolve modal state
export const woProblemModalOpen        = ref(false);
export const woProblemTarget           = ref(null);   // WO row being resolved
export const woProblemResolution       = ref('');
export const woProblemResolutionError  = ref(false);
export const woProblemResolverName     = ref('');
export const woProblemResolverNameError = ref(false);

// ── Customer Service ──────────────────────────────────────────
export const csSearchTerm  = ref('');
export const csResultInfo  = ref(null);
export const csTimeline    = ref([]);
export const csOpenOrders  = ref([]);
export const csPastSearch   = ref('');       // search term for past assembly WOs panel
export const csPastResults  = ref([]);        // completed assy WO rows
export const csPastSort     = ref('wo_number'); // 'wo_number'|'sales_order'|'part_number'|'description'|'comp_date'
export const csPastSortDir  = ref('asc');        // 'asc'|'desc'
export const csPastSelected = ref(null);      // selected past WO row or null

// ── WO file attachments ───────────────────────────────────────
export const woFiles        = ref([]);         // file list for the currently open WO
export const woFilesLoading = ref(false);
export const partsWithFiles = ref(new Set());  // sanitized folder names of parts that have files

// ── Right-panel active tab ('attach' | 'notes' | 'complete') ──
export const woActionTab = ref('notes');

// ── Error toast ───────────────────────────────────────────────
export const tvModeSelectOpen = ref(false); // mode picker shown when tv_job_mode not yet saved
export const tvAssyEntryName  = ref('');
export const tvAssyNameError  = ref(false);
export const tvAssyOpEditing  = ref(false);  // inline operator-name edit in unit/stock modal
export const tvAssyJobType    = ref('');    // 'stock' | 'unit'
export const tvAssyStockOpen  = ref(false);
export const tvAssyUnitOpen   = ref(false);
export const tvStockPending     = ref('');   // ''|'cant_start'|'pause'|'complete'|'hold'
export const tvStockSessionQty  = ref('');
export const tvStockReason      = ref('');
export const tvStockQtyError    = ref(false);
export const tvStockReasonError = ref(false);
export const tvStockNotes       = ref('');

// ── TV Assy Unit: per-stage action state ──────────────────────
export const tvUnitHoldOpen        = ref(false);
export const tvUnitHoldReason      = ref('');
export const tvUnitHoldReasonError = ref(false);

export const tcUnitHoldOpen        = ref(false);
export const tcUnitHoldReason      = ref('');
export const tcUnitHoldReasonError = ref(false);
export const tvEngStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });

// ── TC Assy entry / workflow ──────────────────────────────────
export const tcAssyEntryOpen  = ref(false);
export const tcAssyEntryName  = ref('');
export const tcAssyNameError  = ref(false);
export const tcAssyJobType    = ref('');    // 'stock' | 'unit'
export const tcAssyUnitOpen   = ref(false);
export const tcAssyStockOpen  = ref(false);
export const tcAssyOpEditing  = ref(false);  // inline operator-name edit in stock/unit modal
export const tcStockPending   = ref('');    // ''|'start'|'cant_start'|'pause'|'resume'|'complete'|'hold'
export const tcStockSessionQty = ref('');
export const tcStockReason    = ref('');
export const tcStockQtyError  = ref(false);
export const tcStockReasonError = ref(false);
export const tcStockNotes     = ref('');    // optional notes on subassy completion
export const tcPreStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });
export const tcFinStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });
export const tvCrtStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });
export const tvFinStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });

// Entry modal mode: null = auto-detect from part#, 'unit'/'stock' = user override
export const tcEntryModeOverride = ref(null);
// Effective mode shown in the entry modal (override wins; falls back to part# detection)
export const tcEntryMode = computed(() =>
    tcEntryModeOverride.value ?? detectTcMode(activeOrder.value?.part_number)
);

export const tcAssyCompleteModalOpen = ref(false);
export const tcAssyCompleteForm = ref({ salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '', notes: '' });
export const tcAssyCompleteErrors = ref({ salesOrder: false, unitSerial: false, engine: false, engineSerial: false, numBlades: false });

// Inline-editable unit detail fields on the TC Unit workflow screen
export const tcUnitInfoForm = ref({ salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '', notes: '' });

// ── WO Requests ───────────────────────────────────────────────
export const woRequestInlineState = ref({}); // { [id]: { alere_qty, alere_bin, qty_sold_used_12mo, where_used } }
export const woRequests          = ref([]);
export const woRequestsLoading   = ref(false);
export const woRequestForm       = ref({
    part_number: '', description: '', sales_order_number: '',
    qty_on_order: '', qty_in_stock: '', qty_used_per_unit: '',
    submitted_by: ''
});
export const woRequestFormErrors = ref({ part_number: false, submitted_by: false });
export const woRequestSearch     = ref('');
export const selectedWoRequest   = ref(null);
export const woRequestDetailForm = ref({
    alere_qty: '', qty_sold_used_12mo: '', where_used: '', qty_to_make: '',
    fab: '', fab_print: '', weld: '', weld_print: '',
    assy_wo: '', color: '', bent_rolled_part: '', set_up_time: '',
    alere_bin: '', estimated_lead_time: '', sent_to_production: false, date_to_start: ''
});
export const filteredWoRequests = computed(() => {
    // Only show pending requests — approved and in-production move to Create WO view
    const pending = woRequests.value.filter(r => r.status === 'pending');
    const q = woRequestSearch.value.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter(r =>
        (r.part_number        || '').toLowerCase().includes(q) ||
        (r.description        || '').toLowerCase().includes(q) ||
        (r.sales_order_number || '').toLowerCase().includes(q) ||
        (r.submitted_by       || '').toLowerCase().includes(q)
    );
});

// ── Create WO ─────────────────────────────────────────────────
export const createWoItems       = ref([]);
export const createWoLoading     = ref(false);
// Per-row inline input state: { [id]: { wo_number: '', initials: '' } }
export const createWoInlineState = ref({});

// ── Inventory ─────────────────────────────────────────────────
export const inventoryTab     = ref('chute');   // 'chute'|'hitch'|'engine'|'hardware'|'hoses'
export const inventoryItems   = ref([]);
export const inventoryLoading = ref(false);
export const inventorySearch  = ref('');

// Pull form
export const pullFormOpen   = ref(false);
export const pullFormTarget = ref(null);
export const pullForm       = ref({ name: '', qty_pulled: '', new_location: '', where_used: '', date_pulled: '' });
export const pullFormErrors = ref({ name: false, qty_pulled: false });

// Add item form
export const addItemFormOpen   = ref(false);
export const addItemForm       = ref({ part_number: '', description: '', qty: 0, location: '', refill_location: '' });
export const addItemFormErrors = ref({ part_number: false });

// Edit item form
export const editItemFormOpen   = ref(false);
export const editItemFormTarget = ref(null);
export const editItemForm       = ref({ part_number: '', description: '', qty: 0, location: '', refill_location: '' });
export const editItemFormErrors = ref({ part_number: false });

// Pull history
export const pullHistoryOpen    = ref(false);
export const pullHistoryTarget  = ref(null);
export const pullHistoryItems   = ref([]);
export const pullHistoryLoading = ref(false);

export const toastMessage  = ref('');
export const toastType     = ref('error');   // 'error' | 'success' | 'info'
let toastTimer = null;

export function showToast(msg, type = 'error', durationMs = 4000) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.value = msg;
    toastType.value    = type;
    toastTimer = setTimeout(() => { toastMessage.value = ''; }, durationMs);
}

// ── Computed ──────────────────────────────────────────────────

// filteredInventoryItems — items matching the search query (part # or description).
export const filteredInventoryItems = computed(() => {
    const q = inventorySearch.value.trim().toLowerCase();
    if (!q) return inventoryItems.value;
    return inventoryItems.value.filter(i =>
        (i.part_number || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
    );
});

// Stage cumulative qty derived from notes history (no schema change needed)
export const tvEngineCum = computed(() => {
    const lines = (activeOrder.value?.notes || '').split('\n').filter(l => l.startsWith('TVENG|'));
    return lines.length ? parseFloat(lines.at(-1).split('|')[5]) || 0 : 0;
});
export const tvCartCum = computed(() => {
    const lines = (activeOrder.value?.notes || '').split('\n').filter(l => l.startsWith('TVCRT|'));
    return lines.length ? parseFloat(lines.at(-1).split('|')[5]) || 0 : 0;
});
export const tvFinalCum = computed(() => {
    const lines = (activeOrder.value?.notes || '').split('\n').filter(l => l.startsWith('TVFIN|'));
    return lines.length ? parseFloat(lines.at(-1).split('|')[5]) || 0 : 0;
});
export const tcPreCum = computed(() => {
    const lines = (activeOrder.value?.notes || '').split('\n').filter(l => l.startsWith('TCPRE|'));
    return lines.length ? parseFloat(lines.at(-1).split('|')[5]) || 0 : 0;
});
export const tcFinCum = computed(() => {
    const lines = (activeOrder.value?.notes || '').split('\n').filter(l => l.startsWith('TCFIN|'));
    return lines.length ? parseFloat(lines.at(-1).split('|')[5]) || 0 : 0;
});

export const appTitle = computed(() => {
    if (currentView.value === 'splash') {
        if (splashLevel.value === 0) return 'Midwest Mfg.';
        const catLabels = { production: 'Production', inventory: 'Inventory', purchasing: 'Purchasing' };
        if (splashLevel.value === 1) return catLabels[splashCategory.value] || 'Midwest Mfg.';
        const subLabels = { 'active-wos': 'Active WOs', shipping: 'Shipping' };
        return `${catLabels[splashCategory.value]} — ${subLabels[splashSubCategory.value] || ''}`;
    }
    if (currentView.value === 'dashboard') return `${selectedDept.value} Dashboard`;
    if (currentView.value === 'wo_status') return 'Office / WO Status';
    if (currentView.value === 'cs')        return 'Customer Service Lookup';
    if (currentView.value === 'wo_request') return 'Request WO';
    if (currentView.value === 'create_wo')  return 'Create Work Orders';
    if (currentView.value === 'inventory') {
        const labels = { chute: 'Chutes', hitch: 'Hitches', engine: 'Engines', hardware: 'Hardware', hoses: 'Hoses' };
        return `Inventory — ${labels[inventoryTab.value] || ''}`;
    }
    if (currentView.value === 'manager') {
        if (managerSubView.value === 'kpi')        return 'Manager Hub — KPIs';
        if (managerSubView.value === 'priorities') return 'Manager Hub — Priorities';
        if (managerSubView.value === 'delayed')    return 'Manager Hub — Delayed WOs';
        return "Manager's Hub";
    }
    return '';
});

// Static category config (icons + styles) for dashboard groups
export const dashboardCategories = [
    // Priority levels
    { id: 'priority_5', title: 'Priority 5', isPriority: true, priority: 5, borderColor: 'border-red-500/50', headerColor: 'bg-red-500/15 text-red-300', cardBorderTop: 'border-t-red-500', icon: '<svg class="w-6 h-6 text-red-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_4', title: 'Priority 4', isPriority: true, priority: 4, borderColor: 'border-orange-500/50', headerColor: 'bg-orange-500/15 text-orange-300', cardBorderTop: 'border-t-orange-500', icon: '<svg class="w-6 h-6 text-orange-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_3', title: 'Priority 3', isPriority: true, priority: 3, borderColor: 'border-yellow-500/50', headerColor: 'bg-yellow-500/15 text-yellow-300', cardBorderTop: 'border-t-yellow-500', icon: '<svg class="w-6 h-6 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_2', title: 'Priority 2', isPriority: true, priority: 2, borderColor: 'border-blue-500/50', headerColor: 'bg-blue-500/15 text-blue-300', cardBorderTop: 'border-t-blue-500', icon: '<svg class="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_1', title: 'Priority 1', isPriority: true, priority: 1, borderColor: 'border-cyan-500/50', headerColor: 'bg-cyan-500/15 text-cyan-300', cardBorderTop: 'border-t-cyan-500', icon: '<svg class="w-6 h-6 text-cyan-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    // Unassigned by status
    { id: 'unassigned_started', title: 'Unassigned — In Progress', borderColor: 'border-blue-500/30', headerColor: 'bg-blue-500/10 text-blue-400', cardBorderTop: 'border-t-blue-500', icon: '<svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' },
    { id: 'unassigned_paused', title: 'Unassigned — Paused', borderColor: 'border-amber-500/30', headerColor: 'bg-amber-500/10 text-amber-400', cardBorderTop: 'border-t-amber-500', icon: '<svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' },
    { id: 'unassigned_on_hold', title: 'Unassigned — On Hold', borderColor: 'border-red-500/30', headerColor: 'bg-red-500/10 text-red-500', cardBorderTop: 'border-t-red-500', icon: '<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>' },
    { id: 'unassigned_not_started', title: 'Unassigned — Not Started', borderColor: 'border-slate-600', headerColor: 'bg-slate-700 text-slate-300', cardBorderTop: 'border-t-slate-500', icon: '<svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>' }
];

// Orders grouped by priority (5-1), then unassigned by status
// Groups current dept orders by assigned_operator for the right-side panel.
// Only includes orders where assigned_operator is set. Returns [{operator, wos[]}].
export const assignedOrdersByOperator = computed(() => {
    const grouped = {};
    orders.value.filter(o => o.assigned_operator).forEach(o => {
        if (!grouped[o.assigned_operator]) grouped[o.assigned_operator] = [];
        grouped[o.assigned_operator].push(o);
    });
    return Object.entries(grouped).map(([operator, wos]) => ({
        operator,
        wos: [...wos].sort((a, b) => (b.priority || 0) - (a.priority || 0))
    }));
});

export const filteredOrders = computed(() => {
    const q = dashSearch.value.trim().toLowerCase();
    if (!q) return orders.value;
    return orders.value.filter(o =>
        (o.wo_number   || '').toLowerCase().includes(q) ||
        (o.part_number || '').toLowerCase().includes(q) ||
        (o.description || '').toLowerCase().includes(q) ||
        (o.sales_order || '').toLowerCase().includes(q) ||
        (o.operator    || '').toLowerCase().includes(q)
    );
});

export const groupedOrders = computed(() => {
    const STATUS_ORDER = { started: 0, resumed: 0, paused: 1, on_hold: 2, not_started: 3 };
    const groups = {
        priority_5: [], priority_4: [], priority_3: [], priority_2: [], priority_1: [],
        unassigned_started: [], unassigned_paused: [], unassigned_on_hold: [], unassigned_not_started: []
    };

    // Exclude WOs assigned to an operator — they appear in the right-side assigned panel instead
    filteredOrders.value.filter(o => !o.assigned_operator).forEach(o => {
        let stat = o.status || 'not_started';
        if (stat === 'resumed') stat = 'started';

        const pri = o.priority || 0;
        if (pri === 5) {
            groups.priority_5.push(o);
        } else if (pri === 4) {
            groups.priority_4.push(o);
        } else if (pri === 3) {
            groups.priority_3.push(o);
        } else if (pri === 2) {
            groups.priority_2.push(o);
        } else if (pri === 1) {
            groups.priority_1.push(o);
        } else {
            // Unassigned: organize by status
            if (stat === 'started') groups.unassigned_started.push(o);
            else if (stat === 'paused') groups.unassigned_paused.push(o);
            else if (stat === 'on_hold') groups.unassigned_on_hold.push(o);
            else groups.unassigned_not_started.push(o);
        }
    });

    // Within each priority group, sort by status then due date
    [1, 2, 3, 4, 5].forEach(p => {
        const key = `priority_${p}`;
        groups[key].sort((a, b) => {
            const sa = STATUS_ORDER[a.status] ?? 3;
            const sb = STATUS_ORDER[b.status] ?? 3;
            if (sa !== sb) return sa - sb;
            if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
            return 0;
        });
    });

    return groups;
});

// Filtered closeout list for office view
export const filteredCloseoutOrders = computed(() => {
    if (!officeCloseoutFilter.value.trim()) return closeoutOrders.value;
    const t = officeCloseoutFilter.value.toLowerCase();
    return closeoutOrders.value.filter(o =>
        (o.wo_number    || '').toLowerCase().includes(t) ||
        (o.part_number  || '').toLowerCase().includes(t) ||
        (o.description  || '').toLowerCase().includes(t)
    );
});

// WOs in wo_status_tracking that need an Alere bin location update
export const alerePendingOrders = computed(() =>
    woStatusOrders.value.filter(o => o.alere_bin_update_needed === true)
);

// Is the active order a reel part? (triggers weld/grind selection)
export const isReel = computed(() => {
    return activeOrder.value
        ? REEL_PART_NUMBERS.includes(activeOrder.value.part_number)
        : false;
});
