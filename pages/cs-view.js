// ============================================================
// pages/cs-view.js — Customer Service lookup & timeline
//
// Handles: search by WO#/SO#/Part#, build production timeline,
//          estimate days remaining using historical avg or defaults
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { CS_LEAD_TIME_DEFAULTS } from '../libs/config.js';
import { getHistoricalAvgDays } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// ── searchPastOrders ───────────────────────────────────────────
// Search completed assembly WOs using the csPastSearch term.
// Populates csPastResults and clears any selected row.
export async function searchPastOrders() {
    const term = store.csPastSearch.value.trim();
    if (!term) return;
    store.loading.value = true;
    store.csPastSelected.value = null;
    try {
        const { rows, error } = await db.searchPastAssyOrders(term);
        if (error) throw error;
        store.csPastResults.value = rows;
    } catch (err) {
        store.showToast('Past WO search failed: ' + err.message);
        logError('searchPastOrders', err, { term: store.csPastSearch.value });
        store.csPastResults.value = [];
    } finally {
        store.loading.value = false;
    }
}

// ── selectPastWo ───────────────────────────────────────────────
// Toggle-select a past WO row for detail display.
// Input: wo row object. Output: sets csPastSelected (or clears if same row).
export function selectPastWo(wo) {
    if (store.csPastSelected.value && store.csPastSelected.value.id === wo.id) {
        store.csPastSelected.value = null;
    } else {
        store.csPastSelected.value = wo;
    }
}

// ── clearPastOrders ────────────────────────────────────────────
// Clear the past WOs panel search and results.
export function clearPastOrders() {
    store.csPastSearch.value   = '';
    store.csPastResults.value  = [];
    store.csPastSelected.value = null;
}

// ── searchCS ──────────────────────────────────────────────────
export async function searchCS() {
    const term = store.csSearchTerm.value.trim();
    if (!term) return;

    store.loading.value    = true;
    store.csResultInfo.value = null;
    store.csTimeline.value   = [];
    store.csOpenOrders.value = [];

    try {
        // Search by WO#, Sales Order#, and Part# in parallel
        const { byWo, bySo, byPart, error } = await db.searchCsOrders(term);
        if (error) throw error;

        // Timeline rows: match by WO# first, then SO#
        const timelineRows = byWo.length ? byWo : (bySo.length ? bySo : []);
        const partRows     = byPart;

        // Open WOs panel: show part-number matches or fallback to timeline rows
        const panelRows = partRows.length ? partRows : timelineRows.filter(r => r.status !== 'completed');
        const seen = new Set();
        store.csOpenOrders.value = panelRows.filter(o => {
            const key = o.wo_number + '|' + o.department;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Nothing found at all
        if (timelineRows.length === 0 && store.csOpenOrders.value.length === 0) {
            store.csResultInfo.value = { notFound: true };
            return;
        }

        // No timeline rows but open WOs found (part-number search only)
        if (timelineRows.length === 0) return;

        // ── Build timeline ────────────────────────────────────
        const ref = timelineRows[0];

        const hasFab  = timelineRows.some(r => r.department === 'Fab');
        const hasWeld = timelineRows.some(r => r.department === 'Weld');
        const hasAssy = timelineRows.some(r => ['TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy', 'Assy'].includes(r.department));

        const fabRow  = timelineRows.find(r => r.department === 'Fab');
        const weldRow = timelineRows.find(r => r.department === 'Weld');
        const assyRow = timelineRows.find(r => ['TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy', 'Assy'].includes(r.department));

        // Fetch status tracking row and historical cycle data
        const { statusRows, historyRows, error: suppErr } = await db.fetchCsSupplementalData(
            ref.wo_number,
            ref.part_number
        );
        if (suppErr) throw suppErr;

        const shippingRow = statusRows && statusRows[0] ? statusRows[0] : null;

        // Use historical avg if >= 3 data points, else default lead times
        const getEst = (dept) => {
            const h = getHistoricalAvgDays(historyRows, dept);
            return h !== null ? h : (CS_LEAD_TIME_DEFAULTS[dept] || 3);
        };

        // Build stage list based on which departments exist
        const stages = [];
        if (hasFab)           stages.push({ stage: 'Fabrication',       dept: 'Fab',      data: fabRow });
        if (hasWeld)          stages.push({ stage: 'Welding',            dept: 'Weld',     data: weldRow });
        if (hasFab || hasWeld) stages.push({ stage: 'Paint / Finish',    dept: 'Paint',    data: null,         isPaint: true });
        if (hasAssy)          stages.push({ stage: 'Assembly',           dept: 'Assy',     data: assyRow });
        stages.push(           { stage: 'Shipping / Office',             dept: 'Shipping', data: shippingRow,  isShipping: true });

        // Map stages to timeline steps with done/active status and est days
        let estDaysTotal = 0;
        store.csTimeline.value = stages.map(s => {
            let done   = false;
            let active = false;
            const estDays = getEst(s.dept);

            if (s.isPaint) {
                // Paint is done once assy has started (heuristic)
                done   = assyRow && ['started', 'paused', 'on_hold', 'completed'].includes(assyRow.status);
                active = !done && weldRow && weldRow.status === 'completed';
            } else if (s.isShipping) {
                done   = shippingRow && shippingRow.erp_status === 'closed';
                active = !!(shippingRow && shippingRow.erp_status === 'received');
            } else if (s.data) {
                done   = s.data.status === 'completed';
                active = !done && ['started', 'paused', 'on_hold', 'resumed'].includes(s.data.status);
            }

            // Done stages: 0 days remaining. Active: half estimate. Future: full estimate.
            const contribution = done ? 0 : active ? Math.ceil(estDays / 2) : estDays;
            estDaysTotal += contribution;
            return { ...s, done, active, estDays };
        });

        const allDone = store.csTimeline.value.every(s => s.done);
        store.csResultInfo.value = {
            wo_number:        ref.wo_number,
            part_number:      ref.part_number,
            description:      ref.description,
            sales_order:      ref.sales_order,
            qty_required:     ref.qty_required,
            due_date:         ref.due_date,
            estDaysRemaining: estDaysTotal,
            allDone
        };

    } catch (err) {
        store.showToast('Search failed: ' + err.message);
        logError('searchCS', err, { term: store.csSearchTerm.value });
        store.csResultInfo.value = { notFound: true };
    } finally {
        store.loading.value = false;
    }
}
