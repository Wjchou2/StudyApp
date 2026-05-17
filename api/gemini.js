// Vercel serverless function: secrets must stay server-side.
// Set GEMINI_API_KEY in Vercel Project Settings -> Environment Variables.
// Serverless functions access Vercel environment variables with process.env.
const PRIMARY_MODEL = "gemini-2.5-flash-lite";
const QUOTA_FALLBACK_MODEL = "gemma-4-26b-it";

async function callGemini(model, apiKey, body) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body || {}),
        },
    );

    const responseText = await response.text();
    let data;
    try {
        data = responseText ? JSON.parse(responseText) : {};
    } catch {
        data = { rawResponse: responseText };
    }

    return {
        data,
        model,
        response,
    };
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: "Missing GEMINI_API_KEY environment variable.",
        });
    }

    try {
        const primary = await callGemini(PRIMARY_MODEL, apiKey, req.body);
        if (primary.response.status !== 429) {
            return res.status(primary.response.status).json({
                ...primary.data,
                modelUsed: primary.model,
            });
        }

        const fallback = await callGemini(
            QUOTA_FALLBACK_MODEL,
            apiKey,
            req.body,
        );

        return res.status(fallback.response.status).json({
            ...fallback.data,
            modelUsed: fallback.model,
            fallbackFrom: primary.model,
            fallbackReason: "Primary model returned HTTP 429 quota exhausted.",
            primaryError: primary.data,
        });
    } catch (error) {
        return res.status(500).json({
            error: "Gemini proxy request failed.",
            message: error.message,
            modelUsed: null,
        });
    }
}
