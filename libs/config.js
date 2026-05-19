// ============================================================
// libs/config.js — App-wide constants and Supabase client
// No dependencies. Import this from any module.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "https://eqbybduwgzmbkbjyywgk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxYnliZHV3Z3ptYmtianl5d2drIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDMwNzksImV4cCI6MjA4Nzc3OTA3OX0.j77BJ8LlRzCinGOSHuiCRX1M7KO1A687o9yQGwNXh8M";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

// ----- Kiosk username → Supabase Auth email map -----
// Passwords are managed in Supabase Auth dashboard — never stored here.
export const KIOSK_USER_MAP = {
    fab:     'fabricationmidwest@gmail.com',
    weld:    'weldermidwest@gmail.com',
    assy:    'trucutassembly1@gmail.com',
    office:  'project@midmfg.com',
    manager: 'office@midmfg.com',
};

// Gemini API calls go through a Cloudflare Worker so the key never touches the frontend.
// After deploying workers/gemini-proxy.js, replace this with your Worker URL.
export const GEMINI_WORKER_URL = 'https://gemini-proxy.project-85a.workers.dev';

// ----- Operators per department -----
export const OPERATORS_BY_DEPT = {
    "Fab":           ["Jeff", "Greg"],
    "Weld":          ["Pete", "Tom J.", "Bryce"],
    "Trac Vac Assy": ["Art", "Dave", "Bryce", "Tim"],
    "Tru Cut Assy":  ["Art", "Dave", "Bryce", "Tim"]
};

// ----- Hold reasons per department (null = free-text) -----
export const HOLD_REASONS = {
    "Fab":           ["Material Shortage", "Machine/Tooling Problem", "Bent Wrong", "Cut Wrong", "Other"],
    "Weld":          ["Pulled off WO", "Missing Subparts", "Machine/Jig/Fixture Problem", "Weld Mistake", "Subpart not usable", "Other"],
    "Trac Vac Assy": null,
    "Tru Cut Assy":  null
};

// ----- Scrap reasons (shared across departments) -----
export const SCRAP_REASONS = [
    "Material Defect", "Operator Error", "Bad Weld / Cut",
    "Drawing / Dimension Issue", "Machine Failure",
    "Wrong Part / Setup Error", "Other"
];

// ----- Reel part numbers (dual Weld/Grind flow in Weld dept) -----
export const REEL_PART_NUMBERS = [
    "TC27261", "TC27265", "TC27291", "TC27292", "TC27311",
    "TC44120", "TC44125", "TC44127",
    "TC47446", "TC51070", "TC51077"
];

// ----- Department delay thresholds (days before flagged as delayed) -----
export const DELAY_THRESHOLDS = {
    "Fab":           5,
    "Weld":          10,
    "Trac Vac Assy": 5,
    "Tru Cut Assy":  5
};

// ----- CS default lead times per stage (business days) -----
export const CS_LEAD_TIME_DEFAULTS = {
    "Fab":      3,
    "Weld":     5,
    "Paint":    5,
    "Assy":     3,
    "Shipping": 2
};

// ----- Valid department names -----
export const DEPT_NAMES = ["Fab", "Weld", "Trac Vac Assy", "Tru Cut Assy", "WO Status", "CS"];

// ----- Open Orders -----
export const OPEN_ORDER_STATUSES = [
    'New/Picking', 'WO Requested', 'PO Requested',
    'WO Created', 'PO Created', 'Boxed', 'Shipped', 'On Hold'
];

export const CHUTE_PART_STATUSES = [
    'Ordered', 'In Stock', 'Ready', 'Complete', 'N/A'
];

// ----- Inventory tabs -----
export const INVENTORY_TABS = [
    { key: 'chute',    label: 'Chutes'   },
    { key: 'hitch',    label: 'Hitches'  },
    { key: 'engine',   label: 'Engines'  },
    { key: 'hardware', label: 'Hardware' },
    { key: 'hoses',    label: 'Hoses'    },
];

export const PURCHASING_STATUSES = [
    'requested',
    'needs_review',
    'approved',
    'quoted',
    'ordered',
    'partially_received',
    'received',
    'canceled',
];

export const PURCHASING_TYPES = [
    { value: 'part',   label: 'Part'   },
    { value: 'supply', label: 'Supply' },
    { value: 'steel',  label: 'Steel'  },
];

export const PURCHASING_STATUS_LABELS = {
    requested:          'Requested',
    needs_review:       'Needs Review',
    approved:           'Approved',
    quoted:             'Quoted — Needs Approval',
    ordered:            'Ordered',
    partially_received: 'Partially Received',
    received:           'Received',
    canceled:           'Canceled',
};

export const PURCHASING_STATUS_COLORS = {
    requested:          'bg-gray-100 text-gray-600',
    needs_review:       'bg-amber-100 text-amber-700',
    approved:           'bg-blue-100 text-blue-700',
    quoted:             'bg-purple-100 text-purple-700',
    ordered:            'bg-violet-100 text-violet-700',
    partially_received: 'bg-orange-100 text-orange-700',
    received:           'bg-emerald-100 text-emerald-700',
    canceled:           'bg-gray-100 text-gray-400',
};

export const PARTIAL_NAMES = [
    'header', 'main-open',
    'view-splash', 'view-dashboard', 'view-office',
    'view-manager-home', 'view-manager-kpi', 'view-manager-priorities',
    'view-manager-ai', 'view-manager-problems', 'view-manager-delayed',
    'view-cs', 'view-inventory', 'view-wo-request', 'view-wo-forecasting', 'view-create-wo', 'view-open-orders', 'view-completed-orders',
    'view-engineering-inquiries', 'view-engineering-followup', 'view-engineering-completed',
    'view-engineering-prints',
    'view-purchasing',
    'view-po-request',
    'modal-purchasing-detail',
    'modal-purchasing-quote',
    'main-close',
    'modal-pin', 'modal-action-panel',
    'modal-tc-unit', 'modal-tc-stock',
    'modal-tv-unit', 'modal-tv-stock',
    'modal-wo-request',
    'modal-misc', 'modal-open-orders-add',
    'modal-action-panel-print',
    'modal-eng-inquiry',
    'modal-eng-images',
    'modal-eng-create',
    'modal-eng-confirm',
    'modal-eng-followup'
];

export const OPEN_ORDER_SORT_FIELDS = [
    { field: 'part_number',        label: 'Part #'   },
    { field: 'date_entered',       label: 'Date'     },
    { field: 'status',             label: 'Status'   },
    { field: 'sales_order',        label: 'Sales Ord'},
    { field: 'last_status_update', label: 'Last Upd' },
    { field: 'deadline',           label: 'Deadline' },
];

export const ENG_STATUSES = [
    'Not Started',
    'In Progress',
    'Ready to Design',
    'Needs Measurements',
    'Design Complete / Ready to Order',
    'On Hold',
    'Done',
    'Canceled',
];

export const ENG_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

export const ENG_ASSIGNEES = ['CSR', 'Engineering', 'Customer'];

export const ENG_FOLLOWUP_STATUSES = [
    'new_intake',
    'waiting_to_ship',
    'waiting_for_customer_use',
    'follow_up_due',
    'waiting_on_customer',
    'needs_engineering_review',
    'fit_confirmed',
    'fit_failed',
    'finalization_needed',
    'closed',
];

export const ENG_FOLLOWUP_FIT_STATUSES = ['pending', 'confirmed', 'failed', 'unknown'];

export const ENG_FOLLOWUP_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const ENG_FOLLOWUP_STATUS_LABELS = {
    new_intake:               'New Intake',
    waiting_to_ship:          'Waiting to Ship',
    waiting_for_customer_use: 'Waiting for Customer Use',
    follow_up_due:            'Follow-Up Due',
    waiting_on_customer:      'Waiting on Customer',
    needs_engineering_review: 'Needs Eng Review',
    fit_confirmed:            'Fit Confirmed',
    fit_failed:               'Fit Failed',
    finalization_needed:      'Finalization Needed',
    closed:                   'Closed',
};

export const ENG_FOLLOWUP_STATUS_COLORS = {
    new_intake:               'bg-gray-100 text-gray-600',
    waiting_to_ship:          'bg-blue-100 text-blue-700',
    waiting_for_customer_use: 'bg-indigo-100 text-indigo-700',
    follow_up_due:            'bg-amber-100 text-amber-700',
    waiting_on_customer:      'bg-amber-100 text-amber-700',
    needs_engineering_review: 'bg-orange-100 text-orange-700',
    fit_confirmed:            'bg-emerald-100 text-emerald-700',
    fit_failed:               'bg-red-100 text-red-700',
    finalization_needed:      'bg-violet-100 text-violet-700',
    closed:                   'bg-gray-100 text-gray-500',
};

// ----- Post-paint staging areas -----
export const STAGING_AREAS = [
    'W1 Staging',
    'W2 Staging',
    'W3 Staging',
    'W4 Staging',
    'W5 Staging',
    'Shipping Staging',
];

// ----- WO Request BOM demand period (fixed; update here to change everywhere) -----
export const BOM_PERIOD_START = '2025-01-01';
export const BOM_PERIOD_END   = '2025-12-31';
