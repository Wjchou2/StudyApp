# QuizForge Rooms

A Firebase-backed study game prototype:

- Host pastes lesson/unit notes or uploads a `.txt`/`.md` file.
- Gemini generates multiple-choice questions from the lesson content.
- A Realtime Database room is created with a join code.
- Students join from other devices using the same deployed URL and code.
- The host starts a timed quiz.
- Players answer each question, earn points for correct answers, and see a live leaderboard.
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
2. Paste it into `geminiConfig.apiKey` in `firebase-config.js`.
3. Keep `geminiConfig.model` as `gemini-2.5-flash`, or replace it with another model that supports `generateContent`.

This static prototype calls Gemini directly from the browser, so the Gemini key is visible to users.
For production, proxy this through a Cloud Function or server endpoint.

The app sends pasted notes and uploaded PDFs to Gemini. If Gemini is not configured or returns
invalid JSON, the app falls back to the local generator so the game can still run.
