/** Shows the whole job search as a transit map, in the same shapes as the app's Home page.
 * Five stations run across the screen, and each made-up job sits under its stage with one signal
 * color saying what happens next. On phones the stations stack into a vertical list.
 */
import { MAP_STATIONS, SIGNAL_LEGEND } from './workedExample'

export function SearchMap() {
  return (
    <section id="map" className="stop stop-map" aria-labelledby="map-title">
      <div className="map-heading">
        <h2 id="map-title">Then see your whole search at once.</h2>
        <ul className="map-legend" aria-label="What the colors mean">
          {SIGNAL_LEGEND.map(({ signal, label }) => (
            <li key={signal}>
              <span className="signal-dot" data-signal={signal} aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <p className="map-caption">Maya’s search again. Every job and company here is made up.</p>
      <ol className="map-board" aria-label="Example job search, with made-up jobs">
        {MAP_STATIONS.map((station) => (
          <li key={station.name} className="map-column" data-station={station.name}>
            <div className="map-station">
              <span className="map-bullet">{station.jobs.length}</span>
              <h3>{station.name}</h3>
              {station.name === 'Rejected' && <span className="map-branch">Branch line</span>}
            </div>
            <ul className="map-jobs">
              {station.jobs.map((job) => (
                <li key={job.title} className="map-tile" data-closed={job.signal === 'closed' || undefined}>
                  <strong>{job.title}</strong>
                  <span className="map-company">{job.company}</span>
                  <span className="map-next" data-signal-text={job.signal}>
                    {job.signal !== 'closed' && <span className="signal-dot" data-signal={job.signal} aria-hidden />}
                    {job.next}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
