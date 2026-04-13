// ============================================================
// workers/gemini-proxy.js — Cloudflare Worker: Gemini API proxy
//
// Keeps the Gemini API key out of the frontend source.
// Deploy with: wrangler deploy
// Add secret:  wrangler secret put GEMINI_API_KEY
//
// The frontend posts { system_instruction, contents, generationConfig }
// and this worker forwards to Gemini with the key from env.
// ============================================================

const GEMINI_MODEL   = 'gemma-4-26b-a4b-it';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
        }

        if (!env.GEMINI_API_KEY) {
            return new Response(
                JSON.stringify({ error: { message: 'GEMINI_API_KEY secret not configured on this Worker' } }),
                { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return new Response(
                JSON.stringify({ error: { message: 'Invalid JSON body' } }),
                { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
        }

        const geminiRes = await fetch(`${GEMINI_API_URL}?key=${env.GEMINI_API_KEY}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: body.system_instruction,
                contents:           body.contents,
                generationConfig:   body.generationConfig,
            }),
        });

        const responseText = await geminiRes.text();
        return new Response(responseText, {
            status:  geminiRes.status,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    },
};
