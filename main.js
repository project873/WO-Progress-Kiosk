// ============================================================
// main.js — Entry point. Startup, lifecycle wiring only.
//
// Template bindings live in expose-core.js + expose-ops.js.
// No business logic here.
// ============================================================

import {
    createApp,
    nextTick,
    onMounted,
    onUnmounted,
    watch
} from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

import * as store from './libs/store.js';
import { PARTIAL_NAMES } from './libs/config.js';
import { fetchAppPins } from './libs/db-shared.js';
import { setPins } from './libs/pins.js';
import { checkConnectivity, supabase } from './libs/db.js';
import { loadHeaderLinks, loadSplashLinks } from './pages/splash-view.js';
import { loadManagerAlerts } from './pages/manager-view.js';
import { loadReceivingEligible } from './pages/wo-status-view.js';
import { loadInventoryItems } from './pages/inventory-view.js';
import { loadWoRequests } from './pages/wo-request-view.js';
import { loadForecastedItems } from './pages/wo-forecasting-view.js';
import { loadCreateWoItems } from './pages/create-wo-view.js';
import { loadOpenOrders, loadReminderEmail } from './pages/open-orders-view.js';
import { loadCompletedOrders } from './pages/completed-orders-view.js';

import { buildCoreExpose } from './expose-core.js';
import { buildOpsExpose } from './expose-ops.js';

// ── Load HTML partials into #app before Vue mounts ───────────
async function loadPartials() {
    const chunks = await Promise.all(
        PARTIAL_NAMES.map(n => fetch(`./partials/${n}.html`).then(r => r.text()))
    );
    document.getElementById('app').innerHTML = chunks.join('\n');
}
const [, pinsMap] = await Promise.all([loadPartials(), fetchAppPins()]);
setPins(pinsMap);
await Promise.all([loadHeaderLinks(), loadSplashLinks()]);

const loadingEl = document.getElementById('app-loading');

// ── Vue App ───────────────────────────────────────────────────
try {
    const app = createApp({
        setup() {
            // Clock: update every second
            const clockInterval = setInterval(() => {
                store.currentTime.value = new Date().toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                });
            }, 1000);
            onUnmounted(() => clearInterval(clockInterval));

            // Offline detection
            async function probeConnectivity() {
                store.isOffline.value = !(await checkConnectivity());
            }
            const onOfflineEvent = () => { store.isOffline.value = true; };
            window.addEventListener('offline', onOfflineEvent);
            window.addEventListener('online',  probeConnectivity);
            const connectivityInterval = setInterval(probeConnectivity, 30_000);
            onUnmounted(() => {
                clearInterval(connectivityInterval);
                window.removeEventListener('offline', onOfflineEvent);
                window.removeEventListener('online',  probeConnectivity);
            });

            onMounted(async () => {
                probeConnectivity();
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    const role = session.user.app_metadata?.role || null;
                    if (role) {
                        store.sessionRole.value = role;
                        store.currentView.value = 'splash';
                        loadManagerAlerts();
                    }
                }
                await nextTick();
                if (loadingEl) loadingEl.remove();
            });

            // Load data on view entry
            watch(store.currentView, (v) => {
                if (v !== 'dashboard') store.showingCompletedDept.value = false;
                if (v !== 'wo_status') store.closeoutAuthorized.value = false;
                if (v === 'wo_status')       loadReceivingEligible();
                if (v === 'manager')         loadManagerAlerts();
                if (v === 'inventory')       loadInventoryItems();
                if (v === 'wo_request')      loadWoRequests();
                if (v === 'wo_forecasting')  loadForecastedItems();
                if (v === 'create_wo')       loadCreateWoItems();
                if (v === 'open_orders')     { loadOpenOrders(); loadReminderEmail(); }
                if (v === 'completed_orders') loadCompletedOrders();
            });
            watch(store.managerSubView, (v) => {
                if (v === 'home' && store.currentView.value === 'manager') loadManagerAlerts();
            });

            return { ...buildCoreExpose(), ...buildOpsExpose() };
        }
    });

    app.config.errorHandler = (err, vm, info) => {
        console.error('[Vue Error]', info, err);
        store.showToast('Something went wrong. Please try again.', 'error');
    };

    app.mount('#app');

} catch (err) {
    console.error('[Mount Error]', err);
    if (loadingEl) {
        loadingEl.innerHTML = `
            <div style="text-align:center;padding:2rem;">
                <h2 style="font-size:2rem;font-weight:bold;color:#ef4444;margin-bottom:1rem;">App Failed to Load</h2>
                <p style="color:#94a3b8;margin-bottom:0.5rem;">${err.message}</p>
                <button onclick="location.reload()"
                    style="background:#2563eb;color:white;padding:0.75rem 2rem;border-radius:0.5rem;
                           font-weight:bold;border:none;cursor:pointer;font-size:1.125rem;margin-top:1rem;">
                    Reload Page
                </button>
            </div>`;
    }
}
