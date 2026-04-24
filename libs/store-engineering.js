// ============================================================
// libs/store-engineering.js — Engineering tab reactive state
//
// Re-exported by store.js. No fetch calls, no DB access.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// Which engineering sub-view is active: 'inquiries' | 'followup'
export const engView = ref('inquiries');

// Inquiry list
export const engInquiries        = ref([]);
export const engInquiriesLoading = ref(false);

// Status / priority / assignee filters; manual sort key ('' = auto-sort)
export const engStatusFilter   = ref('');
export const engPriorityFilter = ref('');
export const engAssigneeFilter = ref('');
export const engManualSort     = ref('');

// New inquiry form
export const engInquiryFormOpen   = ref(false);
export const engInquiryForm       = ref({});
export const engInquiryFormErrors = ref({});
export const engNewInquiryFiles   = ref([]); // File objects queued before insert

// Selected inquiry (detail / edit modal)
export const engSelectedInquiry    = ref(null);
export const engInquiryDetailOpen  = ref(false);
export const engImagesModalOpen    = ref(false); // images-only popup

// Images for the selected inquiry
export const engInquiryImages   = ref([]);
export const engImagesLoading   = ref(false);

// Per-card new log entry inputs, keyed as `${inq.id}_csr`, `_eng`, `_action`
export const engNewEntries = ref({});

// filteredEngInquiries — filters by status/priority/assignee then sorts.
export const filteredEngInquiries = computed(() => {
    let list = engInquiries.value;
    if (engStatusFilter.value)   list = list.filter(r => r.status      === engStatusFilter.value);
    if (engPriorityFilter.value) list = list.filter(r => r.priority    === engPriorityFilter.value);
    if (engAssigneeFilter.value) list = list.filter(r => r.assigned_to === engAssigneeFilter.value);

    const PRIORITY = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const STATUS   = { 'Not Started': 0, 'In Progress': 1, 'Ready to Design': 2,
                       'Needs Measurements': 3,
                       'Design Complete / Ready to Order': 4,
                       'On Hold': 5, 'Done': 6, 'Canceled': 7 };
    const out = [...list];
    const ms  = engManualSort.value;
    if (!ms) {
        out.sort((a, b) => {
            const pd = (PRIORITY[a.priority] ?? 4) - (PRIORITY[b.priority] ?? 4);
            if (pd !== 0) return pd;
            const da = a.date_entered || '', db = b.date_entered || '';
            if (da !== db) return da < db ? -1 : 1;
            return (STATUS[a.status] ?? 8) - (STATUS[b.status] ?? 8);
        });
    } else if (ms === 'date_entered') {
        out.sort((a, b) => {
            const da = a.date_entered || '', db = b.date_entered || '';
            return da < db ? 1 : da > db ? -1 : 0;
        });
    } else if (ms === 'status') {
        out.sort((a, b) => (STATUS[a.status] ?? 8) - (STATUS[b.status] ?? 8));
    } else if (ms === 'assigned_to') {
        out.sort((a, b) => (a.assigned_to || '').localeCompare(b.assigned_to || ''));
    } else if (ms === 'priority') {
        out.sort((a, b) => (PRIORITY[a.priority] ?? 4) - (PRIORITY[b.priority] ?? 4));
    }
    return out;
});
