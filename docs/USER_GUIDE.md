# Using TraceRisk

[Open TraceRisk](https://tracerisk.onrender.com/) · [README](../README.md)

## Plan your first trip

1. Create an account or sign in. **Continue with Google** is available when the site’s Google provider is configured. If email confirmation is requested, open the email link before signing in.
2. Choose **New trip** or **Plan my first trip**.
3. Give the trip a name. The client/group field is optional.
4. Enter a destination, such as **Qutub Minar, Delhi**. Choose **Find place** or press Enter, then select the correct result. The confirmation below the field shows the selected place.
5. Add arrival and departure dates. Moving arrival after departure moves departure to the same day. Stops must follow each other in date order.
6. Add an origin for route checks, or **Add another stop** for a longer itinerary. Up to six stops are supported, with up to 30 days per stop and 90 days overall.
7. Select your travel mode. Open **Traveller needs (optional)** for children, limited mobility or air-quality sensitivity.
8. Choose **Save itinerary**. Saving keeps the plan in your account; it does not start a scan.

The trip form supports Tab navigation. Escape or **Cancel** closes it without saving. Check that each place is confirmed before saving.

## Choose a check

| Option   | When to use it                                    | Expected processing limit                                        |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Quick    | A first look or a regular refresh.                | About 20 seconds per place; up to 110 seconds for a full trip.   |
| Thorough | More source searches and more time to read pages. | Up to 90 seconds per place; up to eight minutes for a full trip. |

Select **Check type**, then **Check trip** or **Check again**. Progress appears as places are reviewed. You can explore other trip views while it runs. **Cancel check** keeps the previous completed report. Hosting/network delays can add time, and either mode can finish sooner.

More time does not guarantee more verified findings. TraceRisk keeps useful forecasts, links and practical checks when other sources are unavailable.

## Find the answer you need

| Trip view    | What to use it for                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Overview     | Read updates for each stop, weather and practical checks before departure.                                        |
| Route map    | See the road journey, your stops and source-supported incident locations. Broader reports are listed separately.  |
| Evidence     | Read quotations, dates, supporting links and conflicting reports. Open **Where we looked** for retrieval details. |
| What changed | Follow new, changed and resolved reports; adjust watch settings when automatic monitoring is available.           |
| Compare      | Recheck a later departure or a supported road alternative without changing your saved itinerary.                  |
| Assistant    | Ask questions using the trip’s saved evidence. A completed check is required.                                     |
| Share        | Create a seven-day briefing link, copy or revoke it, or print/save as PDF.                                        |

Questions to try: “What should I check before leaving?”, “Which issues could affect my bus journey?” or “Why did this trip’s assessment change?” The assistant uses your last completed check; refresh the trip for newer information. It cannot supply unsupported opening hours, live flight status or ticket prices.

## Keep track of trips

**Trips** lists saved plans. Search by trip name, client or place; **Clear search** restores the list. **Updates** opens a trip’s change timeline directly. A report that disappears is unconfirmed, not automatically resolved.

If Trip Watch is available, choose checks every 1, 3, 6, 12 or 24 hours and pause/resume as needed. Monitoring ends after the trip dates. Alerts appear inside TraceRisk; there are no email, SMS or phone push notifications. If the site shows **Manual checks**, use **Check again** when you need an update. Automatic checks depend on server availability.

**Travel desk** is useful for client/group trips. In **Settings**, add an agency name, contact and briefing colour, then save branding. New briefings use those details.

## Share carefully

A briefing link gives anyone who has it access to a saved report for seven days. It does not follow future updates. Client/group names are excluded unless you select the checkbox. To stop access, choose **Revoke link**. Creating a replacement link invalidates the previous one. Printed or downloaded copies cannot be revoked.

## Common questions

**Where are my trips saved?**

Trips belong to the account and live on the site’s server: Supabase PostgreSQL when configured, otherwise SQLite. The host needs persistent storage for SQLite. The separate `/check` notebook stores plans only in that browser. Do not use a shared device without signing out.

**Why does Google show a Supabase address?**

Supabase handles the secure Google login callback. Its project address can appear during sign-in. Site owners can set the app name to TraceRisk in Google Auth Platform branding; a custom authentication domain requires separate setup.

**Why is some information missing?**

A source may be unavailable, a forecast may not cover the trip dates yet, or no relevant report may have been established. Try Thorough, open the available sources, and use the suggested authority/operator checks. Missing information cannot prove a place is safe.

**Does “no disruptions found” mean it is safe?**

It means no disruption was established in the information checked. New or unreported issues can still exist. Check again close to departure and confirm important details with local authorities or your transport operator.

**Why is the map background blank?**

A map provider may be unreachable or rate-limited. TraceRisk keeps available route and stop overlays and offers an external map link. A drawn route is an estimated driving path, not proof that every road is open.

**Can I edit or remove a trip?**

Open it and choose **Edit trip**. Choose **Delete trip** at the bottom to remove it after confirmation. Editing the plan requires a new check for the changed itinerary.

**I forgot my password.**

Choose **Sign in**, then **Forgot password?** Cloud accounts can request an email reset; follow the link in the same browser. Email delivery depends on the site’s Supabase configuration. Local SQLite accounts do not have email recovery.

For site-owner setup, see [Supabase](SUPABASE_SETUP.md), [Google login](GOOGLE_SIGN_IN.md) and [deployment](DEPLOYMENT.md).
