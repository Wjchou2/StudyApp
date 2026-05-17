# QuizForge Rooms

A Firebase-backed study game prototype:

- Host pastes lesson/unit notes or uploads a `.txt`/`.md` file.
- Gemini generates multiple-choice or open-ended questions from the lesson content.
- The host previews and can edit generated questions before creating the room.
- A Realtime Database room is created with a join code.
- Students join from other devices using the same deployed URL and code.
- The host starts a timed quiz.
- Players answer each question, then results reveal publicly after everyone answers or the timer expires.
- The reveal screen shows what each person answered and whether they were right or wrong.
- Players earn 1 point for each correct answer, and see a live leaderboard.
- Open-ended answers are graded by Gemini for semantic correctness, with exact-match fallback if Gemini is unavailable.
- The room is removed when the host disconnects. Non-host players are removed when they disconnect.

## Run Locally

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Firebase Setup

1. Create a Firebase project.
2. Create a web app in Firebase Project settings.
3. Enable Realtime Database.
4. Copy the web app config into `firebase-config.js`.
5. Make sure `databaseURL` is set, for example `https://study-4ca30-default-rtdb.firebaseio.com`.
6. Serve or deploy this folder. Firebase Hosting, Netlify, Vercel, or any static host will work.

For quick testing, Realtime Database rules can be opened temporarily:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Use stricter rules before sharing broadly. A production version should add Firebase Auth,
host-only room controls, room expiration, and server-side validation.

## Gemini Setup

1. Create a Gemini API key in Google AI Studio.
2. Add it to Vercel as an environment variable named `GEMINI_API_KEY`.
3. Deploy the project to Vercel so `/api/gemini` runs as a serverless function.

Frontend code is public, so it must not contain the Gemini API key. The browser calls
`/api/gemini`; the Vercel serverless function reads the secret with `process.env.GEMINI_API_KEY`
and forwards the request to `gemini-2.5-flash`.

The app sends pasted notes and uploaded PDFs to `/api/gemini`. If the function is unavailable,
the environment variable is missing, or Gemini returns invalid JSON, the app falls back to the
local generator so the game can still run.
