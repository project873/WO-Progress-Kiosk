// ============================================================
// libs/db-engineering.js — Engineering inquiry DB operations
//
// All eng_inquiries CRUD + eng-inquiry-images storage.
// Imported and re-exported by db.js.
// ============================================================

import { supabase } from './db-shared.js';

const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

// fetchEngInquiries — all rows, sorted by priority then created_at desc.
// Returns { data, error }
export async function fetchEngInquiries() {
    const { data, error } = await supabase
        .from('eng_inquiries')
        .select('*')
        .order('created_at', { ascending: false });
    if (error || !data) return { data: [], error };
    data.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99;
        const pb = PRIORITY_ORDER[b.priority] ?? 99;
        return pa !== pb ? pa - pb : new Date(b.created_at) - new Date(a.created_at);
    });
    return { data, error: null };
}

// insertEngInquiry — insert a new row, returns the created record.
// Returns { data, error }
export async function insertEngInquiry(fields) {
    const { data, error } = await supabase
        .from('eng_inquiries')
        .insert({ ...fields, updated_at: new Date().toISOString() })
        .select()
        .single();
    return { data, error };
}

// updateEngInquiry — patch any subset of fields on an existing row.
// Returns { data, error }
export async function updateEngInquiry(id, fields) {
    const { data, error } = await supabase
        .from('eng_inquiries')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// fetchEngCompletedInquiries — archived rows, newest first, optional archived_at date range.
// Returns { data, error }
export async function fetchEngCompletedInquiries(fromDate, toDate) {
    let q = supabase
        .from('eng_inquiries_completed')
        .select('*')
        .order('archived_at', { ascending: false });
    if (fromDate) q = q.gte('archived_at', fromDate);
    if (toDate)   q = q.lte('archived_at', toDate + 'T23:59:59');
    const { data, error } = await q;
    return { data: data || [], error };
}

// restoreEngInquiry — move a completed row back to eng_inquiries with status 'In Progress'.
// Uses original_id as the restored row's id so storage image paths remain valid.
// Returns { error }
export async function restoreEngInquiry(inq) {
    const { error: insertErr } = await supabase
        .from('eng_inquiries')
        .insert({
            id:                      inq.original_id || undefined,
            inquiry_type:            inq.inquiry_type            || null,
            wrong_numbers:           inq.wrong_numbers           || null,
            part_number_trying:      inq.part_number_trying      || null,
            correct_part_number:     inq.correct_part_number     || null,
            date_entered:            inq.date_entered            || null,
            csr_rep:                 inq.csr_rep                 || null,
            deck_model_number:       inq.deck_model_number       || null,
            brand:                   inq.brand                   || null,
            deck_model:              inq.deck_model              || null,
            deck_width:              inq.deck_width              || null,
            year:                    inq.year                    || null,
            mower_model:             inq.mower_model             || null,
            hose_size:               inq.hose_size               || null,
            trac_vac_trailer_model:  inq.trac_vac_trailer_model  || null,
            customer_name:           inq.customer_name           || null,
            customer_phone:          inq.customer_phone          || null,
            customer_email:          inq.customer_email          || null,
            sales_order_number:      inq.sales_order_number      || null,
            csr_notes:               inq.csr_notes               || null,
            engineering_notes:       inq.engineering_notes       || null,
            current_action_step:     inq.current_action_step     || null,
            action_step_due_date:    inq.action_step_due_date    || null,
            status:                  'In Progress',
            assigned_to:             inq.assigned_to             || null,
            priority:                inq.priority                || null,
            created_at:              inq.created_at              || null,
            updated_at:              new Date().toISOString(),
        });
    if (insertErr) return { error: insertErr };
    const { error: deleteErr } = await supabase
        .from('eng_inquiries_completed')
        .delete()
        .eq('id', inq.id);
    return { error: deleteErr };
}

// archiveEngInquiry — copy a row to eng_inquiries_completed then delete from eng_inquiries.
// Returns { error }
export async function archiveEngInquiry(inq) {
    const { error: insertErr } = await supabase
        .from('eng_inquiries_completed')
        .insert({
            original_id:             inq.id,
            archived_at:             new Date().toISOString(),
            inquiry_type:            inq.inquiry_type            || null,
            wrong_numbers:           inq.wrong_numbers           || null,
            part_number_trying:      inq.part_number_trying      || null,
            correct_part_number:     inq.correct_part_number     || null,
            date_entered:            inq.date_entered            || null,
            csr_rep:                 inq.csr_rep                 || null,
            deck_model_number:       inq.deck_model_number       || null,
            brand:                   inq.brand                   || null,
            deck_model:              inq.deck_model              || null,
            deck_width:              inq.deck_width              || null,
            year:                    inq.year                    || null,
            mower_model:             inq.mower_model             || null,
            hose_size:               inq.hose_size               || null,
            trac_vac_trailer_model:  inq.trac_vac_trailer_model  || null,
            customer_name:           inq.customer_name           || null,
            customer_phone:          inq.customer_phone          || null,
            customer_email:          inq.customer_email          || null,
            sales_order_number:      inq.sales_order_number      || null,
            csr_notes:               inq.csr_notes               || null,
            engineering_notes:       inq.engineering_notes       || null,
            current_action_step:     inq.current_action_step     || null,
            action_step_due_date:    inq.action_step_due_date    || null,
            status:                  'Done',
            assigned_to:             inq.assigned_to             || null,
            priority:                inq.priority                || null,
            created_at:              inq.created_at              || null,
            updated_at:              new Date().toISOString(),
        });
    if (insertErr) return { error: insertErr };
    const { error: deleteErr } = await supabase
        .from('eng_inquiries')
        .delete()
        .eq('id', inq.id);
    return { error: deleteErr };
}

// deleteEngInquiry — hard-delete a row by id. Returns { error }.
export async function deleteEngInquiry(id) {
    const { error } = await supabase
        .from('eng_inquiries')
        .delete()
        .eq('id', id);
    return { error };
}

// uploadEngInquiryImage — upload a file to eng-inquiry-images/{id}/{filename}.
// upsert:true replaces same-named files.
// Returns Supabase storage response { data, error }
export async function uploadEngInquiryImage(inquiryId, file) {
    const path = `${inquiryId}/${file.name}`;
    return supabase.storage.from('eng-inquiry-images').upload(path, file, { upsert: true });
}

// listEngInquiryImages — list files for an inquiry with 1-hour signed URLs.
// Returns { data: [{name, signedUrl}], error }
export async function listEngInquiryImages(inquiryId) {
    const { data: files, error } = await supabase.storage
        .from('eng-inquiry-images')
        .list(inquiryId);
    if (error) return { data: [], error };

    const filtered = (files || []).filter(f => f.name !== '.emptyFolderPlaceholder');
    if (filtered.length === 0) return { data: [], error: null };

    const paths = filtered.map(f => `${inquiryId}/${f.name}`);
    const { data: signed } = await supabase.storage
        .from('eng-inquiry-images')
        .createSignedUrls(paths, 3600);

    const result = filtered.map((f, i) => ({
        name: f.name,
        signedUrl: signed?.[i]?.signedUrl || null
    }));
    return { data: result, error: null };
}
