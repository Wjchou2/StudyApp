# QuizForge Rooms

A Firebase-backed study game prototype:

- Host pastes lesson/unit notes or uploads a `.txt`/`.md` file.
- The app generates multiple-choice questions from the lesson content.
- A Realtime Database room is created with a join code.
- Students join from other devices using the same deployed URL and code.
- The host starts a timed quiz.
- Players answer each question, earn points for correct answers, and see a live leaderboard.

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

## AI And PDF Notes

This version keeps the original dependency-free local question generator. For real AI/PDF support,
replace `createQuestions()` in `app.js` with a backend endpoint that:

1. Extracts text from uploaded PDFs.
2. Sends lesson text to an AI model.
3. Returns validated multiple-choice questions to store in the Realtime Database room.
