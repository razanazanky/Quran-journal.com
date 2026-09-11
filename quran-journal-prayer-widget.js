// Quran Journal — "Next Prayer" home-screen widget
//
// SETUP (one time):
//   1. Install the free "Scriptable" app from the App Store, if you haven't already.
//   2. Open Scriptable, tap "+", and paste this entire file in.
//   3. Name the script something like "Next Prayer".
//   4. Tap Play once — it will ask for permission to use your location the
//      first time. Allow it (only used to calculate prayer times, nothing is
//      sent anywhere except the same server your app already talks to).
//   5. Go to your Home Screen, long-press an empty area, tap "+", search
//      "Scriptable", add a widget (small works well for this one).
//   6. Long-press it → Edit Widget → set "Script" to "Next Prayer".
//
// OPTIONAL: if you'd rather not grant location access, long-press the widget →
// Edit Widget → in the "Parameter" field type your coordinates like this:
//   34.0083,-6.8353,3
// (latitude, longitude, calculation method — method 3 = Muslim World League,
// same options as in the app's Prayer Times page.)

const PUSH_SERVER_URL = "https://quran-journal-push.razanquranjournal.workers.dev";

async function getCoords() {
  if (args.widgetParameter) {
    const parts = args.widgetParameter.split(",").map(s => s.trim());
    if (parts.length >= 2) {
      return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]), method: parseInt(parts[2], 10) || 3 };
    }
  }
  Location.setAccuracyToThreeKilometers();
  const loc = await Location.current();
  return { lat: loc.latitude, lng: loc.longitude, method: 3 };
}

async function fetchNextPrayer(lat, lng, method) {
  const tz = Calendar.current().timeZone ? Calendar.current().timeZone.identifier : "UTC";
  const url = `${PUSH_SERVER_URL}/widget/prayer?lat=${lat}&lng=${lng}&method=${method}&tz=${encodeURIComponent(tz)}`;
  const req = new Request(url);
  return await req.loadJSON();
}

const PRAYER_ICONS = { Fajr: "🌤️", Dhuhr: "☀️", Asr: "⛅", Maghrib: "🌇", Isha: "🌙" };

async function createWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#F5E6DC"); // matches the app's "lightPink" color

  let data = null;
  try {
    const { lat, lng, method } = await getCoords();
    data = await fetchNextPrayer(lat, lng, method);
  }
  catch (err) {
    data = null;
  }

  if (!data || !data.ok) {
    const err = widget.addText("Couldn't load prayer times.");
    err.font = Font.systemFont(13);
    err.textColor = new Color("#9C8B7A");
    err.centerAlignText();
    Script.setWidget(widget);
    Script.complete();
    return;
  }

  const label = widget.addText("✦ NEXT PRAYER ✦");
  label.font = Font.mediumSystemFont(11);
  label.textColor = new Color("#D4AF37");
  label.centerAlignText();
  widget.addSpacer(12);

  const name = widget.addText(`${PRAYER_ICONS[data.next.name] || "🕌"}  ${data.next.name}`);
  name.font = Font.semiboldSystemFont(20);
  name.textColor = new Color("#6B5B4E");
  name.centerAlignText();
  widget.addSpacer(4);

  const time = widget.addText(data.next.time);
  time.font = Font.systemFont(15);
  time.textColor = new Color("#D8B4A0");
  time.centerAlignText();

  Script.setWidget(widget);
  Script.complete();
}

await createWidget();
