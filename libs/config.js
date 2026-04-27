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

export const PARTIAL_NAMES = [
    'header', 'main-open',
    'view-splash', 'view-dashboard', 'view-office',
    'view-manager-home', 'view-manager-kpi', 'view-manager-priorities',
    'view-manager-ai', 'view-manager-problems', 'view-manager-delayed',
    'view-cs', 'view-inventory', 'view-wo-request', 'view-wo-forecasting', 'view-create-wo', 'view-open-orders', 'view-completed-orders',
    'view-engineering-inquiries', 'view-engineering-followup', 'view-engineering-completed',
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
    'modal-eng-confirm'
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
