# TraceRisk — Azinhack 2026 project brief

## The idea

**One trip. Clear updates. Practical next steps.**

TraceRisk helps travellers in India understand what could affect a journey. Instead of searching separately for road updates, local news and weather, users save a trip and get a source-linked briefing for their places and dates.

[Website](https://tracerisk.onrender.com/) · [README](README.md) · [User guide](docs/USER_GUIDE.md) · [Engineering decisions](DECISIONS.md)

This is the current project brief, not a statement that every event requirement has been independently checked. Confirm submission format and judging requirements against the organisers’ published rules.

## The problem

A destination may look fine while the journey is disrupted. Useful updates are scattered, dates can be unclear, and travellers need to know what to do after finding a problem.

## How it works

1. Sign in and save a city or landmark itinerary with dates and travel mode.
2. Run Quick or Thorough. The backend retrieves reports and forecasts, checks place/date relevance and retains source quotations.
3. Review travel updates, evidence and practical checks. Save a briefing or follow changes in Trip Watch.

The interface uses a simple ivory/forest-green theme, guided first-trip steps, readable dates, mobile layouts and optional details rather than technical labels in the main flow.

## What is implemented

| Feature                | Demonstrate                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Multi-city itinerary   | Up to six confirmed cities/landmarks, with dates for each stop.                                                  |
| Route-aware map        | Road geometry, supported alternatives and source-supported incident markers; regional reports listed separately. |
| Trip Watch             | Scheduled checks and meaningful in-app change alerts when the host is available.                                 |
| Alternative comparison | Recheck a later departure or supported road option without changing the original plan.                           |
| Evidence verification  | Quotations, original links, event dates, affected areas, supporting/conflicting sources.                         |
| Personal impact        | Car/bus/motorcycle/train/flight and optional family, mobility and air-quality needs.                             |
| Travel-agent desk      | Client trips, branding, seven-day revocable briefing links and print/PDF.                                        |
| Trip assistant         | Answers grounded in saved trip evidence, with citations and explicit missing information.                        |
| Accounts               | Local email/password or Supabase cloud authentication/storage; Google login when configured.                     |

## Simple presentation walkthrough

1. **Problem:** explain how scattered information makes trip planning difficult.
2. **Plan:** create a trip such as Qutub Minar, Delhi → Hawa Mahal, Jaipur. Confirm places and dates.
3. **Check:** choose Quick or Thorough. Explain that the longer option reads more sources, not that it guarantees more incidents.
4. **Result:** show the overview, practical checks and one original source in Evidence.
5. **Journey:** show the route map and a date comparison when provider data is available.
6. **Follow-up:** open What changed, ask the assistant a question, then create a briefing link.
7. **Business:** explain the proposed revenue options below and the current limits.

Use labelled fixtures or screenshots if live providers are unavailable. Do not present demonstration reports as current real-world conditions.

## Monetization proposal

- **Sponsored hotel listings:** clearly labelled ads near a traveller’s planned stops. Sponsorship must not affect disruption findings or imply that a hotel/location is certified safe.
- **Trip passes:** paid monitoring for a particular journey, with a clear service period and alert delivery terms.
- **Travel-agent subscription:** client trip management, branded briefings and monitoring capacity.

These are business ideas. Payments, hotel ads, paid plans and shared team roles are not implemented. An ad-funded launch needs appropriate commercial provider/weather rights and reliable hosting.

## Technology

React 19/Vite 7 interface; Express 5/Node.js 24 backend; SQLite locally or Supabase Auth/PostgreSQL in cloud mode. TinyFish provides search/page extraction, with independent Google News RSS/GDELT discovery for Thorough checks. Groq is optional for quotation selection. Place/weather providers and OSRM/OpenStreetMap support location, forecast and map features.

Quick has about 20 seconds per place and a 110-second full-trip processing limit. Thorough allows 90 seconds per place and eight minutes per itinerary. Network/hosting delays are additional; jobs can finish sooner. Automated verification includes Node regressions, actual SQL migration tests in embedded PostgreSQL and Playwright browser workflows. See [evaluation](docs/EVALUATION.md) for measured samples and their limits.

## What to explain honestly

TraceRisk supports travel awareness; it is not an official safety rating. Missing reports do not prove safety, and a disappearing report is not automatically resolved. Search can miss local-language or very recent events. Forecasts are model-derived and date-limited. Road estimates exclude live traffic; train/flight routes and timetables are unsupported. Corridor checks sample areas, not every segment.

Trip Watch needs an available host; Render Free can sleep. Alerts are in-app, not email/SMS/push. Cloud login needs owner-configured Supabase/Google settings and SQL migration. No independently established accuracy percentage or publication-grade reliability is claimed.

The next priorities are broader retrieval evaluation, multilingual coverage, reliable monitoring infrastructure and user testing with travellers and agents.
