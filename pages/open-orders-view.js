// ============================================================
// pages/open-orders-view.js — Open Orders (Shipping) view logic
//
// Handles: loading orders, per-section sort, row color changes,
//          Add Row modal (manual + paste), inline cell save.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { detectOpenOrderSection } from '../libs/utils.js';

// loadOpenOrders — fetch all open_orders rows into store.
export async function loadOpenOrders() {
    store.openOrdersLoading.value = true;
    try {
        const { data, error } = await db.fetchOpenOrders();
        if (error) throw error;
        store.openOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load open orders: ' + err.message);
    } finally {
        store.openOrdersLoading.value = false;
    }
}

// setSectionSort — toggle sort field/dir for one section.
// section: 'emergency'|'freight'|'trac_vac'|'tru_cut', field: column name string.
export function setSectionSort(section, field) {
    const cur = store.openOrdersSort.value[section];
    store.openOrdersSort.value = {
        ...store.openOrdersSort.value,
        [section]: {
            field,
            dir: cur.field === field && cur.dir === 'asc' ? 'desc' : 'asc',
        }
    };
}

// openOrderSortIcon — returns ↑, ↓, or ↕ for a given section + field.
export function openOrderSortIcon(section, field) {
    const cur = store.openOrdersSort.value[section];
    if (cur.field !== field) return '↕';
    return cur.dir === 'asc' ? '↑' : '↓';
}

// setRowColor — persist row_color to DB and update store in-place.
// color: 'orange'|'yellow'|'pink'|'blue'|null (null = clear).
export async function setRowColor(id, color) {
    store.openOrderColorPickerRow.value = null;
    const { error } = await db.updateOpenOrder(id, { row_color: color || null });
    if (error) { store.showToast('Failed to set color: ' + error.message); return; }
    const idx = store.openOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.openOrders.value];
        updated[idx]  = { ...updated[idx], row_color: color || null };
        store.openOrders.value = updated;
    }
}

// openOrderRowClass — Tailwind classes for row bg + left border.
// selected=true gives a white lifted card look with a dark border.
export function openOrderRowClass(color, selected = false) {
    if (selected) return 'bg-indigo-50 border-l-4 border-l-indigo-500 transition-colors cursor-grab';
    const map = {
        orange: 'bg-orange-50 border-l-4 border-l-orange-400',
        yellow: 'bg-yellow-50 border-l-4 border-l-yellow-400',
        pink:   'bg-pink-50   border-l-4 border-l-pink-400',
        blue:   'bg-blue-50   border-l-4 border-l-blue-400',
    };
    return (map[color] || 'bg-white border-l-4 border-l-slate-100') + ' transition-colors';
}

// openOrderColorDotClass — bg class for the color picker trigger dot.
export function openOrderColorDotClass(color) {
    const map = {
        orange: 'bg-orange-400',
        yellow: 'bg-yellow-400',
        pink:   'bg-pink-400',
        blue:   'bg-blue-400',
    };
    return map[color] || 'bg-slate-200';
}

// openOrderStatusClass — badge bg+text classes for a status value.
export function openOrderStatusClass(status) {
    const map = {
        'New/Picking':  'bg-blue-100   text-blue-800',
        'WO Requested': 'bg-purple-100 text-purple-800',
        'PO Requested': 'bg-violet-100 text-violet-800',
        'WO Created':   'bg-indigo-100 text-indigo-800',
        'PO Created':   'bg-indigo-100 text-indigo-800',
        'Boxed':        'bg-green-100  text-green-800',
        'Shipped':      'bg-teal-100   text-teal-800',
        'On Hold':      'bg-red-100    text-red-800',
    };
    return map[status] || 'bg-slate-100 text-slate-700';
}

// moveToSection — update order_type for a row in DB and store in-place.
// id: uuid, newType: 'emergency'|'freight'|'trac_vac'|'tru_cut'
export async function moveToSection(id, newType) {
    const { error } = await db.updateOpenOrder(id, { order_type: newType });
    if (error) { store.showToast('Failed to move row: ' + error.message); return; }
    const idx = store.openOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.openOrders.value];
        updated[idx] = { ...updated[idx], order_type: newType };
        store.openOrders.value = updated;
    }
}

// ── Paint-select + drag-to-section ───────────────────────────
// Module-level ephemeral drag state (not reactive — no UI needs to read these directly).
let _isPainting     = false;
let _pendingDragIds = [];

// Reorder drag state
let _reorderDragId = null;
let _dragType = 'section'; // 'section' | 'reorder'

// Edge-scroll state — rAF loop that scrolls the list container when dragging near top/bottom.
let _scrollRAF = null;
let _scrollDir = 0;   // -1 = up, 1 = down, 0 = stopped
let _scrollEl  = null;
const SCROLL_ZONE  = 100; // px from edge that triggers scroll
const SCROLL_SPEED = 6;   // px per frame (~360px/s at 60fps)

function _doScroll() {
    if (!_scrollEl || _scrollDir === 0) return;
    _scrollEl.scrollTop += _scrollDir * SCROLL_SPEED;
    _scrollRAF = requestAnimationFrame(_doScroll);
}

function _clearScroll() {
    _scrollDir = 0;
    _scrollEl  = null;
    if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
}

// onScrollAreaDragOver — attach to the scrollable container.
// Starts/stops the edge-scroll loop based on pointer proximity to top/bottom.
export function onScrollAreaDragOver(event) {
    const el   = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const y    = event.clientY;
    const newDir = y < rect.top + SCROLL_ZONE ? -1 : y > rect.bottom - SCROLL_ZONE ? 1 : 0;

    if (newDir !== _scrollDir) {
        _scrollDir = newDir;
        _scrollEl  = el;
        if (_scrollRAF) cancelAnimationFrame(_scrollRAF);
        _scrollRAF = newDir !== 0 ? requestAnimationFrame(_doScroll) : null;
    }
}

// onRowMouseDown — starts paint-select from this row.
// Skips if the click landed on an interactive control or an already-selected row.
export function onRowMouseDown(event, orderId) {
    if (event.target.closest('button, select, input, a')) return;
    if (store.openOrderSelectedIds.value.includes(orderId)) return;
    event.preventDefault(); // block browser text-selection drag
    _isPainting = true;
    store.openOrderSelectedIds.value = [orderId];
    const stop = () => {
        _isPainting = false;
        document.removeEventListener('mouseup', stop);
    };
    document.addEventListener('mouseup', stop);
}

// onRowMouseEnter — extends the paint selection as the pointer moves over rows.
export function onRowMouseEnter(orderId) {
    if (!_isPainting) return;
    if (!store.openOrderSelectedIds.value.includes(orderId)) {
        store.openOrderSelectedIds.value = [...store.openOrderSelectedIds.value, orderId];
    }
}

// onRowDragStart — captures which rows are being dragged.
// If the dragged row is selected, drag the whole selection; else drag just this row.
export function onRowDragStart(event, orderId) {
    _isPainting = false;
    const sel = store.openOrderSelectedIds.value;
    _pendingDragIds = sel.includes(orderId) ? [...sel] : [orderId];
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(_pendingDragIds.length));
}

// onRowDragEnd — clean up after a drag (whether dropped or cancelled).
export function onRowDragEnd() {
    _pendingDragIds = [];
    store.openOrderDragOverSection.value = '';
    _clearScroll();
}

// onGripDragStart — start a within-section reorder drag from the grip handle.
// stopPropagation prevents the parent row's onRowDragStart from also firing.
export function onGripDragStart(event, orderId) {
    _dragType = 'reorder';
    _reorderDragId = orderId;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', orderId);
}

// onGripDragEnd — clean up after a reorder drag finishes (drop or cancel).
export function onGripDragEnd() {
    _reorderDragId = null;
    _dragType = 'section';
    store.openOrderDropZoneTarget.value = '';
    _clearScroll();
}

// onDropZoneDragOver — activate a between-row drop zone during a reorder drag.
// key format: 'sectionType:index' where index is the position to insert before.
export function onDropZoneDragOver(event, sectionType, index) {
    if (_dragType !== 'reorder') return;
    event.preventDefault();
    event.stopPropagation();
    store.openOrderDropZoneTarget.value = sectionType + ':' + index;
}

// clearDropZone — deactivate the current drop zone highlight.
export function clearDropZone() {
    store.openOrderDropZoneTarget.value = '';
}

// reorderDrop — drop handler for between-row zones; reorders within the section.
// insertBeforeIndex is the position (0-based) in the section's sorted list.
export async function reorderDrop(event, sectionType, insertBeforeIndex) {
    event.preventDefault();
    event.stopPropagation();
    store.openOrderDropZoneTarget.value = '';
    if (!_reorderDragId || _dragType !== 'reorder') return;

    const id = _reorderDragId;
    _reorderDragId = null;
    _dragType = 'section';

    const sectionOrders = store.openOrders.value
        .filter(o => o.order_type === sectionType)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const fromIdx = sectionOrders.findIndex(o => o.id === id);
    if (fromIdx === -1) return;

    const reordered = [...sectionOrders];
    const [moved] = reordered.splice(fromIdx, 1);
    const insertIdx = insertBeforeIndex > fromIdx ? insertBeforeIndex - 1 : insertBeforeIndex;
    reordered.splice(insertIdx, 0, moved);

    const results = await Promise.all(
        reordered.map((o, i) => db.updateOpenOrder(o.id, { sort_order: (i + 1) * 10 }))
    );
    const failed = results.filter(r => r.error);
    if (failed.length) { store.showToast(`Failed to reorder ${failed.length} row(s)`); return; }

    store.openOrders.value = store.openOrders.value.map(o => {
        const ri = reordered.findIndex(r => r.id === o.id);
        return ri !== -1 ? { ...o, sort_order: (ri + 1) * 10 } : o;
    });
}

// onSectionDragOver — highlight the section header while dragging over it.
// Ignored during reorder drags (grip handle only targets drop zones, not section headers).
export function onSectionDragOver(event, type) {
    if (_dragType === 'reorder') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    store.openOrderDragOverSection.value = type;
}

// onSectionDragLeave — un-highlight when pointer leaves the section header.
export function onSectionDragLeave(event, type) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
        if (store.openOrderDragOverSection.value === type) store.openOrderDragOverSection.value = '';
    }
}

// onSectionDrop — move all pending drag rows to the dropped section in parallel.
export async function onSectionDrop(event, type) {
    event.preventDefault();
    store.openOrderDragOverSection.value = '';
    const ids = [..._pendingDragIds];
    _pendingDragIds = [];
    if (!ids.length) return;

    const results = await Promise.all(ids.map(id => db.updateOpenOrder(id, { order_type: type })));
    const failed  = results.filter(r => r.error);
    if (failed.length) { store.showToast(`Failed to move ${failed.length} row(s)`); }

    store.openOrders.value = store.openOrders.value.map(o =>
        ids.includes(o.id) ? { ...o, order_type: type } : o
    );
    store.openOrderSelectedIds.value = [];
}

// toggleOpenOrderExpand — toggle the expanded state of a stacked column (quotes or boxes) for one row.
// col: 'quotes' | 'boxes'
export function toggleOpenOrderExpand(id, col) {
    const cur = store.openOrderExpandedCols.value;
    store.openOrderExpandedCols.value = {
        ...cur,
        [id]: { ...(cur[id] || {}), [col]: !cur[id]?.[col] }
    };
}

// clearRowSelection — deselect all rows.
export function clearRowSelection() {
    store.openOrderSelectedIds.value = [];
}

// openOrderHasLine3 — true if this row has supplementary line-3 data.
// boxes/quotes/dims/boxer/picker/info_enterer now appear in the main grid.
export function openOrderHasLine3(order) {
    return !!(
        order.weight_lbs ||
        order.chute_status || order.bracket_adapter_status ||
        order.holding_bin_chute || order.holding_bin_status ||
        order.holding_bin_part  || order.override
    );
}

// ── Inline cell editing ───────────────────────────────────────

// startCellEdit — activate inline edit for one cell.
// id: row uuid, field: column name, value: current value to pre-fill.
export function startCellEdit(id, field, value) {
    store.openOrderEditingCell.value  = { id, field };
    store.openOrderEditingValue.value = value ?? '';
}

// cancelCellEdit — discard edit without saving.
export function cancelCellEdit() {
    store.openOrderEditingCell.value  = { id: null, field: null };
    store.openOrderEditingValue.value = '';
}

// saveCellEdit — persist the current draft value to DB and update store in-place.
// Clears edit state immediately for snappy UX; reloads on DB failure.
// Guard at top prevents double-save when blur fires after Enter (Vue unmounts input on next tick).
export async function saveCellEdit(id, field) {
    if (store.openOrderEditingCell.value.id !== id ||
        store.openOrderEditingCell.value.field !== field) return;
    const raw = store.openOrderEditingValue.value;

    // Coerce value to the correct type for this field
    let value;
    if (field === 'to_ship' || field === 'qty_pulled') {
        value = raw !== '' && raw !== null ? Number(raw) : null;
    } else if (field === 'part_number') {
        const trimmed = String(raw).trim().toUpperCase();
        if (!trimmed) { cancelCellEdit(); return; }  // required — don't save blank
        value = trimmed;
    } else {
        value = typeof raw === 'string' ? (raw.trim() || null) : (raw || null);
    }

    cancelCellEdit(); // clear immediately so the UI snaps back

    const updates = { [field]: value };
    if (field === 'status') updates.last_status_update = new Date().toISOString();

    const { error } = await db.updateOpenOrder(id, updates);
    if (error) { store.showToast('Failed to save: ' + error.message); await loadOpenOrders(); return; }

    const idx = store.openOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.openOrders.value];
        updated[idx]  = { ...updated[idx], ...updates };
        store.openOrders.value = updated;
    }
}

// deleteOpenOrder — confirm then permanently remove the row from DB and store.
// id: row uuid, partNumber: shown in the confirm dialog.
export async function deleteOpenOrder(id, partNumber) {
    if (!window.confirm(`Delete this row?\n\n${partNumber || 'Unknown part'}`)) return;
    const { error } = await db.deleteOpenOrder(id);
    if (error) { store.showToast('Failed to delete: ' + error.message); return; }
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
}

// ── Add Row(s) modal ──────────────────────────────────────────

// cancelAddModal — close the Add Row(s) modal and reset all draft state.
export function cancelAddModal() {
    store.openOrderAddModalOpen.value = false;
    store.openOrderAddMode.value = 'manual';
    store.openOrderAddPasteText.value = '';
    store.openOrderAddPasteRows.value = [];
    store.openOrderAddForm.value = {
        part_number: '', to_ship: '', qty_pulled: '', description: '',
        store_bin: '', update_store_bin: '', customer: '', sales_order: '',
        date_entered: '', deadline: '', status: 'New/Picking',
        wo_va_notes: '', wo_po_number: '',
    };
    store.openOrderAddFormErrors.value = {};
}

// parsePasteRows — parse tab-delimited text (pasted from Excel) into preview rows.
// Expected column order (11 cols):
//   [0] Part #  [1] To Ship  [2] Qty Pulled  [3] Description
//   [4] Store/Bin  [5] Update Store/Bin  [6] Customer
//   [7] Sales Order #  [8] Date Entered  [9] Status  [10] Notes
// Section is auto-detected from part # prefix (TC → tru_cut, else → trac_vac).
// Blank lines and obvious header rows are skipped.
export function parsePasteRows() {
    const text = store.openOrderAddPasteText.value || '';
    const rows = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const c = trimmed.split('\t');
        const partRaw = (c[0] || '').trim();
        if (!partRaw || partRaw.toLowerCase() === 'part #' || partRaw.toLowerCase() === 'part number') continue;
        const part = partRaw.toUpperCase();
        rows.push({
            part_number:      part,
            to_ship:          (c[1] || '').trim() || null,
            qty_pulled:       (c[2] || '').trim() || null,
            description:      (c[3] || '').trim() || null,
            store_bin:        (c[4] || '').trim() || null,
            update_store_bin: (c[5] || '').trim() || null,
            customer:         (c[6] || '').trim() || null,
            sales_order:      (c[7] || '').trim() || null,
            date_entered:     (c[8] || '').trim() || null,
            status:           (c[9] || '').trim() || 'New/Picking',
            wo_va_notes:      (c[10] || '').trim() || null,
            order_type:       detectOpenOrderSection(part),
        });
    }
    store.openOrderAddPasteRows.value = rows;
}

// saveOpenOrderRow — validate and persist the current draft (manual or paste).
// Section is auto-detected from part # prefix in both modes.
// On success: closes modal, resets state, reloads order list.
export async function saveOpenOrderRow() {
    const mode = store.openOrderAddMode.value;

    if (mode === 'manual') {
        const form = store.openOrderAddForm.value;
        const errors = {};
        if (!form.part_number.trim()) errors.part_number = true;
        store.openOrderAddFormErrors.value = errors;
        if (Object.keys(errors).length) return;

        const part = form.part_number.trim().toUpperCase();
        const row = {
            part_number:      part,
            description:      form.description.trim()      || null,
            customer:         form.customer.trim()          || null,
            sales_order:      form.sales_order.trim()       || null,
            wo_po_number:     form.wo_po_number.trim()      || null,
            to_ship:          form.to_ship    ? Number(form.to_ship)    : null,
            qty_pulled:       form.qty_pulled ? Number(form.qty_pulled) : null,
            date_entered:     form.date_entered  || new Date().toISOString().split('T')[0],
            deadline:         form.deadline      || null,
            store_bin:        form.store_bin.trim()         || null,
            update_store_bin: form.update_store_bin.trim()  || null,
            status:           form.status || 'New/Picking',
            wo_va_notes:      form.wo_va_notes.trim()       || null,
            order_type:       detectOpenOrderSection(part),
        };

        const { error } = await db.insertOpenOrders([row]);
        if (error) { store.showToast('Failed to add row: ' + error.message); return; }

    } else {
        // paste mode — rows already have order_type set by parsePasteRows
        const rows = store.openOrderAddPasteRows.value.map(r => ({
            part_number:      r.part_number      || null,
            to_ship:          r.to_ship    ? Number(r.to_ship)    : null,
            qty_pulled:       r.qty_pulled ? Number(r.qty_pulled) : null,
            description:      r.description      || null,
            store_bin:        r.store_bin         || null,
            update_store_bin: r.update_store_bin  || null,
            customer:         r.customer          || null,
            sales_order:      r.sales_order       || null,
            date_entered:     r.date_entered      || null,
            status:           r.status            || 'New/Picking',
            wo_va_notes:      r.wo_va_notes       || null,
            order_type:       r.order_type,
        }));
        if (!rows.length) return;

        const { error } = await db.insertOpenOrders(rows);
        if (error) { store.showToast('Failed to add rows: ' + error.message); return; }
    }

    cancelAddModal();
    await loadOpenOrders();
}
