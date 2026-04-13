// ============================================================
// pages/manager-view.js — Manager Hub: KPIs, priorities, delays
//
// Handles: KPI data loading, delayed order detection,
//          per-department priority management
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { DELAY_THRESHOLDS, GEMINI_WORKER_URL } from '../libs/config.js';
import { daysAgo, daysBetween, extractHoldReasons, getHistoricalAvgDays } from '../libs/utils.js';

// ── openManagerSection ────────────────────────────────────────
// Navigate to a sub-section and auto-load its data
export async function openManagerSection(section) {
    store.managerSubView.value = section;
    if (section === 'priorities') store.priorityDept.value = '';  // reset so dept picker shows
    if (section === 'kpi')        await loadKpiData();
    if (section === 'delayed')    await loadDelayedOrders();
    if (section === 'problems')   await loadWoProblems();
}

// ── loadKpiData ───────────────────────────────────────────────
export async function loadManagerAlerts() {
    try {
        const result = await db.fetchManagerAlerts();
        if (result.error) throw result.error;
        store.managerAlerts.value = {
            completedNotReceived: result.completedNotReceived,
            pausedOnHold:         result.pausedOnHold,
            startedNoProgress:    result.startedNoProgress,
            qtyMismatch:          result.qtyMismatch
        };
        // Populate delayedOrders using the same source as the Delayed WOs tab
        // so the badge count always matches what the tab shows
        const { data: delayedData } = await db.fetchDelayedOrders();
        const now = new Date();
        store.delayedOrders.value = (delayedData || [])
            .map(o => {
                const ref    = o.start_date || o.created_at;
                const daysIn = ref ? Math.floor(daysBetween(new Date(ref), now)) : 0;
                return { ...o, daysIn };
            })
            .filter(o => o.daysIn > (DELAY_THRESHOLDS[o.department] || 7))
            .sort((a, b) => b.daysIn - a.daysIn);
    } catch (err) {
        store.showToast('Failed to load manager alerts: ' + err.message);
    }
    // Refresh WO problems badge count alongside alerts
    loadWoProblems();
}

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

        // ── Time report (async, non-blocking) ────────────────
        loadTimeReport();

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

// ── handleAssignChange ────────────────────────────────────────
// Called when the "Assign to" select changes. If "other" is chosen,
// activates inline text input for that WO; otherwise saves immediately.
export function handleAssignChange(id, value, currentOperator) {
    if (value === '__other__') {
        // Pre-populate with existing custom name if the current value isn't in the list
        store.assignCustomInput.value = { id, text: currentOperator || '' };
    } else {
        store.assignCustomInput.value = { id: null, text: '' };
        updateAssignedOperator(id, value);
    }
}

// ── submitCustomAssign ────────────────────────────────────────
// Saves the typed custom operator name and dismisses the inline input.
export function submitCustomAssign(id) {
    const text = store.assignCustomInput.value.text.trim();
    store.assignCustomInput.value = { id: null, text: '' };
    if (text) updateAssignedOperator(id, text);
}

// ── cancelCustomAssign ────────────────────────────────────────
// Dismisses the inline input without saving.
export function cancelCustomAssign() {
    store.assignCustomInput.value = { id: null, text: '' };
}

// ── updateAssignedOperator ────────────────────────────────────
// Assign (or unassign) an operator to a WO from the Priorities view.
// Optimistic UI update — rolls back on failure.
export async function updateAssignedOperator(id, operatorName) {
    const idx = store.priorityOrders.value.findIndex(o => o.id === id);
    const prev = idx !== -1 ? store.priorityOrders.value[idx].assigned_operator : null;
    if (idx !== -1) store.priorityOrders.value[idx].assigned_operator = operatorName || null;

    try {
        const { error } = await db.setAssignedOperator(id, operatorName);
        if (error) throw error;
    } catch (err) {
        if (idx !== -1) store.priorityOrders.value[idx].assigned_operator = prev;
        store.showToast('Failed to assign operator: ' + err.message);
    }
}

// ── openNotesPanel ────────────────────────────────────────────
// Open the notes panel for a WO from manager view (priorities or delayed)
export function openNotesPanel(order) {
    store.activeOrder.value = order;
    store.noteAuthor.value = '';
    store.noteText.value = '';
    store.noteAuthorError.value = false;
    store.noteTextError.value = false;
    store.notesPanelOpen.value = true;
}

// ── openDelayedWoDetail / closeDelayedWoDetail ───────────────
// Open the full history modal for a delayed WO.
export function openDelayedWoDetail(order) {
    store.delayedWoDetail.value     = order;
    store.delayedWoDetailOpen.value = true;
}
export function closeDelayedWoDetail() {
    store.delayedWoDetailOpen.value = false;
    store.delayedWoDetail.value     = null;
}

// ── loadWoProblems ────────────────────────────────────────────
// Fetch all open WO problems and store in woProblems ref.
export async function loadWoProblems() {
    try {
        const { data, error } = await db.fetchWoProblems();
        if (error) throw error;
        store.woProblems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load WO problems: ' + err.message);
    }
}

// ── openWoProblemModal ────────────────────────────────────────
// Open the resolve modal for a specific WO problem.
export function openWoProblemModal(problem) {
    store.woProblemTarget.value             = problem;
    store.woProblemResolution.value         = '';
    store.woProblemResolutionError.value    = false;
    store.woProblemResolverName.value       = '';
    store.woProblemResolverNameError.value  = false;
    store.woProblemModalOpen.value          = true;
}

// ── closeWoProblemModal ───────────────────────────────────────
export function closeWoProblemModal() {
    store.woProblemModalOpen.value = false;
    store.woProblemTarget.value    = null;
}

// ── confirmResolveWoProblem ───────────────────────────────────
// Validate inputs, write to DB, remove from list, close modal.
export async function confirmResolveWoProblem() {
    let valid = true;
    if (!store.woProblemResolution.value.trim()) {
        store.woProblemResolutionError.value = true;
        valid = false;
    }
    if (!store.woProblemResolverName.value.trim()) {
        store.woProblemResolverNameError.value = true;
        valid = false;
    }
    if (!valid) return;

    const target = store.woProblemTarget.value;
    try {
        const { error } = await db.resolveWoProblem(
            target.id,
            store.woProblemResolution.value,
            store.woProblemResolverName.value
        );
        if (error) throw error;
        store.woProblems.value = store.woProblems.value.filter(p => p.id !== target.id);
        closeWoProblemModal();
        store.showToast('WO problem marked resolved.', 'success');
    } catch (err) {
        store.showToast('Failed to resolve problem: ' + err.message);
    }
}

// ── loadTimeReport ────────────────────────────────────────────
// Fetches wo_time_sessions for the selected date range and stores raw rows.
// Computed groupings (by WO, by Part) are derived in store.js.
export async function loadTimeReport() {
    // Initialise date range to last 30 days on first load
    if (!store.timeReportFrom.value) {
        const to   = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 30);
        store.timeReportTo.value   = to.toISOString().slice(0, 10);
        store.timeReportFrom.value = from.toISOString().slice(0, 10);
    }
    try {
        const from = store.timeReportFrom.value + 'T00:00:00.000Z';
        const to   = store.timeReportTo.value   + 'T23:59:59.999Z';
        const { data, error } = await db.fetchTimeReportSessions(from, to);
        if (error) throw error;
        store.timeReportSessions.value = data || [];
    } catch (err) {
        store.showToast('Failed to load time report: ' + err.message);
    }
}

// ── sendAiMessage ─────────────────────────────────────────────
// Fetches live WO data, builds a system prompt, and calls the Gemini API.
// Full chat history is passed so Gemini can handle follow-up questions.
export async function sendAiMessage() {
    const text = store.aiChatInput.value.trim();
    if (!text || store.aiChatLoading.value) return;

    store.aiChatMessages.value = [...store.aiChatMessages.value, { role: 'user', text }];
    store.aiChatInput.value    = '';
    store.aiChatLoading.value  = true;

    try {
        const { active, completed, todayStart, error } = await db.fetchAiContextData();
        if (error) throw error;

        // Build Gemini conversation contents from history (exclude just-added user msg at end)
        const history = store.aiChatMessages.value.slice(0, -1).map(m => ({
            role:  m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.text }]
        }));
        const contents = [...history, { role: 'user', parts: [{ text }] }];

        const res = await fetch(GEMINI_WORKER_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: buildSystemPrompt(active, completed, todayStart) }] },
                contents,
                generationConfig: { maxOutputTokens: 600, temperature: 0.2 }
            })
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error?.message || `Gemini API error ${res.status}`);
        }

        const data  = await res.json();
        // Filter out thought parts (Gemma 4 thinking model returns internal reasoning separately)
        const parts = data.candidates?.[0]?.content?.parts || [];
        const responseText = parts
            .filter(p => !p.thought)
            .map(p => p.text || '')
            .join('')
            .trim() || 'Sorry, I could not generate a response.';

        store.aiChatMessages.value = [...store.aiChatMessages.value, { role: 'assistant', text: responseText }];
    } catch (err) {
        store.aiChatMessages.value = [...store.aiChatMessages.value, { role: 'assistant', text: `Sorry, something went wrong: ${err.message}` }];
    } finally {
        store.aiChatLoading.value = false;
    }
}

// ── buildSystemPrompt ─────────────────────────────────────────
// Formats live WO data into a Gemini system prompt.
// Keeps responses grounded — Gemini only sees real data, no hallucination.
function buildSystemPrompt(active, completed, todayStart) {
    const now        = new Date();
    const todayComp  = completed.filter(o => o.comp_date && new Date(o.comp_date) >= todayStart);

    const fmtActive = active.map(o => {
        const daysIn = o.start_date
            ? Math.floor(daysBetween(new Date(o.start_date), now))
            : null;
        return [
            `WO ${o.wo_number}`,
            `part=${o.part_number}`,
            `dept=${o.department}`,
            `status=${o.status}`,
            `operator=${o.operator || 'unassigned'}`,
            `qty=${o.qty_completed || 0}/${o.qty_required}`,
            daysIn !== null ? `days_in_dept=${daysIn}` : null
        ].filter(Boolean).join(' | ');
    }).join('\n');

    const fmtCompleted = completed.map(o =>
        `WO ${o.wo_number} | part=${o.part_number} | dept=${o.department} | operator=${o.operator || 'unknown'} | qty=${o.qty_completed || 0} | comp=${new Date(o.comp_date).toLocaleDateString()}`
    ).join('\n');

    return `You are a concise shop floor production assistant for a manufacturing company. Answer questions using ONLY the data below — do not guess or make up WO numbers, parts, or operators.

Today: ${now.toLocaleDateString()}
Active WOs: ${active.length} (${active.filter(o => o.status === 'started').length} started, ${active.filter(o => ['on_hold','paused'].includes(o.status)).length} on hold/paused, ${active.filter(o => o.status === 'not_started').length} not started)
Completed this week: ${completed.length} | Completed today: ${todayComp.length}
Delay thresholds: Fab >5 days, Weld >10 days, Trac Vac Assy >5 days, Tru Cut Assy >5 days

ACTIVE WORK ORDERS:
${fmtActive || 'None'}

COMPLETED THIS WEEK:
${fmtCompleted || 'None'}

Rules:
- Be brief and direct — this is a kiosk display
- Use line breaks to separate list items
- Only answer production-related questions
- If asked about something outside this data, say so clearly`;
}
