import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  FiClock,
  FiMail,
  FiMapPin,
  FiMessageCircle,
  FiPhone,
  FiSettings,
  FiShield,
  FiTarget,
  FiTrendingUp,
} from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import EnquiryModal from "../components/features/enquiry/EnquiryModal.jsx";

const NAV_ITEMS = [
  { label: "Home", id: "home" },
  { label: "Why Us", id: "why-us" },
  { label: "Plans", id: "plans" },
  { label: "Location", id: "branches" },
  { label: "Contact", id: "contact" },
];

const FEATURE_ITEMS = [
  {
    title: "Personal Coaching",
    desc: "One-on-one nutrition and training programming structured around your goals.",
    icon: FiTarget,
  },
  {
    title: "Imported Equipment",
    desc: "Biomechanically advanced machines built for safe, targeted strength training.",
    icon: FiSettings,
  },
  {
    title: "Hygienic Space",
    desc: "Daily sanitation, active air filtration, and polished training floors.",
    icon: FiShield,
  },
  {
    title: "Measurable Results",
    desc: "Structured tracking and accountability so progress is visible and consistent.",
    icon: FiTrendingUp,
  },
];

const BRANCHES_CONFIG = [
  {
    tag: "Flagship Branch",
    pin: "25+ Years Serving Chennai",
    name: "Mathur Branch",
    description: "Our flagship strength and transformation hub serving North Chennai.",
    address: "Next to Beloved School, Kamaraj Nagar, Mathur, Chennai, Tamil Nadu 600068",
    timings: "Morning: 4:00 AM - 11:00 AM | Evening: 3:15 PM - 9:30 PM",
    phone: "+91 93423 93935",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Giri+Gym+Mathur+Chennai",
    imageUrl:
      "https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=600&q=80",
    imageAlt: "Giri Gym Mathur training floor",
  },
  {
    tag: "Ladies Gym",
    pin: "Same Building • 2nd Floor",
    name: "Giri Ladies Gym",
    description: "A dedicated women-only training space with premium equipment and focused coaching.",
    address: "Same building, 2nd floor, Next to Beloved School, Kamaraj Nagar, Mathur, Chennai, Tamil Nadu 600068",
    timings: "Morning: 5:30 AM - 10:30 AM | Evening: 4:00 PM - 8:30 PM",
    phone: "+91 93423 93935",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Giri+Gym+Mathur+Chennai",
    imageUrl:
      "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=600&q=80",
    imageAlt: "Giri Ladies Gym training floor",
  },
];

const legacyCards = [
  { title: "Proven Experience", desc: "25+ years of real-world fitness industry leadership in Chennai." },
  { title: "Community Trust", desc: "Serving Chennai members with consistency, accountability, and long-term results." },
  { title: "Focused Coaching", desc: "Programmes shaped around your transformation goals with discipline and structure." },
  { title: "Premium Standards", desc: "High quality equipment and a polished training atmosphere built for serious progress." },
];

const HERO_IMAGES = [
  {
    src: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=80",
    alt: "Giri Gym Facility Training Floor",
  },
  {
    src: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80",
    alt: "Strength training area with premium equipment",
  },
  {
    src: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1200&q=80",
    alt: "Athlete preparing for a workout session",
  },
  {
    src: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80",
    alt: "Members training in a modern gym environment",
  },
];

const PlanCard = memo(({ plan, isFeatured, onSelectPlan }) => (
  <article className={`plan-card ${isFeatured ? "featured" : ""}`}>
    <div className="plan-header">
      <h3>{plan.title}</h3>
      {isFeatured ? <span className="ribbon">Best Value</span> : null}
    </div>
    <ul className="tier-list">
      <li className="tier-item">
        <span className="tier-name">Weight Gain</span>
        <span className="tier-price">{plan.priceWeightGain}</span>
      </li>
      <li className="tier-item">
        <span className="tier-name">Weight Loss</span>
        <span className="tier-price">{plan.priceWeightLoss}</span>
      </li>
      <li className="tier-item">
        <span className="tier-name">Transformation</span>
        <span className="tier-price">{plan.priceTransformation}</span>
      </li>
    </ul>
    <button type="button" className="btn btn-secondary btn-full" onClick={() => onSelectPlan(plan)}>
      Select Plan
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
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [activeHeroImage, setActiveHeroImage] = useState(0);

  const openEnquiry = useCallback(() => {
    setSelectedPlan(null);
    setIsEnquiryOpen(true);
  }, []);

  const openEnquiryForPlan = useCallback((plan) => {
    setSelectedPlan(plan);
    setIsEnquiryOpen(true);
  }, []);

  const closeEnquiry = useCallback(() => {
    setSelectedPlan(null);
    setIsEnquiryOpen(false);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveHeroImage((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 4500);

    return () => window.clearInterval(intervalId);
  }, []);

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

        const publicRes = await apiClient.get("/public/packages");
        const publicList = normalizePackages(publicRes.data);
        if (publicList.length > 0) {
          setPackages(publicList);
        } else {
          setPackages([]);
          setPlansLoadFailed(false);
        }
      } catch {
        console.error("Package Load Error");
        setPackages([]);
        setPlansLoadFailed(true);
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

    const basePlans = [...packages]
      .sort((a, b) => (a.months || 0) - (b.months || 0))
      .map((pkg) => ({
        label: getTierLabel(pkg.months),
        title: pkg.name || `${pkg.months} Month Plan`,
        subtitle: "Premium access, custom coaching and progress tracking",
        priceWeightGain: `₹${pkg.priceWeightGain ?? "Contact Us"}`,
        priceWeightLoss: `₹${pkg.priceWeightLoss ?? "Contact Us"}`,
        priceTransformation: `₹${pkg.priceTransformation ?? "Contact Us"}`,
        whatsappUrl: `https://wa.me/919342393935?text=${encodeURIComponent(`I’m interested in the ${pkg.name || `${pkg.months} Month Plan`} plan`)}`,
        isPlaceholder: false,
      }));

    if (basePlans.length > 0) {
      return basePlans;
    }

    return [
      {
        label: "Monthly",
        title: "1 Month Plan",
        subtitle: "Premium access, custom coaching and progress tracking",
        priceWeightGain: "₹2,500",
        priceWeightLoss: "₹2,500",
        priceTransformation: "₹3,000",
        whatsappUrl: "https://wa.me/919342393935?text=I’m%20interested%20in%20the%201%20Month%20Plan",
      },
      {
        label: "Quarterly",
        title: "3 Months Plan",
        subtitle: "Premium access, custom coaching and progress tracking",
        priceWeightGain: "₹5,500",
        priceWeightLoss: "₹5,500",
        priceTransformation: "₹6,500",
        whatsappUrl: "https://wa.me/919342393935?text=I’m%20interested%20in%20the%203%20Months%20Plan",
      },
      {
        label: "Halfyearly",
        title: "6 Months Plan",
        subtitle: "Premium access, custom coaching and progress tracking",
        priceWeightGain: "₹9,000",
        priceWeightLoss: "₹9,000",
        priceTransformation: "₹10,500",
        whatsappUrl: "https://wa.me/919342393935?text=I’m%20interested%20in%20the%206%20Months%20Plan",
      },
      {
        label: "Annual",
        title: "12 Months Plan",
        subtitle: "Premium access, custom coaching and progress tracking",
        priceWeightGain: "₹15,000",
        priceWeightLoss: "₹15,000",
        priceTransformation: "₹17,500",
        whatsappUrl: "https://wa.me/919342393935?text=I’m%20interested%20in%20the%2012%20Months%20Plan",
      },
    ];
  }, [packages]);

  const SITE_URL = import.meta.env.VITE_SITE_URL || "";

  const businessSchema = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "HealthClub",
      name: "Giri Gym",
      url: SITE_URL,
      telephone: "+919342393935",
      email: "girigym@gmail.com",
      description:
        "Giri Gym is a gym and fitness centre in Mathur, Chennai offering strength training, transformation coaching, weight loss, weight gain, and membership enquiry support.",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Flat #18, Ponnaiamman Koil Street, Kamaraj Nagar",
        addressLocality: "Mathur",
        addressRegion: "Tamil Nadu",
        postalCode: "600068",
        addressCountry: "IN",
      },
      areaServed: ["Mathur", "Chennai", "Kamaraj Nagar"],
      hasMap: "https://www.google.com/maps/search/?api=1&query=Giri+Gym+Mathur+Chennai",
      sameAs: [],
    }),
    [SITE_URL]
  );

  const scrollToId = (id) => {
    setIsMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="homepage-shell">
      <header>
        <div className="container nav-container">
          <button className="logo" onClick={() => scrollToId("home")} aria-label="Go to homepage">
            GIRI <span>GYM</span>
          </button>

          <ul className={`nav-links ${isMenuOpen ? "active" : ""}`} id="navLinks">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} onClick={(event) => { event.preventDefault(); setIsMenuOpen(false); scrollToId(item.id); }}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>

          <a href="#plans" className="btn btn-primary nav-btn" onClick={(event) => { event.preventDefault(); scrollToId("plans"); }}>
            Join Now
          </a>
          <button className="hamburger" onClick={() => setIsMenuOpen((prev) => !prev)} aria-label="Open menu">
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      <main id="home">
        <section className="cta-banner">
          <div className="container">
            <h2>Start Today. Become Your Strongest Version.</h2>
            <button className="btn btn-primary" onClick={openEnquiry}>
              Join Giri Gym Now
            </button>
          </div>
        </section>

        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-content">
              <span className="badge">Giri Gym • Mathur, Chennai</span>
              <h1>Giri Gym | Gym &amp; Fitness Centre in Mathur, Chennai</h1>
              <p>Giri Gym in Mathur, Chennai offers strength training, transformation coaching, and a disciplined fitness environment for members in Kamaraj Nagar and surrounding areas.</p>
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={openEnquiry} id="hero-join-now-btn">
                  Explore Membership
                </button>
                <a href="#plans" className="btn btn-secondary" onClick={(event) => { event.preventDefault(); scrollToId("plans"); }}>
                  Find a Plan
                </a>
              </div>
              <div className="hero-stats">
                <div className="stat-item">
                  <h3>25+ Years</h3>
                  <p>Serving Chennai</p>
                </div>
                <div className="stat-item">
                  <h3>2 Locations</h3>
                  <p>Mathur &amp; Ladies Gym</p>
                </div>
                <div className="stat-item">
                  <h3>12000+</h3>
                  <p>sq. ft. Training Area</p>
                </div>
              </div>
            </div>
            <div className="hero-image-wrapper">
              <div className="hero-carousel">
                {HERO_IMAGES.map((image, index) => (
                  <img
                    key={image.src}
                    src={image.src}
                    alt={image.alt}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    className={`hero-slide ${index === activeHeroImage ? "is-active" : ""}`}
                  />
                ))}
                <div className="hero-carousel-overlay" />
                <div className="hero-carousel-controls">
                  <button
                    type="button"
                    className="hero-carousel-btn"
                    onClick={() => setActiveHeroImage((prev) => (prev - 1 + HERO_IMAGES.length) % HERO_IMAGES.length)}
                    aria-label="Previous image"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="hero-carousel-btn"
                    onClick={() => setActiveHeroImage((prev) => (prev + 1) % HERO_IMAGES.length)}
                    aria-label="Next image"
                  >
                    →
                  </button>
                </div>
                <div className="hero-dots" aria-label="Carousel indicators">
                  {HERO_IMAGES.map((image, index) => (
                    <button
                      key={`${image.src}-dot`}
                      type="button"
                      className={`hero-dot ${index === activeHeroImage ? "is-active" : ""}`}
                      onClick={() => setActiveHeroImage(index)}
                      aria-label={`Show image ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="features" id="why-us">
          <div className="container">
            <span className="badge">About Giri Gym</span>
            <h2 className="section-title">A fitness centre built around coaching, discipline, and measurable progress.</h2>
            <p className="section-subtitle">Giri Gym in Mathur, Chennai supports members looking for structured strength training, guided transformation support, and a professional gym environment.</p>
            <div className="features-grid">
              {FEATURE_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="feature-card">
                    <div className="feature-icon">
                      <Icon />
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="plans" id="plans">
          <div className="container">
            <span className="badge">Training &amp; Membership</span>
            <h2 className="section-title">Membership options for strength, weight loss, and transformation goals.</h2>
            <p className="section-subtitle">Explore membership options at Giri Gym in Mathur with support for personal training, transformation coaching, and structured fitness plans.</p>

            <div className="plans-grid">
              {loadingPlans ? (
                <article className="plan-card">
                  <p>Loading premium plans...</p>
                </article>
              ) : displayPlans.length === 0 ? (
                <article className="plan-card">
                  <p>{plansLoadFailed ? "Unable to load plans right now. Please refresh shortly." : "No plans available right now. Please check again shortly."}</p>
                </article>
              ) : (
                displayPlans.map((plan, index) => (
                  <PlanCard
                    key={`${plan.title}-${index}`}
                    plan={plan}
                    isFeatured={plan.label === "Annual" || plan.title.toLowerCase().includes("annual")}
                    onSelectPlan={openEnquiryForPlan}
                  />
                ))
              )}
            </div>
          </div>
        </section>

          <section className="proof">
          <div className="container proof-grid">
            <div className="rating-box">
              <div className="big-rating">Established</div>
              <div className="stars">≈ 2001</div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Public business details are being verified for the website and Google Business Profile.
              </p>
              <div className="metrics-list">
                <div className="metric-row">
                  <span>Location</span>
                  <span>Mathur, Chennai</span>
                </div>
                <div className="metric-row">
                  <span>Service Focus</span>
                  <span>Gym • Fitness • Training</span>
                </div>
                <div className="metric-row">
                  <span>Owner Confirmation</span>
                  <span>Required</span>
                </div>
              </div>
            </div>

            <div className="legacy-grid" style={{ gap: "1rem" }}>
              {legacyCards.map((item) => (
                <div key={item.title} className="legacy-item">
                  <h4>{item.title}</h4>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="branches" id="branches">
          <div className="container">
            <span className="badge">Location</span>
            <h2 className="section-title">Visit Giri Gym in Mathur, Chennai</h2>
            <p className="section-subtitle">Located next to Beloved School in Kamaraj Nagar, Mathur, Giri Gym is easy to reach for members across Chennai.</p>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(businessSchema) }} />

            <div className="branches-grid">
              {BRANCHES_CONFIG.map((branch) => (
                <article key={branch.name} className="branch-card">
                  <img src={branch.imageUrl} alt={branch.imageAlt} loading="lazy" decoding="async" />
                  <div className="branch-info">
                    <div className="branch-badge">{branch.pin}</div>
                    <h3>{branch.name}</h3>
                    <div className="branch-detail">
                      <FiMapPin />
                      <span>{branch.address}</span>
                    </div>
                    <div className="branch-detail">
                      <FiClock />
                      <span>{branch.timings}</span>
                    </div>
                    <div className="branch-detail">
                      <FiPhone />
                      <span>{branch.phone}</span>
                    </div>
                    <div className="branch-actions">
                      <a href={`tel:${branch.phone.replace(/\s+/g, "")}`} className="btn btn-secondary btn-full">Call Now</a>
                      <a href={branch.mapUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-full">Visit Map</a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="legacy">
          <div className="container legacy-grid">
            {legacyCards.map((item) => (
              <div key={item.title} className="legacy-item">
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

      </main>

      <footer id="contact" className="footer">
        <div className="container footer-grid">
          <div className="footer-about">
            <a href="#home" className="logo" onClick={(event) => { event.preventDefault(); scrollToId("home"); }}>
              GIRI <span>GYM</span>
            </a>
            <p>Giri Gym in Mathur, Chennai offers structured fitness coaching, transformation support, and direct enquiry assistance for local members.</p>
          </div>
          <div className="footer-column">
            <h4>Quick Links</h4>
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} onClick={(event) => { event.preventDefault(); scrollToId(item.id); }}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="footer-column">
            <h4>Contact Info</h4>
            <ul>
              <li><FiPhone /> +91 93423 93935</li>
              <li><FiMail /> girigym@gmail.com</li>
              <li><FiClock /> Morning: 4:00 AM - 11:00 AM</li>
              <li><FiClock /> Evening: 3:15 PM - 9:30 PM</li>
            </ul>
          </div>
          <div className="footer-column">
            <h4>Follow Us</h4>
            <div className="social-links">
              <a href="#" aria-label="Instagram">Instagram</a>
              <a href="#" aria-label="YouTube">YouTube</a>
              <a href="#" aria-label="Facebook">Facebook</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2026 Giri Gym. All rights reserved.</p>
        </div>
      </footer>

      <a href="https://wa.me/919342393935" className="whatsapp-float" target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp">
        <FiMessageCircle className="whatsapp-icon" />
      </a>

      <EnquiryModal
        isOpen={isEnquiryOpen}
        onClose={closeEnquiry}
        initialReason="Membership Plans"
        initialMessage={selectedPlan ? `Interested in ${selectedPlan.title} plan. Preferred package: ${selectedPlan.label || "Please suggest the best option"}.` : ""}
      />
    </div>
  );
}
