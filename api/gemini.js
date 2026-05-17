// Vercel serverless function: secrets must stay server-side.
// Set GEMINI_API_KEY in Vercel Project Settings -> Environment Variables.
// Serverless functions access Vercel environment variables with process.env.
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
        const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                body: JSON.stringify(req.body || {}),
            },
        );

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (error) {
        return res.status(500).json({
            error: "Gemini proxy request failed.",
            message: error.message,
        });
    }
}
