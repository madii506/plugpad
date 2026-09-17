# PLUG — token fees, plugged on air by the host

Launch a coin on any podcast or stream. 100% of the creator fee buys the host's own ad read at their own rate. The receipt is the clip.

Static site + two Vercel functions: `api/show.js` (resolves a show from a link — Apple, Spotify, RSS, Twitch, Kick, YouTube, X) and `api/avatar.js` (X avatar proxy). Local: `node srv.mjs` on :8844. Tests: `python3 test.py`.
