import { ArrowUpRight } from 'lucide-react';

export default function TripContext({ result }) {
  const sources = new Map(
    (result.sources || []).map((source) => [source.id, source]),
  );
  if (!result.highlights && !result.leads && !result.nextSteps) return null;
  return (
    <section
      className="trip-context evidence-section"
      aria-labelledby="trip-context-title"
    >
      <div className="section-heading">
        <div>
          <span className="panel-kicker">YOUR TRIP, WITH CONTEXT</span>
          <h2 id="trip-context-title">Useful information for your trip.</h2>
          <p>
            Source leads and practical checks remain available when a disruption
            cannot be established.
          </p>
        </div>
      </div>
      <div className="trip-highlights">
        {(result.highlights || []).map((item) => (
          <article key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
      {result.leads?.length > 0 && (
        <div className="trip-leads">
          <h3>Local reports to review</h3>
          <p className="muted">
            These sources are useful leads; they are not established disruptions
            for your trip.
          </p>
          {result.leads.map((lead) => (
            <article key={lead.id} className="trip-lead">
              <h4>{lead.title}</h4>
              <p>{lead.excerpt}</p>
              <p className="lead-reason">{lead.reason}</p>
              <div className="source-row">
                {(lead.sourceIds || [])
                  .map((id) => sources.get(id))
                  .filter(Boolean)
                  .map((source) => (
                    <a
                      className="source-link"
                      key={source.id}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Read {source.domain}
                      <ArrowUpRight size={14} />
                    </a>
                  ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {result.nextSteps?.length > 0 && (
        <div className="trip-next-steps">
          <h3>Before you leave</h3>
          {(result.nextSteps || []).map((step) => (
            <article key={step.title}>
              <a href={step.url} target="_blank" rel="noreferrer">
                {step.title}
                <ArrowUpRight size={15} />
              </a>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
