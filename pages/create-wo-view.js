// ============================================================
// pages/create-wo-view.js — Create WO queue logic
//
// Shows approved WO requests. Operator enters the Alere WO #
// and their initials, then confirms — sets status to 'in production'.
// Imports from store + db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadCreateWoItems — fetch all 'approved' requests and populate store + inline state.
export async function loadCreateWoItems() {
    store.createWoLoading.value = true;
    try {
        const { data, error } = await db.fetchApprovedWoRequests();
        if (error) throw error;
        const items = data || [];
        store.createWoItems.value = items;
        // Initialize inline input state for each item (preserve existing input if present)
        const prev  = store.createWoInlineState.value;
        const state = {};
        items.forEach(item => {
            state[item.id] = prev[item.id] || { wo_number: '', initials: '' };
        });
        store.createWoInlineState.value = state;
    } catch (err) {
        store.showToast('Failed to load approved WOs: ' + err.message);
        logError('loadCreateWoItems', err);
        store.createWoItems.value = [];
    } finally {
        store.createWoLoading.value = false;
    }
}

// confirmCreateWoItem — validate inline inputs, mark confirmed, insert work_orders rows,
// then reload list. id: uuid of the wo_request row.
export async function confirmCreateWoItem(id) {
    const state = store.createWoInlineState.value[id];
    const req   = store.createWoItems.value.find(r => r.id === id);
    if (!state || !req) return;

    const woNumber = (state.wo_number || '').trim();
    const initials = (state.initials  || '').trim();

    if (!woNumber || !initials) {
        store.showToast('Enter WO # and Initials before confirming.', 'error');
        return;
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    store.loading.value = true;
    try {
        // 1. Mark the request as 'in production' with WO # + initials + date
        const { error: confirmErr } = await db.confirmCreateWo(id, woNumber, initials, today);
        if (confirmErr) throw confirmErr;

        // 2. Route into work_orders based on fab/weld/assy fields
        const { data: inserted, error: routeErr } = await db.insertWorkOrdersFromRequest(req, woNumber);
        if (routeErr) throw routeErr;

        const deptNames = (inserted || []).map(r => r.department).join(', ');
        const msg = deptNames
            ? `WO created → ${deptNames}`
            : 'WO confirmed — no dept routing (no fab/weld/assy flags set).';
        store.showToast(msg, 'success');

        // Sync WO# + status → 'WO Created' on matching open order
        const soNum = (req.sales_order_number || '').trim();
        const part  = (req.part_number        || '').trim().toUpperCase();
        if (soNum && part && woNumber) {
            const { data: oo } = await db.findOpenOrderBySoAndPart(soNum, part);
            if (oo) {
                await db.updateOpenOrder(oo.id, { wo_po_number: woNumber, status: 'WO Created', last_status_update: new Date().toISOString() });
            }
        }

        await loadCreateWoItems();
    } catch (err) {
        store.showToast('Failed to confirm WO: ' + err.message, 'error');
        logError('confirmCreateWoItem', err, { id });
    } finally {
        store.loading.value = false;
    }
}
