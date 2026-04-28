// ============================================================
// libs/store.js — Core reactive state + re-export hub
//
// Contains: navigation, work orders, action panel, new WO modal,
//           notes, undo, auth/PIN, office, toast, key computeds.
// All other domain state lives in store-*.js sub-files and is
// re-exported here so callers keep: import * as store from './store.js'
//
// RULES:
//  - Only ref() and computed() — NO fetch calls, NO DB access
//  - Import from config + utils only (plus sub-store re-exports)
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { REEL_PART_NUMBERS } from './config.js';
import { detectTcMode, detectReelWeld } from './utils.js';

// Bring inventoryTab into scope for appTitle computed (one-way, no circular dep)
import { inventoryTab } from './store-inventory.js';

// Re-export all sub-store state so callers need only one import
export * from './store-manager.js';
export * from './store-assy.js';
export * from './store-inventory.js';
export * from './store-engineering.js';

// ── Navigation ────────────────────────────────────────────────
export const currentView   = ref('login');
export const selectedDept  = ref('');
export const loading       = ref(false);
export const currentTime   = ref('');

export const splashLevel       = ref(0);
export const splashCategory    = ref('');
export const splashSubCategory = ref('');

// ── Work order data ───────────────────────────────────────────
export const orders          = ref([]);
export const dashSearch      = ref('');
export const allOrders       = ref([]);
export const woStatusOrders  = ref([]);
export const closeoutOrders  = ref([]);

// ── Dept completed WOs view ───────────────────────────────────
export const completedDeptOrders  = ref([]);
export const closedOutDeptOrders  = ref([]);
export const showingCompletedDept = ref(false);

// ── Action panel ──────────────────────────────────────────────
export const actionPanelOpen   = ref(false);
export const activeOrder       = ref(null);
export const selectedOperator  = ref('');
export const otherOperator     = ref('');
export const selectedOperators = ref([]);
export const fabWeldOperatorReady = computed(() => selectedOperator.value.trim().length > 0);
export const actionForm = ref({
    qtyCompleted: 0,
    qtyScrap:     0,
    scrapReason:  '',
    notes:        '',
    holdReason:   ''
});

// ── Reel Weld per-operation state ─────────────────────────────
export const reelWeldOperator  = ref('');
export const reelGrindOperator = ref('');
export const reelWeldOtherOp   = ref('');
export const reelGrindOtherOp  = ref('');
export const reelWeldQty       = ref(0);
export const reelGrindQty      = ref(0);

// ── New manual WO modal ───────────────────────────────────────
export const newWoModalOpen = ref(false);
export const newWoForm      = ref({
    part: '', desc: '', qty: 1, dept: '', woType: 'Unit',
    salesOrder: '', woNumber: '', unitSerial: '', engine: '', engineSerial: '', numBlades: ''
});
export const newWoFormErrors     = ref({ part: false, desc: false, qty: false });
export const tcNewWoModeOverride = ref(null);
export const tcNewWoMode = computed(() => tcNewWoModeOverride.value ?? detectTcMode(newWoForm.value.part));

// ── Notes modal ───────────────────────────────────────────────
export const notesPanelOpen  = ref(false);
export const noteAuthor      = ref('');
export const noteText        = ref('');
export const noteAuthorError = ref(false);
export const noteTextError   = ref(false);

// ── Undo ──────────────────────────────────────────────────────
export const lastUndoAction = ref(null);

// ── Session login ─────────────────────────────────────────────
export const sessionRole        = ref(null);   // 'fab'|'weld'|'assy'|'manager'|null
export const loginUsername      = ref('');
export const loginPassword      = ref('');
export const loginError         = ref('');
export const loginLoading       = ref(false);
export const showLoginPassword  = ref(false);

// ── Auth / PIN ────────────────────────────────────────────────
export const pinModalOpen = ref(false);
export const pinMode      = ref('');
export const pinInput     = ref('');

// ── Office (WO Status) ────────────────────────────────────────
export const officeMode           = ref('receive');
export const officeSearchTerm     = ref('');
export const officeSearchResults  = ref([]);
export const officeSuccessMsg     = ref('');
export const officeCloseoutFilter = ref('');
export const receiveEligibleList  = ref([]);
export const closeoutAuthorized   = ref(false);

export const receiveModalOpen    = ref(false);
export const receiveTarget       = ref(null);
export const receiverName        = ref('');
export const receiverQty         = ref(null);
export const receiverBinLocation = ref('');
export const receiverNameError   = ref(false);

export const closeoutModalOpen = ref(false);
export const closeoutTarget    = ref(null);
export const closeoutName      = ref('');
export const closeoutNameError = ref(false);

export const alereConfirmId        = ref(null);
export const alereUpdaterName      = ref('');
export const alereUpdaterNameError = ref(false);

// ── TC entry mode (stays here — references activeOrder above) ─
export const tcEntryModeOverride = ref(null);
export const tcEntryMode = computed(() =>
    tcEntryModeOverride.value ?? detectTcMode(activeOrder.value?.part_number)
);

// ── Connectivity ──────────────────────────────────────────────
export const isOffline = ref(false);

// ── Toast ─────────────────────────────────────────────────────
export const toastMessage = ref('');
export const toastType    = ref('error');
let toastTimer = null;

export function showToast(msg, type = 'error', durationMs = 4000) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.value = msg;
    toastType.value    = type;
    toastTimer = setTimeout(() => { toastMessage.value = ''; }, durationMs);
}

// ── Computed ──────────────────────────────────────────────────

// Stage cumulative qty derived from notes history
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
    if (currentView.value === 'dashboard')  return `${selectedDept.value} Dashboard`;
    if (currentView.value === 'wo_status')  return 'Office / WO Status';
    if (currentView.value === 'cs')         return 'Customer Service Lookup';
    if (currentView.value === 'wo_request') return 'Request WO';
    if (currentView.value === 'create_wo')  return 'Create Work Orders';
    if (currentView.value === 'inventory') {
        const labels = { chute: 'Chutes', hitch: 'Hitches', engine: 'Engines', hardware: 'Hardware', hoses: 'Hoses' };
        return `Inventory — ${labels[inventoryTab.value] || ''}`;
    }
    if (currentView.value === 'open_orders') return 'Open Orders — Shipping';
    if (currentView.value === 'manager') {
        if (managerSubView.value === 'kpi')        return 'Manager Hub — KPIs';
        if (managerSubView.value === 'priorities') return 'Manager Hub — Priorities';
        if (managerSubView.value === 'delayed')    return 'Manager Hub — Delayed WOs';
        return "Manager's Hub";
    }
    return '';
});

// Static category config for dashboard groups
export const dashboardCategories = [
    { id: 'priority_5', title: 'Priority 5', isPriority: true, priority: 5, borderColor: 'border-red-500/50', headerColor: 'bg-red-500/15 text-red-300', cardBorderTop: 'border-t-red-500', icon: '<svg class="w-6 h-6 text-red-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_4', title: 'Priority 4', isPriority: true, priority: 4, borderColor: 'border-orange-500/50', headerColor: 'bg-orange-500/15 text-orange-300', cardBorderTop: 'border-t-orange-500', icon: '<svg class="w-6 h-6 text-orange-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_3', title: 'Priority 3', isPriority: true, priority: 3, borderColor: 'border-yellow-500/50', headerColor: 'bg-yellow-500/15 text-yellow-300', cardBorderTop: 'border-t-yellow-500', icon: '<svg class="w-6 h-6 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_2', title: 'Priority 2', isPriority: true, priority: 2, borderColor: 'border-blue-500/50', headerColor: 'bg-blue-500/15 text-blue-300', cardBorderTop: 'border-t-blue-500', icon: '<svg class="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'priority_1', title: 'Priority 1', isPriority: true, priority: 1, borderColor: 'border-cyan-500/50', headerColor: 'bg-cyan-500/15 text-cyan-300', cardBorderTop: 'border-t-cyan-500', icon: '<svg class="w-6 h-6 text-cyan-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    { id: 'unassigned_started',     title: 'Unassigned — In Progress', borderColor: 'border-blue-500/30',  headerColor: 'bg-blue-500/10 text-blue-400',  cardBorderTop: 'border-t-blue-500',  icon: '<svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' },
    { id: 'unassigned_paused',      title: 'Unassigned — Paused',      borderColor: 'border-amber-500/30', headerColor: 'bg-amber-500/10 text-amber-400', cardBorderTop: 'border-t-amber-500', icon: '<svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' },
    { id: 'unassigned_on_hold',     title: 'Unassigned — On Hold',     borderColor: 'border-red-500/30',   headerColor: 'bg-red-500/10 text-red-500',    cardBorderTop: 'border-t-red-500',   icon: '<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>' },
    { id: 'unassigned_not_started', title: 'Unassigned — Not Started', borderColor: 'border-slate-600',    headerColor: 'bg-slate-700 text-slate-300',   cardBorderTop: 'border-t-slate-500', icon: '<svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>' }
];

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
    filteredOrders.value.filter(o => !o.assigned_operator).forEach(o => {
        let stat = o.status || 'not_started';
        if (stat === 'resumed') stat = 'started';
        const pri = o.priority || 0;
        if      (pri === 5) groups.priority_5.push(o);
        else if (pri === 4) groups.priority_4.push(o);
        else if (pri === 3) groups.priority_3.push(o);
        else if (pri === 2) groups.priority_2.push(o);
        else if (pri === 1) groups.priority_1.push(o);
        else {
            if      (stat === 'started')     groups.unassigned_started.push(o);
            else if (stat === 'paused')      groups.unassigned_paused.push(o);
            else if (stat === 'on_hold')     groups.unassigned_on_hold.push(o);
            else                             groups.unassigned_not_started.push(o);
        }
    });
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

export const filteredCloseoutOrders = computed(() => {
    if (!officeCloseoutFilter.value.trim()) return closeoutOrders.value;
    const t = officeCloseoutFilter.value.toLowerCase();
    return closeoutOrders.value.filter(o =>
        (o.wo_number   || '').toLowerCase().includes(t) ||
        (o.part_number || '').toLowerCase().includes(t) ||
        (o.description || '').toLowerCase().includes(t)
    );
});

// ── Closed Out WOs history ─────────────────────────────────────
export const closedOutOrders = ref([]);
export const closedOutFrom   = ref('');
export const closedOutTo     = ref('');
export const closedOutFilter = ref('');
export const filteredClosedOutOrders = computed(() => {
    if (!closedOutFilter.value.trim()) return closedOutOrders.value;
    const t = closedOutFilter.value.toLowerCase();
    return closedOutOrders.value.filter(o =>
        (o.wo_number   || '').toLowerCase().includes(t) ||
        (o.part_number || '').toLowerCase().includes(t) ||
        (o.description || '').toLowerCase().includes(t)
    );
});

export const alerePendingOrders = computed(() =>
    woStatusOrders.value.filter(o => o.alere_bin_update_needed === true)
);

export const isReel = computed(() =>
    activeOrder.value ? detectReelWeld(activeOrder.value.part_number, REEL_PART_NUMBERS) : false
);

// ── Reminder email settings ────────────────────────────────────
export const reminderEmailModalOpen = ref(false);
export const reminderEmail          = ref('');
export const reminderEmailSaving    = ref(false);

// ── Engineering quick-links (dynamic list, persisted in app_settings) ──
export const headerLinks          = ref([{ label: '', url: '' }]);
export const headerLinksModalOpen = ref(false);
export const headerLinksSaving    = ref(false);

// ── Splash quick-links (dynamic list, persisted in app_settings) ──
export const splashLinks          = ref([{ label: '', url: '' }]);
export const splashLinksModalOpen = ref(false);
export const splashLinksSaving    = ref(false);

// managerSubView is re-exported from store-manager.js but appTitle references it.
// Since store.js does export * from store-manager.js, managerSubView is available
// in the module namespace — but not as a local binding. Import it directly:
import { managerSubView } from './store-manager.js';
