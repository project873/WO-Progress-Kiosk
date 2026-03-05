// ============================================================
// pages/manager-view.js — Manager Hub: KPIs, priorities, delays
//
// Handles: KPI data loading, delayed order detection,
//          per-department priority management
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { DELAY_THRESHOLDS } from '../libs/config.js';
import { daysAgo, daysBetween, extractHoldReasons, getHistoricalAvgDays } from '../libs/utils.js';

// ── openManagerSection ────────────────────────────────────────
// Navigate to a sub-section and auto-load its data
export async function openManagerSection(section) {
    store.managerSubView.value = section;
    if (section === 'kpi')      await loadKpiData();
    if (section === 'delayed')  await loadDelayedOrders();
}

// ── loadKpiData ───────────────────────────────────────────────
export async function loadKpiData() {
    store.loading.value = true;
    try {
        const { completed, active, weekStart, sevenDaysAgo, error } = await db.fetchKpiData();
        if (error) throw error;

        const now = new Date();

        // ── Top stat cards ────────────────────────────────────
        const completedThisWeek = completed.filter(o =>
            o.comp_date && new Date(o.comp_date) >= weekStart
        ).length;

        const activeJobs  = active.filter(o => o.status === 'started').length;
        const onHoldCount = active.filter(o => o.status === 'on_hold').length;

        const delayedCount = active.filter(o => {
            const ref  = o.start_date || o.created_at;
            if (!ref) return false;
            const days = daysBetween(new Date(ref), now);
            return days > (DELAY_THRESHOLDS[o.department] || 7);
        }).length;

        store.kpiStats.value = { completedThisWeek, activeJobs, onHoldCount, delayedCount };

        // ── Operator output (last 30 days) ────────────────────
        const opMap = {};
        completed.forEach(o => {
            if (!o.operator) return;
            opMap[o.operator] = (opMap[o.operator] || 0) + 1;
        });
        const maxOp = Math.max(1, ...Object.values(opMap));
        store.kpiByOperator.value = Object.entries(opMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, count]) => ({
                name,
                count,
                pct: Math.round(count / maxOp * 100)
            }));

        // ── Cycle time by dept (last 7 days) ──────────────────
        const recentComp = completed.filter(o =>
            o.comp_date && new Date(o.comp_date) >= sevenDaysAgo && o.start_date
        );
        const deptTimes = {};
        recentComp.forEach(o => {
            const days = daysBetween(new Date(o.start_date), new Date(o.comp_date));
            if (!deptTimes[o.department]) deptTimes[o.department] = [];
            deptTimes[o.department].push(days);
        });
        store.kpiCycleTime.value = Object.entries(deptTimes)
            .map(([dept, times]) => ({
                dept,
                avgDays: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)
            }))
            .sort((a, b) => b.avgDays - a.avgDays);

        // ── Hold reasons from notes ────────────────────────────
        const reasonMap = {};
        active.filter(o => o.status === 'on_hold' && o.notes).forEach(o => {
            extractHoldReasons(o.notes).forEach(r => {
                reasonMap[r] = (reasonMap[r] || 0) + 1;
            });
        });
        store.kpiHoldReasons.value = Object.entries(reasonMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([reason, count]) => ({ reason, count }));

        // ── Oldest 5 open WOs ─────────────────────────────────
        store.kpiOldestWos.value = active
            .filter(o => o.created_at)
            .map(o => ({
                ...o,
                daysOpen: Math.floor(daysBetween(new Date(o.created_at), now))
            }))
            .sort((a, b) => b.daysOpen - a.daysOpen)
            .slice(0, 5);

    } catch (err) {
        store.showToast('Failed to load KPI data: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── loadDelayedOrders ─────────────────────────────────────────
export async function loadDelayedOrders() {
    store.loading.value = true;
    try {
        const { data, error } = await db.fetchDelayedOrders();
        if (error) throw error;

        const now = new Date();
        store.delayedOrders.value = (data || [])
            .map(o => {
                const ref   = o.start_date || o.created_at;
                const daysIn = ref ? Math.floor(daysBetween(new Date(ref), now)) : 0;
                return { ...o, daysIn };
            })
            .filter(o => o.daysIn > (DELAY_THRESHOLDS[o.department] || 7))
            .sort((a, b) => b.daysIn - a.daysIn);
    } catch (err) {
        store.showToast('Failed to load delayed orders: ' + err.message);
        store.delayedOrders.value = [];
    } finally {
        store.loading.value = false;
    }
}

// ── fetchPriorityOrders ───────────────────────────────────────
export async function fetchPriorityOrders(dept) {
    store.priorityDept.value = dept;
    store.loading.value      = true;
    try {
        const { data, error } = await db.fetchPriorityOrdersForDept(dept);
        if (error) throw error;
        store.priorityOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load priority orders: ' + err.message);
        store.priorityOrders.value = [];
    } finally {
        store.loading.value = false;
    }
}

// ── updatePriority ────────────────────────────────────────────
// Set priority (0-5) on a work order. Optimistic UI update.
export async function updatePriority(id, val) {
    // Optimistic: update local state first
    const idx = store.priorityOrders.value.findIndex(o => o.id === id);
    const prevPriority = idx !== -1 ? store.priorityOrders.value[idx].priority : null;

    if (idx !== -1) {
        store.priorityOrders.value[idx].priority = val;
        // Re-sort so highest priority floats to top
        store.priorityOrders.value = [...store.priorityOrders.value]
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    try {
        const { error } = await db.setWorkOrderPriority(id, val);
        if (error) throw error;
    } catch (err) {
        // Roll back optimistic update on failure
        if (idx !== -1 && prevPriority !== null) {
            store.priorityOrders.value[idx].priority = prevPriority;
        }
        store.showToast('Failed to update priority: ' + err.message);
    }
}
