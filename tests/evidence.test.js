import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectSource,
  placeContext,
  verifyClaims,
  deterministicClaims,
  publicSource,
  buildLeads,
  travelRelevance,
} from '../server/evidence.js';
import { computeOverallScore } from '../server/assessment.js';
import { normalizeUrl } from '../server/utils.js';
import {
  buildQueries,
  rankAndSelectCandidates,
  fetchTinyFish,
} from '../server/search.js';

const now = Date.parse('2026-10-22T12:00:00Z');
const trip = {
  destination: 'Delhi, India',
  location: { name: 'Delhi', admin1: 'Delhi' },
  startDate: '2026-10-22',
  endDate: '2026-10-23',
};
const context = placeContext(trip.destination, trip.location);
const quote = 'Delhi police report a road closure on Ring Road on 2026-10-22.';

test('travel relevance excludes news datelines and unrelated official committees', () => {
  assert.equal(
    travelRelevance(
      {
        title: 'Ebola outbreak in Kenya',
        snippet:
          'New Delhi, Oct 22 (PTI): Kenya reported an outbreak this week.',
      },
      context,
    ),
    false,
  );
  assert.equal(
    travelRelevance(
      {
        title: 'Delhi advisory committee recruitment',
        snippet: 'Delhi police recruitment notice.',
      },
      context,
    ),
    false,
  );
  assert.equal(
    travelRelevance(
      {
        title: 'Delhi traffic advisory',
        snippet: 'Check the latest diversions.',
      },
      context,
    ),
    true,
  );
});

test('ambiguous Manali requires state context and incomplete event dates stay as leads', () => {
  const manali = placeContext('Manali, Tamil Nadu', {
    name: 'Manali',
    admin1: 'Tamil Nadu',
  });
  assert.equal(
    travelRelevance(
      {
        title: 'Manali highway blocked',
        snippet: 'Tourists stranded in Kullu, Himachal Pradesh.',
      },
      manali,
    ),
    false,
  );
  assert.equal(
    travelRelevance(
      {
        title: 'Manali road closed',
        snippet: 'Police in Manali, Tamil Nadu announced traffic diversions.',
      },
      manali,
    ),
    true,
  );
  assert.equal(
    verify(
      source('Delhi police announced traffic restrictions from November 1.'),
    ).length,
    0,
  );
  assert.equal(
    verify(source('Delhi trains are running normally, none cancelled.')).length,
    0,
  );
  assert.equal(
    verify(source('Delhi police announced traffic diversions on 2026-10-22.'))
      .length,
    1,
  );
});

test('month/day event dates use a recent publication year with an explicit basis', () => {
  const s = source(
    'Delhi police announced traffic restrictions on October 21, 22.',
  );
  const [issue] = verify(s);
  assert.equal(issue.dateBasis, 'event-dates-with-publication-year');
  assert.equal(verify(source(s.text, { publishedAt: '' })).length, 0);
  assert.equal(
    verify(
      source(
        'Delhi police announced traffic restrictions on October 21, 2025.',
      ),
    ).length,
    0,
  );
  assert.equal(
    verify(source('Delhi police announced traffic restrictions on October 25.'))
      .length,
    0,
  );
});

test('week-old undated disruptions and general checking advice are not current findings', () => {
  assert.equal(
    verify(
      source('Delhi police announced traffic restrictions across the city.', {
        publishedAt: '2026-10-15',
      }),
    ).length,
    0,
  );
  assert.equal(
    verify(
      source(
        'Travellers should check official updates and road closures before a trip to Delhi.',
      ),
    ).length,
    0,
  );
});

test('repeated headline and body passages from one document produce one report', () => {
  const s = source(
    '# Delhi police announced traffic diversions on October 22.\nDelhi police announced traffic diversions on October 22 to regulate traffic near the local immersion ghats.',
  );
  const claims = deterministicClaims([s], context);
  const result = verifyClaims(claims, [s], trip, now);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].evidence, /immersion ghats/);
});

test('navigation-only extraction remains a snippet and never counts as an opened report', () => {
  const s = publicSource(
    {
      url: 'https://example.com/report',
      title: 'Delhi traffic advisory',
      snippet: quote,
      group: 'traffic',
    },
    {
      text: 'About Press Copyright Contact us Creators Advertise Terms Privacy Policy How it works',
    },
    0,
    context,
    now,
  );
  assert.equal(s.fetched, false);
  assert.equal(s.text, quote);
  assert.equal(verify(s).length, 0);
});
function source(text = quote, extra = {}) {
  const value = {
    id: 'S1',
    url: 'https://news.example.org/report',
    title: 'Delhi transport report',
    text,
    snippet: text,
    fetched: true,
    publishedAt: '2026-10-22',
    group: 'traffic',
    ...extra,
  };
  value.quality = inspectSource(value, context, now);
  return value;
}
function verify(s, q = s.text, t = trip) {
  return verifyClaims(
    [{ citations: [{ sourceId: s.id, quote: q }] }],
    [s],
    t,
    now,
  ).issues;
}

test('claims preserve source words and ignore invented model titles, scores and confidence', () => {
  const s = source();
  const [issue] = verifyClaims(
    [
      {
        title: 'Deadly chaos across all of India',
        score: 100,
        confidence: 1,
        citations: [{ sourceId: 'S1', quote }],
      },
    ],
    [s],
    trip,
    now,
  ).issues;
  assert.equal(issue.evidence, quote);
  assert.equal(issue.score, 52);
  assert.equal(issue.confidence, 0.6);
  assert.doesNotMatch(issue.title, /deadly|chaos/i);
  assert.match(issue.summary, /Delhi police report/);
});

test('fabricated citations and paraphrases cannot become findings', () => {
  const s = source();
  assert.equal(
    verify(
      s,
      'Delhi airport has been completely closed after a major disaster.',
    ).length,
    0,
  );
  assert.equal(
    verifyClaims(
      [{ citations: [{ sourceId: 'invented', quote }] }],
      [s],
      trip,
      now,
    ).issues.length,
    0,
  );
});

test('wrong place, state ambiguity and incidental city mentions are rejected', () => {
  assert.equal(
    verify(
      source(
        'Mumbai police report a road closure on 2026-10-22. Delhi newsroom.',
      ),
    ).length,
    0,
  );
  const rampur = {
    ...trip,
    destination: 'Rampur, Himachal Pradesh, India',
    location: { name: 'Rampur', admin1: 'Himachal Pradesh' },
  };
  for (const text of [
    'Rampur, Uttar Pradesh has a road closure on 2026-10-22.',
    'Rampur has a road closure on 2026-10-22.',
  ]) {
    const s = source(text, { title: 'Traffic update' });
    s.quality = inspectSource(
      s,
      placeContext(rampur.destination, rampur.location),
      now,
    );
    assert.equal(verify(s, text, rampur).length, 0);
  }
  const right = source(
    'Rampur in Himachal Pradesh has a road closure on 2026-10-22.',
  );
  right.quality = inspectSource(
    right,
    placeContext(rampur.destination, rampur.location),
    now,
  );
  assert.equal(verify(right, right.text, rampur).length, 1);
  assert.equal(
    inspectSource(
      source('NewDelhish road closure today.', { title: 'Unrelated' }),
      context,
      now,
    ).relevant,
    false,
  );
});

test('negated, lifted, hypothetical and historical reports stay out of active findings', () => {
  for (const text of [
    'There is no road closure in Delhi on 2026-10-22.',
    'The Delhi road closure was lifted on 2026-10-22.',
    'The Delhi road closure was a mock drill on 2026-10-22.',
    'The Delhi road closure was historical and occurred years ago.',
    'Delhi police report a road closure on 2024-10-22.',
  ])
    assert.equal(verify(source(text)).length, 0, text);
});

test('a model cannot remove negation by quoting only the tail of a sentence', () => {
  const s = source(`There is no road closure in Delhi on 2026-10-22.`);
  assert.equal(verify(s, 'road closure in Delhi on 2026-10-22.').length, 0);
});

test('unknown dates, old reports and snippets remain useful leads without invented findings', () => {
  for (const extra of [
    { publishedAt: '' },
    { publishedAt: '2025-01-01' },
    { fetched: false },
    { publishedAt: '2026-11-01' },
  ]) {
    const s = source('Delhi police report a road closure on Ring Road.', extra);
    assert.equal(verify(s).length, 0);
    assert.equal(buildLeads([s], []).length, 1);
    assert.ok(buildLeads([s], [])[0].reason.length);
  }
});

test('recent reports are not projected onto distant future trips', () => {
  const future = { ...trip, startDate: '2026-12-10', endDate: '2026-12-12' };
  assert.equal(
    verify(
      source('Delhi police report a road closure on Ring Road.'),
      undefined,
      future,
    ).length,
    0,
  );
  assert.equal(
    verify(
      source(
        'Delhi police announce a road closure from 2026-12-09 to 2026-12-13.',
      ),
      undefined,
      future,
    ).length,
    1,
  );
  assert.equal(
    verify(
      source('Delhi police announce a road closure on 10 December 2026.'),
      undefined,
      future,
    ).length,
    1,
  );
  assert.equal(
    verify(
      source('Delhi police announce a road closure on 10.12.2026.'),
      undefined,
      future,
    ).length,
    1,
  );
  assert.equal(
    verify(
      source(
        'Delhi police announce a road closure on 2026-12-01 and 2026-12-30.',
      ),
      undefined,
      future,
    ).length,
    0,
  );
});

test('extracted publication metadata and redirect origins determine source labels', () => {
  const s = publicSource(
    {
      url: 'https://delhi.gov.in/item',
      title: 'Delhi report',
      group: 'traffic',
    },
    {
      text: quote,
      finalUrl: 'https://example.org/item',
      publishedAt: '2026-10-22',
    },
    0,
    context,
    now,
  );
  assert.equal(s.quality.recency, 'recent');
  assert.equal(s.publicationDateBasis, 'extraction-metadata');
  assert.equal(s.trust, 'Web source');
  assert.equal(s.originalUrl, 'https://delhi.gov.in/item');
});

test('duplicates cannot inflate the highest supported severity', () => {
  const a = source();
  const b = source(quote, {
    id: 'S2',
    url: 'https://other.example.com/report',
  });
  const claims = deterministicClaims([a, b], context);
  const verified = verifyClaims(claims, [a, b], trip, now).issues;
  assert.equal(verified.length, 1);
  assert.deepEqual(verified[0].sourceIds, ['S1', 'S2']);
  assert.equal(computeOverallScore([...verified, ...verified]), 52);
});

test('short search queries omit exact trip dates and keep confirmed state context', () => {
  const queries = buildQueries('Rampur', '2027-01-10', '2027-01-11', {
    name: 'Rampur',
    admin1: 'Himachal Pradesh',
  });
  assert.equal(queries.length, 8);
  assert.ok(
    queries.every(
      (q) =>
        q.query.includes('Himachal Pradesh') && !q.query.includes('2027-01'),
    ),
  );
  assert.ok(queries.every((q) => q.query.length < 140));
});

test('URL deduplication retains lane provenance and rejects private targets', () => {
  for (const url of [
    'http://127.0.0.1./',
    'http://10.0.0.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://localhost',
    'http://service.internal',
    'https://example.com:8080',
  ])
    assert.equal(normalizeUrl(url), '');
  const rows = rankAndSelectCandidates(
    [
      {
        url: 'https://news.example.com/report?utm_source=a',
        title: 'Delhi advisory',
        snippet: quote,
        group: 'traffic',
      },
      {
        url: 'https://news.example.com/report?utm_source=b',
        title: 'Delhi advisory',
        snippet: quote,
        group: 'regional-news',
      },
    ],
    'Delhi',
    16,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].groups, ['traffic', 'regional-news']);
});

test('TinyFish extraction propagates the publication date instead of dropping it', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      results: [
        {
          url: 'https://example.com/item',
          text: quote,
          published_date: '2026-10-22',
        },
      ],
    }),
  );
  const result = await fetchTinyFish([{ url: 'https://example.com/item' }]);
  assert.equal(
    result.results.get('https://example.com/item').publishedAt,
    '2026-10-22',
  );
});
