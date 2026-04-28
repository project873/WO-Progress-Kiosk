// ============================================================
// libs/store-inventory.js — CS, WO files, WO requests, inventory,
//                           open orders reactive state
//
// Re-exported by store.js. No imports from store.js.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── Customer Service ──────────────────────────────────────────
export const csSearchTerm  = ref('');
export const csResultInfo  = ref(null);
export const csTimeline    = ref([]);
export const csOpenOrders  = ref([]);
export const csPastSearch   = ref('');
export const csPastResults  = ref([]);
export const csPastSort     = ref('wo_number');
export const csPastSortDir  = ref('asc');
export const csPastSelected = ref(null);

// ── WO file attachments ───────────────────────────────────────
export const woFiles        = ref([]);
export const woFilesLoading = ref(false);
export const partsWithFiles = ref(new Set());

// ── WO Requests ───────────────────────────────────────────────
export const woRequestInlineState = ref({});
export const woRequests           = ref([]);
export const woRequestsLoading    = ref(false);
export const woRequestSoHint      = ref(null); // { salesOrder, qty, partNumber } or null
export const woRequestForm        = ref({
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
    alere_bin: '', estimated_lead_time: '', sent_to_production: false, date_to_start: '',
    production_notes: ''
});
export const filteredWoRequests = computed(() => {
    const q = woRequestSearch.value.trim().toLowerCase();
    if (!q) return woRequests.value;
    return woRequests.value.filter(r =>
        (r.part_number        || '').toLowerCase().includes(q) ||
        (r.description        || '').toLowerCase().includes(q) ||
        (r.sales_order_number || '').toLowerCase().includes(q) ||
        (r.submitted_by       || '').toLowerCase().includes(q)
    );
});

// ── WO Forecasting ────────────────────────────────────────────
export const forecastingItems     = ref([]);
export const forecastingLoading   = ref(false);
export const forecastDeleteId     = ref(null); // ID pending hard-delete confirmation
export const forecastMoveBackId   = ref(null); // ID pending move-back-to-request confirmation
export const sendToForecastOpen   = ref(false);
export const sendToForecastTarget = ref(null);
export const sendToForecastForm   = ref({ forecast_date: '', forecast_reason: '' });
export const sendToForecastErrors = ref({ forecast_date: false, forecast_reason: false });

// ── Create WO ─────────────────────────────────────────────────
export const createWoItems       = ref([]);
export const createWoLoading     = ref(false);
export const createWoInlineState = ref({});
export const createWoTab         = ref('pending'); // 'pending' | 'created'
export const createdWoItems      = ref([]);

// ── Inventory ─────────────────────────────────────────────────
export const inventoryTab     = ref('chute');
export const inventoryItems   = ref([]);
export const inventoryLoading = ref(false);
export const inventorySearch  = ref('');

export const pullFormOpen   = ref(false);
export const pullFormTarget = ref(null);
export const pullForm       = ref({ name: '', qty_pulled: '', new_location: '', where_used: '', date_pulled: '' });
export const pullFormErrors = ref({ name: false, qty_pulled: false });

export const addItemFormOpen   = ref(false);
export const addItemForm       = ref({ part_number: '', description: '', qty: 0, location: '', refill_location: '' });
export const addItemFormErrors = ref({ part_number: false });

export const editItemFormOpen   = ref(false);
export const editItemFormTarget = ref(null);
export const editItemForm       = ref({ part_number: '', description: '', qty: 0, location: '', refill_location: '' });
export const editItemFormErrors = ref({ part_number: false });

export const pullHistoryOpen    = ref(false);
export const pullHistoryTarget  = ref(null);
export const pullHistoryItems   = ref([]);
export const pullHistoryLoading = ref(false);

export const filteredInventoryItems = computed(() => {
    const q = inventorySearch.value.trim().toLowerCase();
    if (!q) return inventoryItems.value;
    return inventoryItems.value.filter(i =>
        (i.part_number || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
    );
});

// ── Completed Orders ──────────────────────────────────────────
export const completedOrders        = ref([]);
export const completedOrdersLoading = ref(false);

// ── Open Orders ───────────────────────────────────────────────
export const openOrders        = ref([]);
export const openOrdersLoading = ref(false);
export const openOrderColorPickerRow = ref(null);

export const openOrderAddModalOpen = ref(false);
export const openOrderAddMode      = ref('manual');
export const openOrderAddPasteText = ref('');
export const openOrderAddPasteRows = ref([]);
export const openOrderAddForm      = ref({
    part_number: '', to_ship: '', qty_pulled: '', description: '',
    store_bin: '', update_store_bin: '', customer: '', sales_order: '',
    date_entered: new Date().toISOString().split('T')[0], deadline: '', status: 'New/Picking',
    wo_va_notes: '', wo_po_number: '',
});
export const openOrderAddFormErrors = ref({});

export const openOrderEditingCell  = ref({ id: null, field: null });
export const openOrderEditingValue = ref('');
export const openOrderSelectedIds  = ref([]);
export const openOrderBulkStatus   = ref('');
export const openOrderDragOverSection = ref('');
export const openOrderDropZoneTarget  = ref('');
export const openOrderExpandedCols    = ref({});

export const openOrderWoPanel        = ref(null);
export const openOrderWoPanelOrders  = ref([]);
export const openOrderWoPanelLoading = ref(false);

export const openOrdersSort = ref({
    emergency: { field: 'sort_order', dir: 'asc' },
    freight:   { field: 'sort_order', dir: 'asc' },
    trac_vac:  { field: 'sort_order', dir: 'asc' },
    tru_cut:   { field: 'sort_order', dir: 'asc' },
});

function _openSectionSorted(type) {
    return computed(() => {
        const { field, dir } = openOrdersSort.value[type];
        const rows = openOrders.value.filter(o => o.order_type === type);
        return [...rows].sort((a, b) => {
            let av = a[field] ?? '';
            let bv = b[field] ?? '';
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    });
}
export const emergencyOrders = _openSectionSorted('emergency');
export const freightOrders   = _openSectionSorted('freight');
export const tracVacOrders   = _openSectionSorted('trac_vac');
export const truCutOrders    = _openSectionSorted('tru_cut');

export const openOrderSections = computed(() => [
    { type: 'emergency', label: 'EMERGENCY ORDERS', orders: emergencyOrders.value, hdr: 'bg-green-700'  },
    { type: 'freight',   label: 'FREIGHT ORDERS',   orders: freightOrders.value,   hdr: 'bg-amber-700'  },
    { type: 'trac_vac',  label: 'TRAC VAC ORDERS',  orders: tracVacOrders.value,   hdr: 'bg-slate-900'  },
    { type: 'tru_cut',   label: 'TRU CUT ORDERS',   orders: truCutOrders.value,    hdr: 'bg-red-700'    },
]);
