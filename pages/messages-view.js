// ============================================================
// pages/messages-view.js — Direct messaging business logic
//
// Handles: inbox load, thread open, send, poll, unread count.
// Imports from store, db-messages, config only.
// ============================================================

import { computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import * as store from '../libs/store.js';
import { fetchInbox, fetchThread, sendDm, markThreadRead, fetchUnreadCount } from '../libs/db-messages.js';
import { logError } from '../libs/db-shared.js';
import { ROLE_DISPLAY_NAMES } from '../libs/config.js';

let _pollInterval = null;

// dmContacts — all roles the current user can message (everyone except themselves).
export const dmContacts = computed(() =>
    Object.keys(ROLE_DISPLAY_NAMES).filter(r => r !== store.sessionRole.value)
);

// openMessagesView — navigate to messages, load inbox, start poll. Manager only.
export async function openMessagesView() {
    if (store.sessionRole.value !== 'manager') return;
    store.currentView.value  = 'messages';
    store.messagesView.value = 'inbox';
    store.activeThread.value = null;
    store.messageBody.value  = '';
    await _loadInbox();
    _startPoll();
}

// _loadInbox — fetches threads + merges with full contact list (shows all roles, even with no history).
async function _loadInbox() {
    const role = store.sessionRole.value;
    if (!role) return;
    store.messagesLoading.value = true;
    try {
        const threads = await fetchInbox(role);
        const threadMap = {};
        threads.forEach(t => { threadMap[t.other_role] = t; });
        // Always show all other roles, even those with no messages yet
        const all = Object.keys(ROLE_DISPLAY_NAMES)
            .filter(r => r !== role)
            .map(r => threadMap[r] || { other_role: r, body: null, created_at: null, unread_count: 0 });
        // Threads with messages float to top; new contacts fall to bottom
        all.sort((a, b) => {
            if (!a.created_at && !b.created_at) return 0;
            if (!a.created_at) return 1;
            if (!b.created_at) return -1;
            return new Date(b.created_at) - new Date(a.created_at);
        });
        store.messageThreads.value = all;
        store.dmUnreadCount.value  = all.reduce((s, t) => s + t.unread_count, 0);
    } catch (err) {
        store.showToast('Failed to load messages: ' + err.message);
        logError('_loadInbox', err);
    } finally {
        store.messagesLoading.value = false;
    }
}

// openThread — open a conversation with otherRole and mark messages read.
export async function openThread(otherRole) {
    const role = store.sessionRole.value;
    store.activeThread.value    = otherRole;
    store.messagesView.value    = 'thread';
    store.messageBody.value     = '';
    store.messagesLoading.value = true;
    try {
        store.threadMessages.value = await fetchThread(role, otherRole);
        await markThreadRead(role, otherRole);
        store.dmUnreadCount.value  = await fetchUnreadCount(role);
    } catch (err) {
        store.showToast('Failed to load conversation: ' + err.message);
        logError('openThread', err);
    } finally {
        store.messagesLoading.value = false;
    }
}

// backToInbox — deselect active thread, return right panel to inbox.
export function backToInbox() {
    store.messagesView.value = 'inbox';
    store.activeThread.value = null;
    store.messageBody.value  = '';
}

// sendMessage — validates, sends DM, appends locally on success.
export async function sendMessage() {
    const body  = store.messageBody.value.trim();
    const role  = store.sessionRole.value;
    const other = store.activeThread.value;
    if (!body || !role || !other) return;
    store.messagesSending.value = true;
    try {
        const { data, error } = await sendDm(role, other, body);
        if (error) throw error;
        store.messageBody.value    = '';
        if (data) store.threadMessages.value = [...store.threadMessages.value, data];
    } catch (err) {
        store.showToast('Failed to send message: ' + err.message);
        logError('sendMessage', err);
    } finally {
        store.messagesSending.value = false;
    }
}

// refreshUnreadCount — update badge count silently (called after login + by poll).
export async function refreshUnreadCount() {
    const role = store.sessionRole.value;
    if (!role) return;
    store.dmUnreadCount.value = await fetchUnreadCount(role);
}

// _poll — silently refresh current messages view.
async function _poll() {
    const role = store.sessionRole.value;
    if (!role) return;
    if (store.messagesView.value === 'thread' && store.activeThread.value) {
        store.threadMessages.value = await fetchThread(role, store.activeThread.value);
    } else {
        await _loadInbox();
    }
    store.dmUnreadCount.value = await fetchUnreadCount(role);
}

function _startPoll() {
    stopMessagesPoll();
    _pollInterval = setInterval(_poll, 12_000);
}

// stopMessagesPoll — called by main.js when navigating away from messages.
export function stopMessagesPoll() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

// dmAvatarClass — returns Tailwind bg+text classes for a role's avatar circle.
// Input: role string. Output: class string.
const _AVATAR_COLORS = {
    fab:     'bg-orange-700 text-orange-100',
    weld:    'bg-blue-700 text-blue-100',
    assy:    'bg-emerald-700 text-emerald-100',
    office:  'bg-violet-700 text-violet-100',
    manager: 'bg-amber-700 text-amber-100',
};
export function dmAvatarClass(role) {
    return _AVATAR_COLORS[role] || 'bg-slate-700 text-slate-100';
}

// ── New-message alert: beep loop ──────────────────────────────
let _audioCtx      = null;
let _cycleInterval = null;  // fires a 5s burst every 15s
let _burstInterval = null;  // individual beeps within a burst
let _burstTimeout  = null;  // stops the burst after 5s

// resumeAudio — unlock/resume the AudioContext after a user gesture (login click).
// Browsers block audio until the page has had an interaction.
export function resumeAudio() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (_audioCtx.state === 'suspended') _audioCtx.resume();
    } catch { /* audio unavailable — ignore */ }
}

// playBeep — emit one short attention beep via Web Audio (no sound file needed).
export function playBeep() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (_audioCtx.state === 'suspended') _audioCtx.resume();
        const now  = _audioCtx.currentTime;
        const osc  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        osc.connect(gain).connect(_audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.42);
    } catch { /* audio unavailable — ignore */ }
}

// _playBurst — beep repeatedly for 5 seconds (≈0.6s apart), then fall silent.
function _playBurst() {
    if (_burstInterval) clearInterval(_burstInterval);
    if (_burstTimeout)  clearTimeout(_burstTimeout);
    playBeep();
    _burstInterval = setInterval(playBeep, 600);
    _burstTimeout  = setTimeout(() => {
        if (_burstInterval) { clearInterval(_burstInterval); _burstInterval = null; }
    }, 5_000);
}

// startMessageAlert — burst now, then a fresh 5s burst every 15s. Idempotent.
export function startMessageAlert() {
    if (_cycleInterval) return;
    _playBurst();
    _cycleInterval = setInterval(_playBurst, 15_000);
}

// stopMessageAlert — silence everything (called when unread count hits zero).
export function stopMessageAlert() {
    if (_cycleInterval) { clearInterval(_cycleInterval); _cycleInterval = null; }
    if (_burstInterval) { clearInterval(_burstInterval); _burstInterval = null; }
    if (_burstTimeout)  { clearTimeout(_burstTimeout);   _burstTimeout  = null; }
}
