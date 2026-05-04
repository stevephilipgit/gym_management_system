import { memo, useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";
import EnquiryModal from "../components/EnquiryModal.jsx";

const NAV_ITEMS = [
  { label: "Home", id: "home" },
  { label: "About", id: "about" },
  { label: "Plans", id: "plans" },
  { label: "Branches", id: "branches" },
  { label: "Contact", id: "contact" },
];

const whyChoose = [
  { title: "Personal Coaching", desc: "One-on-one correction and programming built around your goals." },
  { title: "Imported Equipment", desc: "Biomechanically advanced machines and progressive strength zones." },
  { title: "Hygienic Space", desc: "Daily deep-clean protocol, ventilation standards, and organized floors." },
  { title: "Real Results", desc: "Measured progress with trainer accountability and consistency tracking." },
];

const testimonials = [
  { quote: "I dropped 11kg and gained strength without burnout.", name: "Akash R.", score: "4.9/5" },
  { quote: "The coaching quality feels world-class and very personal.", name: "Monika S.", score: "5.0/5" },
  { quote: "This is the first gym where I actually stayed consistent.", name: "Vijay K.", score: "4.8/5" },
];

const BRANCHES_CONFIG = [
  {
    tag: "Flagship Branch",
    name: "Giri Gym - Mathur",
    description: "Our flagship strength and transformation hub serving North Chennai.",
    address: "Next to Beloved School, Kamaraj Nagar, Mathur, Chennai, Tamil Nadu 600068",
    timings: "Morning: 4:00 AM - 11:00 AM | Evening: 3:15 PM - 9:30 PM",
    phone: "+91 93423 93935",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Giri+Gym+Mathur+Chennai",
    imageUrl:
      "https://content3.jdmagicbox.com/v2/comp/chennai/j2/044pxx44.xx44.150721153754.f8j2/catalogue/giri-gym-mathur-chennai-gyms-r6vpvibd9y.jpg",
    imageAlt: "Giri Gym Mathur training floor",
    imageReplaceable: false,
  },
  {
    tag: "Central Chennai Branch",
    name: "Giri Gym - Vepery",
    description: "Central Chennai location focused on consistency and premium coaching.",
    address:
      "No 64, Opposite Bentick Girls Higher Secondary School, Jermiah Road, Vepery, Chennai 600007, Tamil Nadu",
    timings: "Morning: 4:00 AM - 11:00 AM | Evening: 3:15 PM - 9:30 PM",
    // Admin editable fallback until branch-specific contact is confirmed in internal records.
    phone: "+91 98765 43210",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Giri+Gym+Vepery+Chennai",
    imageUrl:
      "https://content3.jdmagicbox.com/v2/comp/chennai/a4/044pxx44.xx44.120531112356.q9a4/catalogue/giri-gym-vepery-chennai-gyms-5h6rzmyh3z.jpg",
    imageAlt: "Giri Gym Vepery workout area",
    imageReplaceable: false,
    adminEditableContact: true,
  },
];

const legacyCards = [
  { title: "Proven Experience", desc: "Years of real gym industry experience." },
  { title: "Community Trust", desc: "Serving Chennai fitness members for years." },
  { title: "Results Focused Coaching", desc: "Transformation through discipline." },
  { title: "Premium Standards", desc: "High quality equipment and coaching culture." },
];

const PlanCard = memo(({ plan, isBestValue, onClick }) => (
  <article className={`lp-plan-card ${isBestValue ? "lp-best-value" : ""}`}>
    <div className="lp-plan-top">
      <p className="lp-chip">{plan.label}</p>
      {isBestValue ? <span className="lp-badge">Best Value</span> : null}
    </div>
    <h3>{plan.title}</h3>
    <p className="lp-plan-sub">{plan.subtitle}</p>
    <div className="lp-plan-prices">
      <p>Weight Gain: {plan.priceWeightGain}</p>
      <p>Weight Loss: {plan.priceWeightLoss}</p>
      <p>Transformation: {plan.priceTransformation}</p>
    </div>
    <button className="lp-btn lp-btn-primary w-full" onClick={onClick}>
      Get Started
    </button>
  </article>
));

PlanCard.displayName = "PlanCard";

export default function Home() {
  const [packages, setPackages] = useState([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansLoadFailed, setPlansLoadFailed] = useState(false);
  const [isEnquiryOpen, setIsEnquiryOpen] = useState(false);

  const openEnquiry = useCallback(() => setIsEnquiryOpen(true), []);
  const closeEnquiry = useCallback(() => setIsEnquiryOpen(false), []);

  useEffect(() => {
    const normalizePackages = (payload) => {
      if (Array.isArray(payload?.data)) return payload.data;
      if (Array.isArray(payload?.data?.data)) return payload.data.data;
      if (Array.isArray(payload)) return payload;
      return [];
    };

    const loadPackages = async () => {
      try {
        setPlansLoadFailed(false);

        // 1) Preferred public endpoint
        try {
          const publicRes = await apiClient.get("/public/packages");
          const publicList = normalizePackages(publicRes.data);
          if (publicList.length > 0) {
            setPackages(publicList);
            return;
          }
        } catch {
          // fallback below
        }

        // 2) Fallback to existing packages endpoint (works for logged-in admins)
        try {
          const privateRes = await apiClient.get("/packages");
          const privateList = normalizePackages(privateRes.data);
          setPackages(privateList);
          return;
        } catch (fallbackErr) {
          console.error("Package Load Error:", fallbackErr);
          setPackages([]);
          setPlansLoadFailed(true);
        }
      } finally {
        setLoadingPlans(false);
      }
    };

    loadPackages();
  }, []);

  const displayPlans = useMemo(() => {
    const getTierLabel = (months) => {
      if (months === 1) return "Monthly";
      if (months === 3) return "Quarterly";
      if (months === 6) return "Halfyearly";
      if (months === 12) return "Annual";
      return `${months} Months`;
    };

    return [...packages]
      .sort((a, b) => (a.months || 0) - (b.months || 0))
      .map((pkg) => ({
      label: getTierLabel(pkg.months),
      title: pkg.name || `${pkg.months} Month Plan`,
      subtitle: "Premium access, custom coaching and progress tracking",
      priceWeightGain: `Rs. ${pkg.priceWeightGain ?? "Contact Us"}`,
      priceWeightLoss: `Rs. ${pkg.priceWeightLoss ?? "Contact Us"}`,
      priceTransformation: `Rs. ${pkg.priceTransformation ?? "Contact Us"}`,
      isPlaceholder: false,
    }));
  }, [packages]);

  const branchesSchema = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": BRANCHES_CONFIG.map((branch) => ({
        "@type": "SportsActivityLocation",
        name: branch.name,
        image: branch.imageUrl,
        telephone: branch.phone,
        address: {
          "@type": "PostalAddress",
          streetAddress: branch.address,
          addressLocality: "Chennai",
          addressRegion: "Tamil Nadu",
          postalCode: branch.name.includes("Vepery") ? "600007" : "600068",
          addressCountry: "IN",
        },
        url: branch.mapUrl,
      })),
    }),
    []
  );

  const scrollToId = (id) => {
    setIsMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lp-page">
      <nav className="lp-navbar">
        <div className="lp-container">
          <div className="lp-nav-row">
            <button className="lp-logo-wrap" onClick={() => scrollToId("home")} aria-label="Go to homepage">
              <p className="lp-logo-eyebrow">Premium Fitness Club</p>
              <p className="lp-logo">GIRI GYM</p>
            </button>

            <div className="lp-nav-links">
              {NAV_ITEMS.map((item) => (
                <button key={item.id} className="lp-nav-link" onClick={() => scrollToId(item.id)}>
                  {item.label}
                </button>
              ))}
              <button className="lp-btn lp-btn-primary" onClick={openEnquiry} id="nav-join-now-btn">
                Join Now
              </button>
            </div>

            <button className="lp-menu-toggle" onClick={() => setIsMenuOpen((prev) => !prev)} aria-label="Open menu">
              <span />
              <span />
              <span />
            </button>
          </div>

          <div className={`lp-mobile-panel ${isMenuOpen ? "open" : ""}`}>
            {NAV_ITEMS.map((item) => (
              <button key={item.id} className="lp-mobile-link" onClick={() => scrollToId(item.id)}>
                {item.label}
              </button>
            ))}
            <button className="lp-btn lp-btn-primary w-full" onClick={() => { setIsMenuOpen(false); openEnquiry(); }}>
              Join Now
            </button>
          </div>
        </div>
      </nav>

      <main id="home">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <article className="lp-hero-card lp-reveal">
              <span className="lp-chip">Elite Training Ecosystem</span>
              <h1>Transform Your Body at Chennai&apos;s Premium Gym</h1>
              <p>Elite equipment, expert trainers, real results.</p>
              <div className="lp-hero-actions">
                <button className="lp-btn lp-btn-primary" onClick={openEnquiry} id="hero-join-now-btn">
                  Join Now
                </button>
                <button className="lp-btn lp-btn-outline" onClick={() => scrollToId("plans")}>
                  View Plans
                </button>
              </div>
              <div className="lp-trust-row">
                <div>
                  <strong>2</strong>
                  <span>Branches</span>
                </div>
                <div>
                  <strong>1000+</strong>
                  <span>Transformations</span>
                </div>
                <div>
                  <strong>120+</strong>
                  <span>Modern Equipment</span>
                </div>
              </div>
            </article>
            <aside className="lp-hero-visual lp-reveal-delay">
              <div className="lp-visual-overlay" />
              <div className="lp-visual-copy">
                <p>Precision. Discipline. Transformation.</p>
                <h3>Built for serious progress, crafted for premium comfort.</h3>
              </div>
            </aside>
          </div>
        </section>

        <section id="about" className="lp-section">
          <div className="lp-container">
            <header className="lp-section-head">
              <span className="lp-chip">Why Choose Us</span>
              <h2>Luxury atmosphere with outcomes that actually show.</h2>
            </header>
            <div className="lp-grid-4">
              {whyChoose.map((item) => (
                <article key={item.title} className="lp-info-card">
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="plans" className="lp-section lp-section-light">
          <div className="lp-container">
            <header className="lp-section-head">
              <span className="lp-chip">Membership Plans</span>
              <h2>Flexible premium plans designed for long-term consistency.</h2>
            </header>
            <div className="lp-grid-4">
              {loadingPlans ? (
                <article className="lp-info-card lp-span-all">
                  <p>Loading premium plans...</p>
                </article>
              ) : displayPlans.length === 0 ? (
                <article className="lp-info-card lp-span-all">
                  <p>{plansLoadFailed ? "Unable to load plans right now. Please refresh shortly." : "No plans available right now. Please check again shortly."}</p>
                </article>
              ) : (
                displayPlans.map((plan, index) => (
                  <PlanCard
                    key={`${plan.title}-${index}`}
                    plan={plan}
                    isBestValue={plan.label === "Annual" || plan.title.toLowerCase().includes("annual")}
                    onClick={() => scrollToId("contact")}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-container">
            <header className="lp-section-head">
              <span className="lp-chip">Social Proof</span>
              <h2>Member transformations powered by expert supervision.</h2>
            </header>
            <div className="lp-proof-grid">
              <article className="lp-metrics-card">
                <h3>4.9/5</h3>
                <p>Average Member Rating</p>
                <ul>
                  <li>1,250+ Active Members</li>
                  <li>92% Renewal Rate</li>
                  <li>8,000+ Sessions Monthly</li>
                </ul>
              </article>
              <div className="lp-testimonials">
                {testimonials.map((item) => (
                  <article key={item.name} className="lp-testimonial">
                    <p>&quot;{item.quote}&quot;</p>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.score}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="branches" className="lp-section lp-section-light">
          <div className="lp-container">
            <header className="lp-section-head">
              <span className="lp-chip">Our Branches</span>
              <h2>Train at your nearest premium Giri Gym location.</h2>
            </header>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(branchesSchema) }} />
            <div className="lp-grid-2">
              {BRANCHES_CONFIG.map((branch) => (
                <article key={branch.name} className="lp-branch-card">
                  <div className="lp-branch-image-wrap">
                    <img
                      className="lp-branch-image"
                      src={branch.imageUrl}
                      alt={branch.imageAlt}
                      loading="lazy"
                      sizes="(max-width: 760px) 100vw, 48vw"
                    />
                    <span className="lp-branch-tag">{branch.tag}</span>
                  </div>
                  <h3>{branch.name}</h3>
                  <p>{branch.description}</p>
                  <p>{branch.address}</p>
                  {branch.imageReplaceable ? (
                    <p className="lp-placeholder-note">Image unavailable from listing. Replace with official branch photo.</p>
                  ) : null}
                  <p className="lp-muted">{branch.timings}</p>
                  <p className="lp-muted">{branch.phone}</p>
                  <div className="lp-branch-actions">
                    <a className="lp-btn lp-btn-outline" href={`tel:${branch.phone.replace(/\s+/g, "")}`}>
                      Call Now
                    </a>
                    <a className="lp-btn lp-btn-primary" href={branch.mapUrl} target="_blank" rel="noreferrer">
                      Visit Map
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-container">
            <header className="lp-section-head">
              <span className="lp-chip">Legacy of Discipline</span>
              <h2>Built on decades of bodybuilding passion and coaching excellence.</h2>
            </header>
            <div className="lp-grid-4">
              {legacyCards.map((item) => (
                <article key={item.title} className="lp-info-card">
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final-cta">
          <div className="lp-container lp-final-wrap">
            <h2>Start Today. Become Your Strongest Version.</h2>
            <button className="lp-btn lp-btn-primary" onClick={openEnquiry} id="cta-join-btn">
              Join Premium Fitness
            </button>
          </div>
        </section>
      </main>

      <footer id="contact" className="lp-footer">
        <div className="lp-container lp-footer-grid">
          <div>
            <p className="lp-logo">GIRI GYM</p>
            <p className="lp-muted">High-performance training with premium coaching standards.</p>
          </div>
          <div>
            <h4>Quick Links</h4>
            <div className="lp-footer-links">
              {NAV_ITEMS.map((item) => (
                <button key={item.id} onClick={() => scrollToId(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4>Contact</h4>
            <p>+91 98765 43210</p>
            <p>girigym@gmail.com</p>
            <p>Morning: 4:00 AM - 11:00 AM</p>
            <p>Evening: 3:15 PM - 9:30 PM</p>
          </div>
          <div>
            <h4>Follow</h4>
            <p>Instagram</p>
            <p>YouTube</p>
            <p>Facebook</p>
          </div>
        </div>
        <div className="lp-container lp-copy">Copyright 2026 Giri Gym. All rights reserved.</div>
      </footer>

      <a
        className="lp-whatsapp-float"
        href="https://wa.me/919876543210?text=Hi%20Giri%20Gym%2C%20I%20want%20membership%20details."
        target="_blank"
        rel="noreferrer"
        aria-label="Contact on WhatsApp"
      >
        WhatsApp
      </a>
      <EnquiryModal isOpen={isEnquiryOpen} onClose={closeEnquiry} />
    </div>
  );
}
