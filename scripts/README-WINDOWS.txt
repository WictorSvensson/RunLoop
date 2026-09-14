========================================================
  RUNLOOP - How to run the app (super simple!)
========================================================

You do NOT need to know anything about computers or code.
Just follow these steps.

Before you start, you need:
  - A Windows 10 or Windows 11 computer.
  - An internet connection (the first time downloads a few GB, so
    Wi-Fi is better than a phone hotspot).
  - About 20 minutes of patience the first time.

What it installs (all from official, trusted sources):
  - Git, Node.js and Docker Desktop (the tools that run the app).
  - A small database that lives on your computer.
The first time, Windows will ask for permission to install these -
that is normal, just click "Yes".


THE FIRST TIME
--------------

1. Open the "scripts" folder.

2. Double-click the file called:   START-HERE

3. A blue/black window opens. If Windows shows a popup asking
   for permission, click "Yes".

4. Wait. It is installing everything you need. This can take
   10-20 minutes. That is completely normal - go grab a coffee.

5. When it says "please RESTART your computer":
      - Restart your computer.
      - After it turns back on, wait about 1 minute for the
        little whale icon (near the clock, bottom-right) to
        stop moving.
      - The FIRST time Docker opens it may show a welcome or
        terms screen - just accept it and let it finish.
      - Then double-click START-HERE again.

6. Your web browser will open the app automatically at:
      http://localhost:3000

Done! You are running the app.


CONNECT YOUR STRAVA (OPTIONAL)
------------------------------
NOTE: the Strava integration was removed from the app — the section below
is kept for history only. Connect Garmin or upload a Suunto export from
the Profile page instead.

Do this if you want your runs to show up in the app automatically.
It takes about 2 minutes. You only do it once.

Step 1 - Create your own Strava app
  a) Go to:  https://www.strava.com/settings/api
     (log in with YOUR OWN Strava account)
  b) Fill in the form:
       - Application Name:  anything (e.g. "Runloop")
       - Category:          Training
       - Website:           http://localhost:3000
       - Authorization Callback Domain:   localhost
         ^^^ IMPORTANT: type exactly  localhost  - no http://, no port.
  c) Click "Create".
  d) You will now see a "Client ID" (a number) and a
     "Client Secret" (a long code). Keep this page open.

Step 2 - Put them into the settings file
  a) In the project folder, find the file called:  .env
     (open it with Notepad - right-click > Open with > Notepad)
  b) Make sure these three lines are there, and paste in YOUR
     numbers from Step 1:

       STRAVA_CLIENT_ID=your_client_id_here
       STRAVA_CLIENT_SECRET=your_client_secret_here
       STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback

     Use YOUR OWN Client ID and Secret (not anyone else's) - that
     keeps your Strava sync separate and avoids sharing limits.

     Note: if your app opened on a different address than
     http://localhost:3000 (check the "Local:" line in the black
     window), change the 3000 in that last line to match.
  c) Save the file (File > Save) and close Notepad.

Step 3 - Connect
  a) If the app is already running, close the black window and
     double-click START-HERE again so it picks up the new settings.
  b) In the app, open the "Training" page and click "Connect Strava".
  c) Log in to Strava (as yourself) and click "Authorize".
  d) Back in the app, click "Sync now" to import your runs.

Done! Your activities will now appear on the Training page.


EVERY OTHER TIME
----------------

Just double-click START-HERE.
It will start the app and open your browser. That's it.


HOW TO STOP THE APP
-------------------

Close the black window. That's all.


IF SOMETHING LOOKS BROKEN
-------------------------

Close the black window and double-click START-HERE again.
Running it again is safe - it will pick up where it left off.
If it still complains, the message in the window will tell you
what to do (for example: restart, or check your internet).

If the browser doesn't open on its own, open your browser
and type this into the address bar:
      http://localhost:3000

If "Connect Strava" shows an error, it usually means the Strava
settings aren't filled in yet - go back to the
"CONNECT YOUR STRAVA" section above and check Step 2.

========================================================
