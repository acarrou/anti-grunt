# anti-grunt

A Chrome / Edge extension that mutes throat clearing, coughs and grunts in the
audio of the tab you are watching (lecture recordings, for example). It works
on Windows and Mac and never needs the video file.

## How it works

1. The extension captures the tab's audio, which silences the tab itself.
2. The audio is played back about 1.5 seconds late.
3. During that delay, Google's YAMNet sound classifier listens to it, half a
   second at a time. When it hears one of the selected sounds, that stretch
   is silenced before it reaches your speakers.

Everything runs locally in the browser; no audio leaves the computer.

## Install

1. On the GitHub page, click **Code**, then **Download ZIP**, and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on
   **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder inside the
   unzipped folder.

Keep the unzipped folder where it is; Chrome loads the extension from there.

The classifier runtime and model in `extension/vendor` come from MediaPipe
and YAMNet (both Apache 2.0). `scripts/fetch-vendor.sh` re-downloads them.

## Use

1. Open the video and start playing it.
2. Click the Anti-Grunt icon, then **Start on this tab**.
3. The badge on the icon counts the sounds muted so far.

If it misses sounds, move **Sensitivity** towards "Mutes more". If it cuts out
words, move it the other way. Changes apply immediately.

## Limits

- Sound runs about 1.5 seconds behind the picture.
- Each mute also drops up to about half a second of speech around the sound.
- Detection is imperfect: some sounds get through and some words get cut.
- It filters one tab at a time.
