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

// ── Navigation ────────────────────────────────────────────────
export const currentView   = ref('splash');   // 'splash'|'dashboard'|'wo_status'|'cs'|'manager'
export const selectedDept  = ref('');
export const loading       = ref(false);
export const currentTime   = ref('');

// ── Work order data ───────────────────────────────────────────
export const orders        = ref([]);   // current dept orders (dashboard)
export const allOrders     = ref([]);   // all active orders (manager overview)
export const woStatusOrders = ref([]);  // wo_status_tracking rows (not yet closed)
export const closeoutOrders = ref([]);  // wo_status_tracking rows with erp_status='received'

// ── Action panel ──────────────────────────────────────────────
export const actionPanelOpen   = ref(false);
export const activeOrder       = ref(null);
export const selectedOperator  = ref('');
export const otherOperator     = ref('');
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
export const newWoForm      = ref({ part: '', desc: '', qty: 1, type: 'Unit' });

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
export const officeCloseoutFilter = ref('');

// Receive modal
export const receiveModalOpen  = ref(false);
export const receiveTarget     = ref(null);
export const receiverName      = ref('');
export const receiverQty       = ref(null);
export const receiverNameError = ref(false);

// Closeout modal
export const closeoutModalOpen  = ref(false);
export const closeoutTarget     = ref(null);
export const closeoutName       = ref('');
export const closeoutNameError  = ref(false);

// ── Manager ───────────────────────────────────────────────────
export const managerSubView = ref('home');   // 'home'|'kpi'|'priorities'|'delayed'
export const priorityDept   = ref('');
export const priorityOrders = ref([]);
export const delayedOrders  = ref([]);
export const kpiStats       = ref({ completedThisWeek: 0, activeJobs: 0, onHoldCount: 0, delayedCount: 0 });
export const kpiByOperator  = ref([]);
export const kpiCycleTime   = ref([]);
export const kpiHoldReasons = ref([]);
export const kpiOldestWos   = ref([]);

// ── Customer Service ──────────────────────────────────────────
export const csSearchTerm  = ref('');
export const csResultInfo  = ref(null);
export const csTimeline    = ref([]);
export const csOpenOrders  = ref([]);

// ── Error toast ───────────────────────────────────────────────
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

export const appTitle = computed(() => {
    if (currentView.value === 'splash')    return 'Shop Floor Kiosk';
    if (currentView.value === 'dashboard') return `${selectedDept.value} Dashboard`;
    if (currentView.value === 'wo_status') return 'Office / WO Status';
    if (currentView.value === 'cs')        return 'Customer Service Lookup';
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
    {
        id: 'prioritized', title: 'Prioritized', isPrioritized: true,
        icon: `<svg class="w-6 h-6 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
        borderColor: 'border-amber-400/50', headerColor: 'bg-amber-500/15 text-amber-300', cardBorderTop: 'border-t-amber-400'
    },
    {
        id: 'started', title: 'In Progress',
        icon: `<svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
        borderColor: 'border-blue-500/30', headerColor: 'bg-blue-500/10 text-blue-400', cardBorderTop: 'border-t-blue-500'
    },
    {
        id: 'paused', title: 'Paused',
        icon: `<svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
        borderColor: 'border-amber-500/30', headerColor: 'bg-amber-500/10 text-amber-400', cardBorderTop: 'border-t-amber-500'
    },
    {
        id: 'on_hold', title: 'On Hold',
        icon: `<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
        borderColor: 'border-red-500/30', headerColor: 'bg-red-500/10 text-red-500', cardBorderTop: 'border-t-red-500'
    },
    {
        id: 'not_started', title: 'Not Started',
        icon: `<svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>`,
        borderColor: 'border-slate-600', headerColor: 'bg-slate-700 text-slate-300', cardBorderTop: 'border-t-slate-500'
    }
];

// Orders grouped by status for the dashboard grid
export const groupedOrders = computed(() => {
    const STATUS_ORDER = { started: 0, resumed: 0, paused: 1, on_hold: 2, not_started: 3 };
    const groups = { prioritized: [], started: [], paused: [], on_hold: [], not_started: [] };
    orders.value.forEach(o => {
        let stat = o.status || 'not_started';
        if (stat === 'resumed') stat = 'started';
        if ((o.priority || 0) > 0) {
            groups.prioritized.push(o);
        } else {
            if (groups[stat]) groups[stat].push(o);
            else groups.not_started.push(o);
        }
    });
    // Sort prioritized: highest priority first, then by status, then by due date
    groups.prioritized.sort((a, b) => {
        if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
        const sa = STATUS_ORDER[a.status] ?? 3;
        const sb = STATUS_ORDER[b.status] ?? 3;
        if (sa !== sb) return sa - sb;
        if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
        return 0;
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

// Is the active order a reel part? (triggers weld/grind selection)
export const isReel = computed(() => {
    return activeOrder.value
        ? REEL_PART_NUMBERS.includes(activeOrder.value.part_number)
        : false;
});
