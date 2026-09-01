import Link from "next/link";
import { Reveal } from "@/components/reveal";
import { RotatingImagery } from "@/components/rotating-imagery";

const features = [
  ["01", "Compare every capture", "Bring your own before-and-after imagery. TerraWatch keeps every location, date, and evidence pair organized."],
  ["02", "Explain every detection", "Vision analysis returns visible evidence, confidence, severity, and recommended next actions—not unexplained boxes."],
  ["03", "Monitor many places", "See every neighborhood in one workspace, with a clear summary of changes and locations needing review."]
];

export default function LandingPage() {
  return (
    <div className="landing">
      <a className="skip-nav" href="#main">Skip to content</a>
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="TerraWatch home">
          <span className="terra-mark"><i /><i /><i /></span>
          <span>TerraWatch</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#platform">Platform</a>
          <a href="#workflow">How it works</a>
          <a href="#security">For teams</a>
        </nav>
        <div className="landing-actions">
          <Link href="/login" className="text-link">Log in</Link>
          <Link href="/signup" className="gold-button">Start monitoring</Link>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-grid" />
          <Reveal className="hero-copy">
            <p className="hero-kicker"><span /> Geospatial intelligence for local teams</p>
            <h1>See what changed.<br /><em>Know what to do.</em></h1>
            <p className="hero-lede">AI-assisted change monitoring for neighborhoods, construction zones, waterways, and public land—built for teams that need clear evidence, not GIS complexity.</p>
            <div className="hero-actions">
              <Link href="/signup" className="gold-button gold-button-lg">Create your workspace <Arrow /></Link>
              <Link href="/dashboard" className="outline-button">Explore the demo</Link>
            </div>
            <div className="trust-line">
              <span>No credit card</span><span>Bring your own imagery</span><span>Human review built in</span>
            </div>
          </Reveal>

          <div className="hero-product" aria-label="Product preview">
            <div className="product-topbar">
              <span className="mini-brand"><span className="terra-mark"><i /><i /><i /></span> TerraWatch</span>
              <span className="live-chip"><i /> Monitoring live</span>
            </div>
            <div className="product-body">
              <div className="location-rail">
                <small>MONITORED AREAS</small>
                <strong>My locations</strong>
                <div className="preview-location active"><i className="loc-thumb loc-one" /><span><b>Riverside North</b><small>2 changes</small></span><em>02</em></div>
                <div className="preview-location"><i className="loc-thumb loc-two" /><span><b>Ward 04</b><small>No change</small></span><em>00</em></div>
                <div className="preview-location"><i className="loc-thumb loc-three" /><span><b>East Expansion</b><small>1 review</small></span><em>01</em></div>
              </div>
              <div className="preview-map">
                <RotatingImagery />
                <div className="scan-line" />
                <div className="change-zone"><span>AI DETECTION</span></div>
                <div className="map-label">RIVERSIDE NORTH <span>30-DAY COMPARISON</span></div>
                <div className="coordinates">10.7605° N / 106.8727° E</div>
              </div>
              <div className="insight-card">
                <div className="insight-head"><span>AI analysis</span><b>92%</b></div>
                <h3>New ground activity detected</h3>
                <p>Exposed soil and a rectangular foundation footprint appeared between both captures.</p>
                <div className="evidence-row"><span /> New surface clearing</div>
                <div className="evidence-row"><span /> Foundation geometry</div>
                <button>Open evidence report <Arrow /></button>
              </div>
            </div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Product capabilities">
          <span>One workspace</span><b>Satellite imagery</b><b>AI evidence</b><b>Field verification</b><b>Audit-ready reports</b>
        </section>

        <section className="feature-section" id="platform">
          <Reveal className="section-heading">
            <p className="eyebrow-dark">Built for clarity</p>
            <h2>From two images<br />to one clear decision.</h2>
            <p>TerraWatch turns a slow, specialist workflow into a review process any local team can understand.</p>
          </Reveal>
          <div className="feature-list">
            {features.map(([number, title, copy]) => (
              <Reveal key={number}><article>
                  <span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div><Arrow />
              </article></Reveal>
            ))}
          </div>
        </section>

        <section className="workflow-section" id="workflow">
          <Reveal>
            <p className="eyebrow-light">A trustworthy workflow</p>
            <h2>AI finds the signal.<br />Your team makes the call.</h2>
          </Reveal>
          <div className="workflow-steps">
            <Reveal><div><span>01</span><h3>Add a place</h3><p>Draw or upload the area your team is responsible for.</p></div></Reveal>
            <Reveal delay={.08}><div><span>02</span><h3>Add captures</h3><p>Upload dated imagery or connect a compatible provider.</p></div></Reveal>
            <Reveal delay={.16}><div><span>03</span><h3>Review evidence</h3><p>See the visual difference, reasoning, confidence, and next step.</p></div></Reveal>
          </div>
        </section>

        <section className="closing-cta" id="security">
          <p className="eyebrow-dark">Monitor with confidence</p>
          <h2>Your territory changes every day.<br /><em>Don’t discover it too late.</em></h2>
          <Link href="/signup" className="gold-button gold-button-lg">Start your workspace <Arrow /></Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span className="landing-brand"><span className="terra-mark"><i /><i /><i /></span> TerraWatch</span>
        <p>Decision support for responsible land monitoring.</p>
        <span>© 2026 TerraWatch</span>
      </footer>
    </div>
  );
}

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;
}
