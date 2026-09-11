// Quran Journal — "Verse of the Moment" home-screen widget
//
// SETUP (one time):
//   1. Install the free "Scriptable" app from the App Store.
//   2. Open Scriptable, tap the "+" button, and paste this entire file in.
//   3. Name the script something like "Quran Verse" (top of the editor).
//   4. Tap the Play button once to make sure it runs without errors.
//   5. Go to your Home Screen, long-press an empty area, tap "+", search for
//      "Scriptable", and add a widget (small or medium both work).
//   6. Long-press the new widget → Edit Widget → set "Script" to the one you
//      just made. Done — it'll refresh with a new verse once a day.
//
// This pulls from the same server your Quran Journal app already uses — no
// extra setup needed beyond pasting this in.

const PUSH_SERVER_URL = "https://quran-journal-push.razanquranjournal.workers.dev";

async function fetchVerse() {
  const req = new Request(PUSH_SERVER_URL + "/widget/verse");
  return await req.loadJSON();
}

async function createWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#EADBC8"); // matches the app's "sand" color

  const data = await fetchVerse().catch(() => null);

  const label = widget.addText("✦ VERSE OF THE MOMENT ✦");
  label.font = Font.mediumSystemFont(11);
  label.textColor = new Color("#D4AF37"); // gold
  label.centerAlignText();
  widget.addSpacer(10);

  if (!data || !data.ok) {
    const err = widget.addText("Couldn't load a verse right now.");
    err.font = Font.systemFont(13);
    err.textColor = new Color("#9C8B7A");
    err.centerAlignText();
    Script.setWidget(widget);
    Script.complete();
    return;
  }

  const arabic = widget.addText(data.arabic);
  arabic.font = new Font("Damascus", 20); // a built-in iOS Arabic-friendly font
  arabic.textColor = new Color("#6B5B4E");
  arabic.centerAlignText();
  widget.addSpacer(8);

  const english = widget.addText(`"${data.english}"`);
  english.font = Font.italicSystemFont(13);
  english.textColor = new Color("#6B5B4E");
  english.centerAlignText();
  widget.addSpacer(6);

  const source = widget.addText(data.source);
  source.font = Font.systemFont(11);
  source.textColor = new Color("#D8B4A0"); // dusty pink
  source.centerAlignText();

  Script.setWidget(widget);
  Script.complete();
}

await createWidget();
