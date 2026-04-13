// ============================================================
// libs/config.js — App-wide constants and Supabase client
// No dependencies. Import this from any module.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "https://jxxumifkxhfoxgfsduns.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4eHVtaWZreGhmb3hnZnNkdW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1OTE0OTMsImV4cCI6MjA5MTE2NzQ5M30.bq-7ETLp1w1rBVM22LR8BamEfNyLRLrVYsxR8KHqkFE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ----- Auth PINs -----
// Future: move these to Supabase secrets or environment variables
export const MANAGER_PIN  = "1234";
export const CS_PIN       = "5678";
export const CLOSEOUT_PIN = "1234";   // Close-Out view PIN

// Gemini API calls go through a Cloudflare Worker so the key never touches the frontend.
// After deploying workers/gemini-proxy.js, replace this with your Worker URL.
export const GEMINI_WORKER_URL = 'https://gemini-proxy.YOUR_SUBDOMAIN.workers.dev';

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

// ----- Reel part numbers (trigger Weld/Grind selection) -----
export const REEL_PART_NUMBERS = [
    "TC27261", "TC27265", "TC27291", "TC27292", "TC27311",
    "TC42077", "TC42127", "TC44120", "TC44125", "TC44127",
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

// ----- Inventory tabs -----
export const INVENTORY_TABS = [
    { key: 'chute',    label: 'Chutes'   },
    { key: 'hitch',    label: 'Hitches'  },
    { key: 'engine',   label: 'Engines'  },
    { key: 'hardware', label: 'Hardware' },
    { key: 'hoses',    label: 'Hoses'    },
];

export const OPEN_ORDER_SORT_FIELDS = [
    { field: 'part_number',        label: 'Part #'   },
    { field: 'date_entered',       label: 'Date'     },
    { field: 'status',             label: 'Status'   },
    { field: 'sales_order',        label: 'Sales Ord'},
    { field: 'last_status_update', label: 'Last Upd' },
    { field: 'deadline',           label: 'Deadline' },
];
