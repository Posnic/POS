# Kitchen speakers and voice messages

In **Desktop → Hardware → Kitchen Sound**, connect or pair speakers using your
operating system, refresh outputs, tick each intended speaker and save. Use
**Test this speaker** for each output and check its physical volume. Enable the
existing bell and order-reading switches as needed. Select an installed speech
voice after selecting your outputs.

Enable kitchen voice messages and choose the branch when this installation has
multiple branches. Hold the microphone button in Kitchen Sound or Captain's KOT
page; release to send. These are recorded messages, up to 30 seconds, rather than
a live intercom. Allow microphone access on the device. Captain's browser version
requires a secure HTTPS origin for recording; use the mobile app on local Wi-Fi.
Captain must reach the local POS running the speakers; a cloud-only server cannot
play through a disconnected desktop.

Choose **automatic orders**, **staff voice messages**, or both using their separate
switches. Automatic orders have an arrival ting, an optional per-dish ting, and a
voice picker. Staff recordings have their own optional ting and sound picker.
Both Save Kitchen Sound buttons save all these choices together. Source and ting
changes affect new messages; accepted messages already queued are retained.

Messages and order announcements use the same queue. The **Pause playback while
someone records** setting temporarily pauses announcements to prevent feedback.
Turn it off when staff record away from the kitchen speakers and existing playback
should continue. Multiple staff can record and send concurrently; accepted messages
are saved and played in received order, without voice messages jumping ahead of
an order already being read. Retrying the same upload does not add another copy.
Short upload delays have a two-minute grace period after the recording timeout.
Each selected output finishes independently; multiple speakers may
play at different times. Failed outputs retry every ten seconds without switching
to another speaker. Pending audio survives an app restart. The panel lists each
output's progress and error. A completed output is not replayed during another
output's retry. If playback is interrupted halfway through a phrase, that phrase
restarts; a crash after playback but before saving its acknowledgement can also
repeat the last phrase. The computer cannot verify that someone heard the sound.

Windows uses its installed SAPI voices; macOS uses its installed system voices.
Linux order reading requires `espeak-ng` installed through the distribution's
package manager. Recorded messages and bells do not require a speech engine.
Keep the POS running and speakers connected, charged and unmuted. Bluetooth power
saving or loss of range may delay playback; the software cannot force a physically
disconnected speaker to play.

The local `kitchen-audio-queue.json` in the app's user-data directory stores pending
messages, including recorded audio. Queue storage is bounded at 50 pending messages
and 20 MB; a full queue reports an error. Completed history is trimmed as new
messages arrive. Treat this file as private shop data. It is not uploaded to a
speech provider. Do not delete it to troubleshoot: that would lose pending audio.

Local verification: `node --test tests/kitchen-audio-*.test.js`.
`tests/tools/kitchen-audio-proof.cjs` runs the shipped Electron player on a muted
real output. Physical Bluetooth audibility and Android/iOS microphone permissions
must also be checked on the customer's devices before relying on kitchen talk.
